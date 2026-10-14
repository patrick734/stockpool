// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @title StockpoolRounds: Shield & Boost
/// @notice Rounds on one Stock Token at a time. Holders pool the stock and pick a side:
///         - Shield is owed the dollar value it put in plus a fixed coupon, paid first.
///         - Boost gets everything left over: the upside beyond the coupon, and the first losses.
///         Everything is paid in the same Stock Token that went in. The start and end prices are the first Chainlink
///         rounds at or after the lock time and the end time, so nobody can pick the price by choosing when to call.
///         The pool is fully backed: payouts add up to what was deposited, so there are no liquidations or debts.
/// @dev Shield is matched up to `maxRatioBps` of Boost (30000 = 3 Shield per Boost); unmatched Shield is refunded at
///      the lock. The protocol fee is a share of Boost's profit in dollars, taken in the stock and sent to `feeSink`
///      (the BuyBurn). The owner lists stocks and sets the terms of future rounds within hard caps, pauses new
///      deposits and can cancel an unsettled round, which refunds every deposit in full. Nobody can move deposits.
contract StockpoolRounds is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant SHIELD = 0;
    uint8 public constant BOOST = 1;

    uint16 public constant MAX_COUPON_BPS = 500; // 5% per round
    uint16 public constant MAX_FEE_BPS = 1000; // 10% of Boost's profit
    uint32 public constant MIN_RATIO_BPS = 5_000; // 0.5 Shield per Boost
    uint32 public constant MAX_RATIO_BPS = 100_000; // 10 Shield per Boost
    uint32 public constant MIN_DURATION = 1 days;
    uint32 public constant MAX_DURATION = 30 days;
    uint32 public constant MAX_LEAD = 14 days; // longest deposit window
    /// @notice A round that cannot be locked or settled this long after its time is void: every deposit is refunded.
    uint32 public constant GRACE = 7 days;

    enum State {
        None,
        Open,
        Locked,
        Settled,
        Void
    }

    struct Series {
        IERC20 token;
        AggregatorV3Interface feed;
        uint16 couponBps;
        uint16 feeBps;
        uint32 maxRatioBps;
        uint32 duration;
        bool paused;
        uint256 minDeposit;
        uint256 lastRound;
    }

    struct Round {
        uint32 seriesId;
        uint64 lockAt;
        uint64 endAt;
        uint16 couponBps;
        uint16 feeBps;
        uint32 maxRatioBps;
        State state;
        uint256 shieldIn;
        uint256 boostIn;
        uint256 shieldMatched;
        uint256 startPrice;
        uint256 endPrice;
        uint256 shieldOut;
        uint256 boostOut;
        uint256 fee;
    }

    struct Position {
        uint256 shield;
        uint256 boost;
        bool refunded; // unmatched Shield returned
        bool claimed;
    }

    address public immutable feeSink;
    address public operator;

    Series[] private _series;
    Round[] private _rounds; // round id = index + 1
    mapping(uint256 roundId => mapping(address account => Position)) public positions;

    event SeriesListed(uint256 indexed seriesId, address indexed token, address indexed feed);
    event SeriesTermsSet(uint256 indexed seriesId, uint16 couponBps, uint16 feeBps, uint32 maxRatioBps, uint32 duration, uint256 minDeposit);
    event SeriesPaused(uint256 indexed seriesId, bool paused);
    event OperatorSet(address indexed operator);
    event RoundOpened(uint256 indexed roundId, uint256 indexed seriesId, uint64 lockAt, uint64 endAt, uint16 couponBps, uint16 feeBps, uint32 maxRatioBps);
    event Deposited(uint256 indexed roundId, address indexed account, uint8 side, uint256 amount);
    event Withdrawn(uint256 indexed roundId, address indexed account, uint8 side, uint256 amount);
    event Locked(uint256 indexed roundId, uint80 chainlinkRound, uint256 startPrice, uint256 shieldMatched, uint256 boostIn);
    event Settled(uint256 indexed roundId, uint80 chainlinkRound, uint256 endPrice, uint256 shieldOut, uint256 boostOut, uint256 fee);
    event Voided(uint256 indexed roundId, string reason);
    event Claimed(uint256 indexed roundId, address indexed account, uint256 amount);

    error InvalidConfig();
    error Unauthorized();
    error UnknownRound();
    error WrongState(State state);
    error TooEarly();
    error TooLate();
    error SeriesPausedError();
    error BelowMinimum();
    error InvalidSide();
    error Insufficient();
    error BadPriceRound();
    error NothingToClaim();
    error PreviousRoundOpen();

    constructor(address owner_, address operator_, address feeSink_) Ownable(owner_) {
        if (feeSink_ == address(0)) revert InvalidConfig();
        feeSink = feeSink_;
        operator = operator_;
        emit OperatorSet(operator_);
    }

    // ---------------------------------------------------------------- owner

    function listSeries(
        IERC20 token,
        AggregatorV3Interface feed,
        uint16 couponBps,
        uint16 feeBps,
        uint32 maxRatioBps,
        uint32 duration,
        uint256 minDeposit
    ) external onlyOwner returns (uint256 seriesId) {
        if (address(token) == address(0) || address(feed) == address(0)) revert InvalidConfig();
        _series.push();
        seriesId = _series.length - 1;
        Series storage s = _series[seriesId];
        s.token = token;
        s.feed = feed;
        emit SeriesListed(seriesId, address(token), address(feed));
        _setTerms(seriesId, couponBps, feeBps, maxRatioBps, duration, minDeposit);
    }

    /// @notice New terms apply to rounds opened afterwards; a round keeps the terms it opened with.
    function setTerms(uint256 seriesId, uint16 couponBps, uint16 feeBps, uint32 maxRatioBps, uint32 duration, uint256 minDeposit)
        external
        onlyOwner
    {
        _seriesAt(seriesId);
        _setTerms(seriesId, couponBps, feeBps, maxRatioBps, duration, minDeposit);
    }

    /// @notice Stops new deposits in this stock's open rounds. Withdrawals, locks, settlements and claims go on.
    function setPaused(uint256 seriesId, bool paused) external onlyOwner {
        _seriesAt(seriesId).paused = paused;
        emit SeriesPaused(seriesId, paused);
    }

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    /// @notice Cancels a round that is not settled yet. Every deposit is refunded in full. For a feed that broke
    ///         or a Stock Token event (a split) that would make the prices meaningless.
    function cancelRound(uint256 roundId, string calldata reason) external onlyOwner {
        Round storage r = _roundAt(roundId);
        if (r.state != State.Open && r.state != State.Locked) revert WrongState(r.state);
        _void(roundId, r, reason);
    }

    // ---------------------------------------------------------------- rounds

    /// @notice Opens the next round of a stock. Deposits close at `lockAt`; the round ends `duration` later.
    function openRound(uint256 seriesId, uint64 lockAt) external returns (uint256 roundId) {
        if (msg.sender != operator && msg.sender != owner()) revert Unauthorized();
        Series storage s = _seriesAt(seriesId);
        if (s.paused) revert SeriesPausedError();
        if (lockAt <= block.timestamp || lockAt > block.timestamp + MAX_LEAD) revert InvalidConfig();
        if (s.lastRound != 0 && _rounds[s.lastRound - 1].state == State.Open && block.timestamp < _rounds[s.lastRound - 1].lockAt) {
            revert PreviousRoundOpen();
        }
        _rounds.push();
        roundId = _rounds.length;
        Round storage r = _rounds[roundId - 1];
        r.seriesId = uint32(seriesId);
        r.lockAt = lockAt;
        r.endAt = lockAt + s.duration;
        r.couponBps = s.couponBps;
        r.feeBps = s.feeBps;
        r.maxRatioBps = s.maxRatioBps;
        r.state = State.Open;
        s.lastRound = roundId;
        emit RoundOpened(roundId, seriesId, lockAt, r.endAt, r.couponBps, r.feeBps, r.maxRatioBps);
    }

    function deposit(uint256 roundId, uint8 side, uint256 amount) external nonReentrant {
        Round storage r = _roundAt(roundId);
        if (r.state != State.Open) revert WrongState(r.state);
        if (block.timestamp >= r.lockAt) revert TooLate();
        Series storage s = _series[r.seriesId];
        if (s.paused) revert SeriesPausedError();
        if (side > BOOST) revert InvalidSide();
        if (amount == 0 || amount < s.minDeposit) revert BelowMinimum();
        uint256 before = s.token.balanceOf(address(this));
        s.token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = s.token.balanceOf(address(this)) - before;
        Position storage p = positions[roundId][msg.sender];
        if (side == SHIELD) {
            p.shield += received;
            r.shieldIn += received;
        } else {
            p.boost += received;
            r.boostIn += received;
        }
        emit Deposited(roundId, msg.sender, side, received);
    }

    /// @notice Takes deposits back before the round locks.
    function withdraw(uint256 roundId, uint8 side, uint256 amount) external nonReentrant {
        Round storage r = _roundAt(roundId);
        if (r.state != State.Open) revert WrongState(r.state);
        if (block.timestamp >= r.lockAt) revert TooLate();
        Position storage p = positions[roundId][msg.sender];
        if (side == SHIELD) {
            if (amount == 0 || amount > p.shield) revert Insufficient();
            p.shield -= amount;
            r.shieldIn -= amount;
        } else if (side == BOOST) {
            if (amount == 0 || amount > p.boost) revert Insufficient();
            p.boost -= amount;
            r.boostIn -= amount;
        } else {
            revert InvalidSide();
        }
        _series[r.seriesId].token.safeTransfer(msg.sender, amount);
        emit Withdrawn(roundId, msg.sender, side, amount);
    }

    /// @notice Records the start price: the first Chainlink round at or after `lockAt`. Anyone can call it.
    /// @param chainlinkRound That round's id on the stock's feed (the round before it must be older than `lockAt`).
    function lock(uint256 roundId, uint80 chainlinkRound) external nonReentrant {
        Round storage r = _roundAt(roundId);
        if (r.state != State.Open) revert WrongState(r.state);
        if (block.timestamp < r.lockAt) revert TooEarly();
        if (block.timestamp > uint256(r.lockAt) + GRACE) { _void(roundId, r, "not locked in time"); return; }
        if (r.shieldIn == 0 || r.boostIn == 0) { _void(roundId, r, "one side empty"); return; }
        uint256 price = _firstPriceAtOrAfter(_series[r.seriesId].feed, r.lockAt, chainlinkRound);
        r.startPrice = price;
        r.shieldMatched = Math.min(r.shieldIn, Math.mulDiv(r.boostIn, r.maxRatioBps, 10_000));
        r.state = State.Locked;
        emit Locked(roundId, chainlinkRound, price, r.shieldMatched, r.boostIn);
    }

    /// @notice Records the end price, the first Chainlink round at or after `endAt`, and splits the pool. Anyone can
    ///         call it.
    function settle(uint256 roundId, uint80 chainlinkRound) external nonReentrant {
        Round storage r = _roundAt(roundId);
        if (r.state != State.Locked) revert WrongState(r.state);
        if (block.timestamp < r.endAt) revert TooEarly();
        if (block.timestamp > uint256(r.endAt) + GRACE) { _void(roundId, r, "not settled in time"); return; }
        uint256 price = _firstPriceAtOrAfter(_series[r.seriesId].feed, r.endAt, chainlinkRound);
        (uint256 shieldOut, uint256 boostOut, uint256 fee) = _split(r, price);
        r.endPrice = price;
        r.shieldOut = shieldOut;
        r.boostOut = boostOut;
        r.fee = fee;
        r.state = State.Settled;
        if (fee != 0) _series[r.seriesId].token.safeTransfer(feeSink, fee);
        emit Settled(roundId, chainlinkRound, price, shieldOut, boostOut, fee);
    }

    /// @notice Voids a round nobody locked or settled in time. Every deposit is then refunded.
    function voidStale(uint256 roundId) external {
        Round storage r = _roundAt(roundId);
        if (r.state == State.Open && block.timestamp > uint256(r.lockAt) + GRACE) { _void(roundId, r, "not locked in time"); return; }
        if (r.state == State.Locked && block.timestamp > uint256(r.endAt) + GRACE) { _void(roundId, r, "not settled in time"); return; }
        revert WrongState(r.state);
    }

    /// @notice Pays out `account`'s position. Anyone can call it for anyone; the stock always goes to `account`.
    ///         While a round is locked this returns unmatched Shield; after settlement or a void, everything else.
    function claim(uint256 roundId, address account) public nonReentrant returns (uint256 amount) {
        Round storage r = _roundAt(roundId);
        Position storage p = positions[roundId][account];
        if (p.claimed) revert NothingToClaim();
        if (r.state == State.Void) {
            // a void round refunds every deposit; unmatched Shield already returned at the lock is not paid twice
            amount = (p.refunded ? _matchedPart(r, p.shield) : p.shield) + p.boost;
            p.claimed = true;
        } else if (r.state == State.Locked) {
            if (p.refunded) revert NothingToClaim();
            amount = p.shield - _matchedPart(r, p.shield);
            p.refunded = true;
        } else if (r.state == State.Settled) {
            uint256 matched = _matchedPart(r, p.shield);
            if (!p.refunded) amount = p.shield - matched;
            if (matched != 0) amount += Math.mulDiv(matched, r.shieldOut, r.shieldMatched);
            if (p.boost != 0) amount += Math.mulDiv(p.boost, r.boostOut, r.boostIn);
            p.refunded = true;
            p.claimed = true;
        } else {
            revert WrongState(r.state);
        }
        if (amount == 0) revert NothingToClaim();
        _series[r.seriesId].token.safeTransfer(account, amount);
        emit Claimed(roundId, account, amount);
    }

    function claimMany(uint256[] calldata roundIds, address account) external {
        for (uint256 i; i < roundIds.length; ++i) {
            claim(roundIds[i], account);
        }
    }

    // ---------------------------------------------------------------- reads

    function seriesCount() external view returns (uint256) {
        return _series.length;
    }

    function roundCount() external view returns (uint256) {
        return _rounds.length;
    }

    function series(uint256 seriesId) external view returns (Series memory) {
        return _seriesAt(seriesId);
    }

    function round(uint256 roundId) external view returns (Round memory) {
        if (roundId == 0 || roundId > _rounds.length) revert UnknownRound();
        return _rounds[roundId - 1];
    }

    /// @notice What Shield and Boost would get in total if the round ended at `endPrice` (same units as the feed).
    ///         Uses the live totals while the round is still open.
    function preview(uint256 roundId, uint256 startPrice, uint256 endPrice)
        external
        view
        returns (uint256 shieldMatched, uint256 shieldOut, uint256 boostOut, uint256 fee)
    {
        if (roundId == 0 || roundId > _rounds.length) revert UnknownRound();
        Round memory r = _rounds[roundId - 1];
        if (r.state == State.Open) {
            r.shieldMatched = Math.min(r.shieldIn, Math.mulDiv(r.boostIn, r.maxRatioBps, 10_000));
            r.startPrice = startPrice;
        }
        if (r.startPrice == 0 || endPrice == 0 || r.boostIn == 0) return (r.shieldMatched, 0, 0, 0);
        (shieldOut, boostOut, fee) = _split(r, endPrice);
        shieldMatched = r.shieldMatched;
    }

    /// @notice What `claim` would pay `account` right now.
    function claimable(uint256 roundId, address account) external view returns (uint256 amount) {
        if (roundId == 0 || roundId > _rounds.length) return 0;
        Round storage r = _rounds[roundId - 1];
        Position storage p = positions[roundId][account];
        if (p.claimed) return 0;
        uint256 matched = _matchedPart(r, p.shield);
        if (r.state == State.Void) return (p.refunded ? matched : p.shield) + p.boost;
        if (r.state == State.Locked) return p.refunded ? 0 : p.shield - matched;
        if (r.state == State.Settled) {
            if (!p.refunded) amount = p.shield - matched;
            if (matched != 0) amount += Math.mulDiv(matched, r.shieldOut, r.shieldMatched);
            if (p.boost != 0) amount += Math.mulDiv(p.boost, r.boostOut, r.boostIn);
        }
    }

    // ---------------------------------------------------------------- internal

    /// @dev Shield is owed matched * startPrice * (1 + coupon) in dollars, paid first in stock at the end price, capped
    ///      at the whole pool. Boost gets the rest; if that is worth more dollars than Boost put in, a share of the
    ///      profit is the fee.
    function _split(Round memory r, uint256 endPrice) private pure returns (uint256 shieldOut, uint256 boostOut, uint256 fee) {
        uint256 total = r.shieldMatched + r.boostIn;
        uint256 owed = Math.mulDiv(r.shieldMatched, r.startPrice * (10_000 + uint256(r.couponBps)), endPrice * 10_000);
        shieldOut = Math.min(total, owed);
        uint256 boostGross = total - shieldOut;
        uint256 breakEven = Math.mulDiv(r.boostIn, r.startPrice, endPrice); // Boost's deposit in dollars, in stock
        if (boostGross > breakEven) fee = Math.mulDiv(boostGross - breakEven, r.feeBps, 10_000);
        boostOut = boostGross - fee;
    }

    /// @dev The account's Shield that was matched at the lock (zero before the lock).
    function _matchedPart(Round storage r, uint256 shield) private view returns (uint256) {
        if (shield == 0 || r.shieldIn == 0) return 0;
        if (r.state == State.Open) return 0;
        if (r.state == State.Void && r.startPrice == 0) return 0;
        return Math.mulDiv(shield, r.shieldMatched, r.shieldIn);
    }

    /// @dev `roundId` must be the first round of the feed at or after `t`: updated at or after `t`, while the round
    ///      before it was updated before `t`.
    function _firstPriceAtOrAfter(AggregatorV3Interface feed, uint64 t, uint80 roundId) private view returns (uint256) {
        if (uint64(roundId) <= 1) revert BadPriceRound(); // the first round of a feed phase cannot be checked
        (, int256 answer,, uint256 updatedAt,) = feed.getRoundData(roundId);
        if (answer <= 0 || updatedAt < t) revert BadPriceRound();
        (,,, uint256 prevUpdatedAt,) = feed.getRoundData(roundId - 1);
        if (prevUpdatedAt == 0 || prevUpdatedAt >= t) revert BadPriceRound();
        return uint256(answer);
    }

    function _void(uint256 roundId, Round storage r, string memory reason) private {
        r.state = State.Void;
        emit Voided(roundId, reason);
    }

    function _setTerms(uint256 seriesId, uint16 couponBps, uint16 feeBps, uint32 maxRatioBps, uint32 duration, uint256 minDeposit) private {
        if (
            couponBps > MAX_COUPON_BPS || feeBps > MAX_FEE_BPS || maxRatioBps < MIN_RATIO_BPS || maxRatioBps > MAX_RATIO_BPS
                || duration < MIN_DURATION || duration > MAX_DURATION
        ) revert InvalidConfig();
        Series storage s = _series[seriesId];
        s.couponBps = couponBps;
        s.feeBps = feeBps;
        s.maxRatioBps = maxRatioBps;
        s.duration = duration;
        s.minDeposit = minDeposit;
        emit SeriesTermsSet(seriesId, couponBps, feeBps, maxRatioBps, duration, minDeposit);
    }

    function _seriesAt(uint256 seriesId) private view returns (Series storage) {
        if (seriesId >= _series.length) revert InvalidConfig();
        return _series[seriesId];
    }

    function _roundAt(uint256 roundId) private view returns (Round storage) {
        if (roundId == 0 || roundId > _rounds.length) revert UnknownRound();
        return _rounds[roundId - 1];
    }
}
