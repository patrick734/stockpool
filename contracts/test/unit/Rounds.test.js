const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const E = (n) => ethers.parseEther(String(n));
const P = (usd) => BigInt(Math.round(usd * 1e8)); // 8-decimal Chainlink price
const SHIELD = 0;
const BOOST = 1;
const DAY = 86400;

async function setup({ coupon = 100, fee = 500, ratio = 30000, duration = 7 * DAY, min = 0n } = {}) {
  const [owner, operator, sink, alice, bob, carol, dave] = await ethers.getSigners();
  const stock = await ethers.deployContract("MockStockToken", ["NVIDIA", "NVDA"]);
  const feed = await ethers.deployContract("MockAggregator", [8, P(180)]);
  const rounds = await ethers.deployContract("StockpoolRounds", [owner, operator, sink]);
  await rounds.listSeries(stock, feed, coupon, fee, ratio, duration, min);
  for (const u of [alice, bob, carol, dave]) {
    await stock.mint(u, E(10_000));
    await stock.connect(u).approve(rounds, ethers.MaxUint256);
  }
  return { owner, operator, sink, alice, bob, carol, dave, stock, feed, rounds };
}

async function openRound(f, lead = DAY) {
  const lockAt = (await time.latest()) + lead;
  await f.rounds.connect(f.operator).openRound(0, lockAt);
  return { id: await f.rounds.roundCount(), lockAt };
}

/** Pushes a feed round strictly after `t` and returns its id (the one before it is older than `t`). */
async function priceAfter(f, t, usd) {
  if ((await time.latest()) < t) await time.increaseTo(t);
  await f.feed.setAnswer(P(usd));
  return f.feed.latestId();
}

async function lockAt(f, id, lockTime, usd) {
  const cl = await priceAfter(f, lockTime, usd);
  await f.rounds.lock(id, cl);
}

async function settleAt(f, id, usd) {
  const r = await f.rounds.round(id);
  const cl = await priceAfter(f, Number(r.endAt), usd);
  await f.rounds.settle(id, cl);
}

describe("StockpoolRounds: Shield & Boost", () => {
  it("up 10%: Shield gets its dollars plus the coupon, Boost takes the rest minus 5% of its profit", async () => {
    const f = await setup();
    const { id, lockAt: t } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(300));
    await f.rounds.connect(f.bob).deposit(id, BOOST, E(100));
    await lockAt(f, id, t, 180);
    await settleAt(f, id, 198);

    const r = await f.rounds.round(id);
    const shieldOwed = (E(300) * P(180) * 10100n) / (P(198) * 10000n);
    expect(r.shieldOut).to.equal(shieldOwed);
    const gross = E(400) - shieldOwed;
    const breakEven = (E(100) * P(180)) / P(198);
    const fee = ((gross - breakEven) * 500n) / 10000n;
    expect(r.fee).to.equal(fee);
    expect(r.boostOut).to.equal(gross - fee);
    expect(r.shieldOut + r.boostOut + r.fee).to.equal(E(400));
    expect(await f.stock.balanceOf(f.sink)).to.equal(fee);

    // Shield in dollars: +1% exactly (rounding down)
    const shieldUsd = r.shieldOut * P(198); // 1e18 * 1e8 units
    const owedUsd = (E(300) * P(180) * 101n) / 100n;
    expect(shieldUsd).to.be.lte(owedUsd);
    expect(owedUsd - shieldUsd).to.be.lt(P(198));

    const a0 = await f.stock.balanceOf(f.alice);
    await f.rounds.claim(id, f.alice);
    expect((await f.stock.balanceOf(f.alice)) - a0).to.equal(r.shieldOut);
    const b0 = await f.stock.balanceOf(f.bob);
    await f.rounds.claim(id, f.bob);
    expect((await f.stock.balanceOf(f.bob)) - b0).to.equal(r.boostOut);
    await expect(f.rounds.claim(id, f.bob)).to.be.revertedWithCustomError(f.rounds, "NothingToClaim");
  });

  it("down 10%: Shield is made whole in dollars plus coupon, Boost absorbs it, no fee", async () => {
    const f = await setup();
    const { id, lockAt: t } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(300));
    await f.rounds.connect(f.bob).deposit(id, BOOST, E(100));
    await lockAt(f, id, t, 180);
    await settleAt(f, id, 162);
    const r = await f.rounds.round(id);
    expect(r.shieldOut).to.equal((E(300) * P(180) * 10100n) / (P(162) * 10000n));
    expect(r.fee).to.equal(0);
    expect(r.boostOut).to.equal(E(400) - r.shieldOut);
  });

  it("a crash past Boost's cushion: Shield takes the whole pool, Boost gets nothing", async () => {
    const f = await setup();
    const { id, lockAt: t } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(300));
    await f.rounds.connect(f.bob).deposit(id, BOOST, E(100));
    await lockAt(f, id, t, 180);
    await settleAt(f, id, 120);
    const r = await f.rounds.round(id);
    expect(r.shieldOut).to.equal(E(400));
    expect(r.boostOut).to.equal(0);
    await expect(f.rounds.claim(id, f.bob)).to.be.revertedWithCustomError(f.rounds, "NothingToClaim");
  });

  it("matches Shield up to 3x Boost and refunds the rest at the lock, pro rata", async () => {
    const f = await setup();
    const { id, lockAt: t } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(400));
    await f.rounds.connect(f.carol).deposit(id, SHIELD, E(200));
    await f.rounds.connect(f.bob).deposit(id, BOOST, E(100));
    await lockAt(f, id, t, 180);
    const r = await f.rounds.round(id);
    expect(r.shieldMatched).to.equal(E(300));
    // half of each Shield deposit is matched
    expect(await f.rounds.claimable(id, f.alice)).to.equal(E(200));
    const a0 = await f.stock.balanceOf(f.alice);
    await f.rounds.claim(id, f.alice);
    expect((await f.stock.balanceOf(f.alice)) - a0).to.equal(E(200));
    await expect(f.rounds.claim(id, f.alice)).to.be.revertedWithCustomError(f.rounds, "NothingToClaim");

    await settleAt(f, id, 180); // flat: Shield gets its coupon from Boost
    const s = await f.rounds.round(id);
    const a1 = await f.stock.balanceOf(f.alice);
    await f.rounds.claim(id, f.alice); // the matched 200, settled
    expect((await f.stock.balanceOf(f.alice)) - a1).to.equal((E(200) * s.shieldOut) / E(300));
    const c0 = await f.stock.balanceOf(f.carol);
    await f.rounds.claim(id, f.carol); // unmatched 100 + matched 100, in one claim
    expect((await f.stock.balanceOf(f.carol)) - c0).to.equal(E(100) + (E(100) * s.shieldOut) / E(300));
  });

  it("deposits and withdrawals close at the lock; the lock needs the first price at or after it", async () => {
    const f = await setup();
    const { id, lockAt: t } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(50));
    await f.rounds.connect(f.alice).withdraw(id, SHIELD, E(20));
    expect((await f.rounds.positions(id, f.alice)).shield).to.equal(E(30));
    await f.rounds.connect(f.bob).deposit(id, BOOST, E(30));
    await expect(f.rounds.lock(id, await f.feed.latestId())).to.be.revertedWithCustomError(f.rounds, "TooEarly");

    await time.increaseTo(t);
    await expect(f.rounds.connect(f.carol).deposit(id, BOOST, E(1))).to.be.revertedWithCustomError(f.rounds, "TooLate");
    await expect(f.rounds.connect(f.alice).withdraw(id, SHIELD, E(1))).to.be.revertedWithCustomError(f.rounds, "TooLate");

    const stale = await f.feed.latestId(); // before the lock time
    await expect(f.rounds.lock(id, stale)).to.be.revertedWithCustomError(f.rounds, "BadPriceRound");
    const first = await priceAfter(f, t, 181);
    await f.feed.setAnswer(P(250)); // a later round cannot be chosen instead
    await expect(f.rounds.lock(id, await f.feed.latestId())).to.be.revertedWithCustomError(f.rounds, "BadPriceRound");
    await f.rounds.lock(id, first);
    expect((await f.rounds.round(id)).startPrice).to.equal(P(181));
  });

  it("settlement also needs the first price at or after the end", async () => {
    const f = await setup();
    const { id, lockAt: t } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(10));
    await f.rounds.connect(f.bob).deposit(id, BOOST, E(10));
    await lockAt(f, id, t, 100);
    const r = await f.rounds.round(id);
    await expect(f.rounds.settle(id, await f.feed.latestId())).to.be.revertedWithCustomError(f.rounds, "TooEarly");
    await time.increaseTo(Number(r.endAt) - 100);
    await f.feed.setAnswer(P(90)); // just before the end
    const first = await priceAfter(f, Number(r.endAt), 110);
    await f.feed.setAnswer(P(70));
    await expect(f.rounds.settle(id, first - 1n)).to.be.revertedWithCustomError(f.rounds, "BadPriceRound");
    await expect(f.rounds.settle(id, first + 1n)).to.be.revertedWithCustomError(f.rounds, "BadPriceRound");
    await f.rounds.settle(id, first);
    expect((await f.rounds.round(id)).endPrice).to.equal(P(110));
  });

  it("a round with an empty side is void and refunds everything", async () => {
    const f = await setup();
    const { id, lockAt: t } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(10));
    await time.increaseTo(t);
    await expect(f.rounds.lock(id, 0)).to.emit(f.rounds, "Voided").withArgs(id, "one side empty");
    const a0 = await f.stock.balanceOf(f.alice);
    await f.rounds.claim(id, f.alice);
    expect((await f.stock.balanceOf(f.alice)) - a0).to.equal(E(10));
  });

  it("a round nobody settles in time is void, refunding deposits once even after a partial refund", async () => {
    const f = await setup();
    const { id, lockAt: t } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(60));
    await f.rounds.connect(f.bob).deposit(id, BOOST, E(10));
    await lockAt(f, id, t, 100);
    await f.rounds.claim(id, f.alice); // unmatched 30 back
    const r = await f.rounds.round(id);
    await expect(f.rounds.voidStale(id)).to.be.revertedWithCustomError(f.rounds, "WrongState");
    await time.increaseTo(Number(r.endAt) + 7 * DAY + 1);
    await f.rounds.voidStale(id);
    expect(await f.rounds.claimable(id, f.alice)).to.equal(E(30));
    const a0 = await f.stock.balanceOf(f.alice);
    await f.rounds.claim(id, f.alice);
    expect((await f.stock.balanceOf(f.alice)) - a0).to.equal(E(30));
    await f.rounds.claim(id, f.bob);
    expect(await f.stock.balanceOf(f.rounds)).to.equal(0);
  });

  it("the owner can cancel an unsettled round (full refund) but not a settled one, and cannot touch deposits", async () => {
    const f = await setup();
    const { id, lockAt: t } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(10));
    await f.rounds.connect(f.bob).deposit(id, BOOST, E(10));
    await expect(f.rounds.connect(f.alice).cancelRound(id, "x")).to.be.revertedWithCustomError(f.rounds, "OwnableUnauthorizedAccount");
    await f.rounds.cancelRound(id, "stock split");
    await expect(f.rounds.connect(f.alice).deposit(id, SHIELD, E(1))).to.be.revertedWithCustomError(f.rounds, "WrongState");
    await f.rounds.claim(id, f.alice);
    await f.rounds.claim(id, f.bob);
    expect(await f.stock.balanceOf(f.rounds)).to.equal(0);

    const second = await openRound(f);
    await f.rounds.connect(f.alice).deposit(second.id, SHIELD, E(10));
    await f.rounds.connect(f.bob).deposit(second.id, BOOST, E(10));
    await lockAt(f, second.id, second.lockAt, 100);
    await settleAt(f, second.id, 100);
    await expect(f.rounds.cancelRound(second.id, "x")).to.be.revertedWithCustomError(f.rounds, "WrongState");
  });

  it("only the operator or owner opens rounds, one open deposit window per stock, within the caps", async () => {
    const f = await setup();
    const t = (await time.latest()) + DAY;
    await expect(f.rounds.connect(f.alice).openRound(0, t)).to.be.revertedWithCustomError(f.rounds, "Unauthorized");
    await f.rounds.connect(f.operator).openRound(0, t);
    await expect(f.rounds.connect(f.operator).openRound(0, t + 10)).to.be.revertedWithCustomError(f.rounds, "PreviousRoundOpen");
    await expect(f.rounds.setTerms(0, 501, 500, 30000, 7 * DAY, 0)).to.be.revertedWithCustomError(f.rounds, "InvalidConfig");
    await expect(f.rounds.setTerms(0, 100, 1001, 30000, 7 * DAY, 0)).to.be.revertedWithCustomError(f.rounds, "InvalidConfig");
    await expect(f.rounds.setTerms(0, 100, 500, 100001, 7 * DAY, 0)).to.be.revertedWithCustomError(f.rounds, "InvalidConfig");
    // new terms only apply to the next round
    await f.rounds.setTerms(0, 200, 500, 30000, 7 * DAY, 0);
    expect((await f.rounds.round(1)).couponBps).to.equal(100);
    await time.increaseTo(t);
    await f.rounds.connect(f.operator).openRound(0, t + DAY);
    expect((await f.rounds.round(2)).couponBps).to.equal(200);
  });

  it("pausing stops new deposits only", async () => {
    const f = await setup();
    const { id } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(10));
    await f.rounds.setPaused(0, true);
    await expect(f.rounds.connect(f.alice).deposit(id, SHIELD, E(1))).to.be.revertedWithCustomError(f.rounds, "SeriesPausedError");
    await f.rounds.connect(f.alice).withdraw(id, SHIELD, E(10));
  });

  it("preview matches the settled split", async () => {
    const f = await setup();
    const { id, lockAt: t } = await openRound(f);
    await f.rounds.connect(f.alice).deposit(id, SHIELD, E(250));
    await f.rounds.connect(f.bob).deposit(id, BOOST, E(100));
    const pv = await f.rounds.preview(id, P(180), P(205));
    await lockAt(f, id, t, 180);
    await settleAt(f, id, 205);
    const r = await f.rounds.round(id);
    expect([pv.shieldMatched, pv.shieldOut, pv.boostOut, pv.fee]).to.deep.equal([r.shieldMatched, r.shieldOut, r.boostOut, r.fee]);
  });

  it("books what actually arrived from a fee-on-transfer token", async () => {
    const [owner, operator, sink, alice] = await ethers.getSigners();
    const tok = await ethers.deployContract("MockFeeToken");
    const feed = await ethers.deployContract("MockAggregator", [8, P(10)]);
    const rounds = await ethers.deployContract("StockpoolRounds", [owner, operator, sink]);
    await rounds.listSeries(tok, feed, 100, 500, 30000, DAY, 0);
    await tok.mint(alice, E(100));
    await tok.connect(alice).approve(rounds, ethers.MaxUint256);
    await rounds.connect(operator).openRound(0, (await time.latest()) + 3600);
    await rounds.connect(alice).deposit(1, BOOST, E(100));
    expect((await rounds.positions(1, alice)).boost).to.equal(E(99));
  });

  it("fuzz: payouts always add up to the pool, and nobody is paid more than the pool", async () => {
    const f = await setup({ coupon: 300, fee: 1000, ratio: 50000 });
    const users = [f.alice, f.bob, f.carol, f.dave];
    let seed = 7;
    const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let k = 0; k < 6; k++) {
      const { id, lockAt: t } = await openRound(f);
      for (const u of users) {
        const side = rnd(2);
        await f.rounds.connect(u).deposit(id, side, E(1 + rnd(500)));
      }
      const before = await f.stock.balanceOf(f.rounds);
      await lockAt(f, id, t, 50 + rnd(200));
      if (Number((await f.rounds.round(id)).state) === 2) await settleAt(f, id, 20 + rnd(400));
      const r = await f.rounds.round(id);
      if (Number(r.state) === 3) {
        expect(r.shieldOut + r.boostOut + r.fee).to.equal(r.shieldMatched + r.boostIn);
        let paid = 0n;
        for (const u of users) {
          const c = await f.rounds.claimable(id, u);
          if (c > 0n) {
            await f.rounds.claim(id, u);
            paid += c;
          }
        }
        expect(paid + r.fee).to.be.lte(before);
        expect(before - paid - r.fee).to.be.lte(10n); // rounding dust only
      } else {
        for (const u of users) if ((await f.rounds.claimable(id, u)) > 0n) await f.rounds.claim(id, u);
      }
      expect(await f.stock.balanceOf(f.rounds)).to.be.lte(BigInt(10 * (k + 1)));
    }
  });
});
