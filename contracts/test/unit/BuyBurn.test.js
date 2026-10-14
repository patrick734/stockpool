const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const E = (n) => ethers.parseEther(String(n));
const P = (usd) => BigInt(Math.round(usd * 1e8));

describe("Fees: Rounds -> BuyBurn -> burned $SPOOL", () => {
  async function setup() {
    const [dev, guardian, keeper, alice, bob] = await ethers.getSigners();
    const stock = await ethers.deployContract("MockStockToken", ["NVIDIA", "NVDA"]);
    const feed = await ethers.deployContract("MockAggregator", [8, P(100)]);
    const spool = await ethers.deployContract("MockERC20", ["Stockpool", "SPOOL", 18]);
    const swap = await ethers.deployContract("MockSwapAdapter");
    await spool.mint(swap, E(1_000_000));
    await swap.setRate(stock, spool, E(1000)); // 1 NVDA buys 1000 SPOOL
    const buyBurn = await ethers.deployContract("StockpoolBuyBurn", [ethers.ZeroAddress, swap, dev, guardian, keeper, 3600, dev]);
    const rounds = await ethers.deployContract("StockpoolRounds", [dev, keeper, buyBurn]);
    await rounds.listSeries(stock, feed, 100, 500, 30000, 7 * 86400, 0);
    for (const u of [alice, bob]) {
      await stock.mint(u, E(1000));
      await stock.connect(u).approve(rounds, ethers.MaxUint256);
    }
    return { dev, guardian, keeper, alice, bob, stock, feed, spool, swap, buyBurn, rounds };
  }

  it("a winning Boost pays 5% of its profit to BuyBurn, which the keeper spends on $SPOOL and burns", async () => {
    const f = await setup();
    const lockAt = (await time.latest()) + 3600;
    await f.rounds.connect(f.keeper).openRound(0, lockAt);
    await f.rounds.connect(f.alice).deposit(1, 0, E(100));
    await f.rounds.connect(f.bob).deposit(1, 1, E(100));
    await time.increaseTo(lockAt);
    await f.feed.setAnswer(P(100));
    await f.rounds.lock(1, await f.feed.latestId());
    await time.increaseTo((await f.rounds.round(1)).endAt);
    await f.feed.setAnswer(P(150));
    await f.rounds.settle(1, await f.feed.latestId());
    const fee = (await f.rounds.round(1)).fee;
    expect(fee).to.be.gt(0);
    expect(await f.stock.balanceOf(f.buyBurn)).to.equal(fee);

    // nothing happens until $SPOOL is set, then only the token setter can set it, once
    await expect(f.buyBurn.connect(f.alice).setToken(f.spool)).to.be.revertedWithCustomError(f.buyBurn, "Unauthorized");
    await f.buyBurn.setToken(f.spool);
    await expect(f.buyBurn.setToken(f.spool)).to.be.revertedWithCustomError(f.buyBurn, "TokenAlreadySet");
    await f.buyBurn.setInputLimit(f.stock, E(100));
    await expect(f.buyBurn.connect(f.alice).buyAndBurn(f.stock, fee, 1, "0x")).to.be.reverted;
    const supply = await f.spool.totalSupply();
    await f.buyBurn.connect(f.keeper).buyAndBurn(f.stock, fee, 1, "0x");
    expect(await f.spool.totalSupply()).to.equal(supply - (fee * 1000n));
    expect(await f.buyBurn.totalBurned()).to.equal(fee * 1000n);
  });
});
