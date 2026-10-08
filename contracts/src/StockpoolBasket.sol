// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {StockpoolVault} from "./StockpoolVault.sol";

/// @title StockpoolBasket
/// @notice One USDG deposit spread across several Stockpool Pools. The keeper places idle USDG into the listed Pools
///         and takes it back out, never putting more than `maxAllocationBps` of the Basket into one Pool.
/// @dev USDG exits are paid from the idle balance the keeper keeps for them. `redeemInKind` always works: it pays the
///      holder's slice of the idle USDG plus their slice of every Pool's shares, with no price needed.
contract StockpoolBasket is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    uint256 public constant MAX_POOLS = 8;
    uint256 public constant DEALLOCATION_INTERVAL = 30 minutes;
    uint256 public constant DUST_SHARES = 1e12; // one Pool share
    uint256 private constant BPS = 10_000;

    StockpoolVault[] private _pools;
    mapping(address => bool) public isListed;

    uint256 public heldValueCap;
    uint16 public maxAllocationBps = 4_000;
    uint256 public lastDeallocation;

    event PoolListed(address indexed pool);
    event PoolDelisted(address indexed pool);
    event Allocated(address indexed pool, uint256 assets, uint256 shares);
    event Deallocated(address indexed pool, uint256 shares, uint256 assets);
    event RedeemedInKind(address indexed owner, address indexed receiver, uint256 shares, uint256 usdg);
    event HeldValueCapSet(uint256 cap);
    event MaxAllocationSet(uint16 bps);

    error InvalidConfig();
    error NotListed();
    error OverAllocated();
    error StillHeld();
    error TooSoon();

    /// @param pools_ The Pools the Basket starts with. Later additions go through the admin (the timelock).
    constructor(
        IERC20 usdg,
        address admin,
        address guardian,
        address keeper,
        StockpoolVault[] memory pools_,
        uint256 heldValueCap_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) ERC4626(usdg) {
        if (admin == address(0) || guardian == address(0) || keeper == address(0) || admin == guardian) {
            revert InvalidConfig();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, guardian);
        _grantRole(KEEPER_ROLE, keeper);
        for (uint256 i; i < pools_.length; ++i) _list(pools_[i]);
        heldValueCap = heldValueCap_;
    }

    function pools() external view returns (StockpoolVault[] memory) {
        return _pools;
    }

    /// @notice False while any Pool the Basket holds has a stale Chainlink price or trades more than its deviation
    ///         limit away from it. USDG deposits and exits wait then, exactly as they do on the Pools themselves, so
    ///         nobody can enter or leave at a price the market has already moved away from. Exits in kind never wait.
    function pricesUsable() public view returns (bool) {
        for (uint256 i; i < _pools.length; ++i) {
            if (_pools[i].balanceOf(address(this)) != 0 && !_pools[i].priceUsable()) return false;
        }
        return true;
    }

    function idle() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function totalAssets() public view override returns (uint256 total) {
        total = idle();
        for (uint256 i; i < _pools.length; ++i) {
            uint256 shares = _pools[i].balanceOf(address(this));
            if (shares != 0) total += _pools[i].convertToAssets(shares);
        }
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused() || !pricesUsable()) return 0;
        uint256 held = totalAssets();
        return heldValueCap > held ? heldValueCap - held : 0;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assets = maxDeposit(receiver);
        return assets == 0 ? 0 : _convertToShares(assets, Math.Rounding.Floor);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (!pricesUsable()) return 0;
        return Math.min(super.maxWithdraw(owner), idle());
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (!pricesUsable()) return 0;
        return Math.min(super.maxRedeem(owner), _convertToShares(idle(), Math.Rounding.Floor));
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant whenNotPaused returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant whenNotPaused returns (uint256) {
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override nonReentrant returns (uint256) {
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public override nonReentrant returns (uint256) {
        return super.redeem(shares, receiver, owner);
    }

    /// @notice Burns Basket shares for their slice of the idle USDG and of every Pool's shares. Needs no price, so it
    ///         works while a market is closed or the Basket is paused.
    function redeemInKind(uint256 shares, address receiver, address owner) external nonReentrant returns (uint256 usdgOut) {
        if (shares == 0) revert InvalidConfig();
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        uint256 supply = totalSupply();
        _burn(owner, shares);
        usdgOut = Math.mulDiv(idle(), shares, supply);
        if (usdgOut != 0) IERC20(asset()).safeTransfer(receiver, usdgOut);
        for (uint256 i; i < _pools.length; ++i) {
            uint256 part = Math.mulDiv(_pools[i].balanceOf(address(this)), shares, supply);
            if (part != 0) IERC20(address(_pools[i])).safeTransfer(receiver, part);
        }
        emit RedeemedInKind(owner, receiver, shares, usdgOut);
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ---------------------------------------------------------------- keeper

    function allocate(StockpoolVault pool, uint256 assets) external onlyRole(KEEPER_ROLE) whenNotPaused nonReentrant {
        if (!isListed[address(pool)]) revert NotListed();
        IERC20(asset()).forceApprove(address(pool), assets);
        uint256 shares = pool.deposit(assets, address(this));
        IERC20(asset()).forceApprove(address(pool), 0);
        uint256 inPool = pool.convertToAssets(pool.balanceOf(address(this)));
        if (inPool * BPS > totalAssets() * maxAllocationBps) revert OverAllocated();
        emit Allocated(address(pool), assets, shares);
    }

    function deallocate(StockpoolVault pool, uint256 shares) external onlyRole(KEEPER_ROLE) nonReentrant {
        if (!isListed[address(pool)]) revert NotListed();
        // At most one USDG exit from the Pools per interval, so a misbehaving keeper cannot churn the Basket
        // through the Pools' swap costs.
        if (block.timestamp < lastDeallocation + DEALLOCATION_INTERVAL) revert TooSoon();
        lastDeallocation = block.timestamp;
        uint256 assets = pool.redeem(shares, address(this), address(this));
        emit Deallocated(address(pool), shares, assets);
    }

    // ---------------------------------------------------------------- governance

    function listPool(StockpoolVault pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _list(pool);
    }

    function _list(StockpoolVault pool) private {
        if (isListed[address(pool)] || _pools.length >= MAX_POOLS || pool.asset() != asset()) revert InvalidConfig();
        isListed[address(pool)] = true;
        _pools.push(pool);
        emit PoolListed(address(pool));
    }

    function delistPool(StockpoolVault pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isListed[address(pool)]) revert NotListed();
        // Dust (worth about a dollar at most) does not block a delisting, so a tiny donation cannot hold it up.
        if (pool.balanceOf(address(this)) > DUST_SHARES) revert StillHeld();
        isListed[address(pool)] = false;
        for (uint256 i; i < _pools.length; ++i) {
            if (_pools[i] == pool) {
                _pools[i] = _pools[_pools.length - 1];
                _pools.pop();
                break;
            }
        }
        emit PoolDelisted(address(pool));
    }

    function setHeldValueCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        heldValueCap = cap;
        emit HeldValueCapSet(cap);
    }

    function lowerHeldValueCap(uint256 cap) external onlyRole(GUARDIAN_ROLE) {
        if (cap > heldValueCap) revert InvalidConfig();
        heldValueCap = cap;
        emit HeldValueCapSet(cap);
    }

    function setMaxAllocationBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps == 0 || bps > BPS) revert InvalidConfig();
        maxAllocationBps = bps;
        emit MaxAllocationSet(bps);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
