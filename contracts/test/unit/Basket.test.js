const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { USDG, EQ, FEED, baseFixture, deployVault, deposit } = require("./fixtures");

async function basketFixture() {
  const ctx = await baseFixture();
  const tsla = await deployVault(ctx, "TSLA", 250);
  const basket = await ethers.deployContract("StockpoolBasket", [
    ctx.usdg,
    ctx.admin.address,
    ctx.guardian.address,
    ctx.keeper.address,
    [await ctx.amd.vault.getAddress(), await tsla.vault.getAddress()],
    USDG(40_000),
    "Stockpool Basket",
    "spBASKET",
  ]);
  return { ...ctx, tsla, basket };
}

describe("StockpoolBasket", function () {
  it("starts with its Pools listed and its cap set", async function () {
    const { basket, amd, tsla } = await loadFixture(basketFixture);
    expect(await basket.pools()).to.deep.equal([await amd.vault.getAddress(), await tsla.vault.getAddress()]);
    expect(await basket.heldValueCap()).to.equal(USDG(40_000));
    expect(await basket.maxDeposit(ethers.ZeroAddress)).to.equal(USDG(40_000));
  });

  it("refuses an admin that is also the guardian, and a Pool listed twice", async function () {
    const { usdg, admin, keeper, amd } = await loadFixture(basketFixture);
    const v = await amd.vault.getAddress();
    await expect(
      ethers.deployContract("StockpoolBasket", [usdg, admin.address, admin.address, keeper.address, [v], 1, "B", "B"]),
    ).to.be.reverted;
    const { guardian } = await loadFixture(basketFixture);
    await expect(
      ethers.deployContract("StockpoolBasket", [usdg, admin.address, guardian.address, keeper.address, [v, v], 1, "B", "B"]),
    ).to.be.reverted;
  });

  it("puts deposits to work in the Pools within the allocation ceiling and values them", async function () {
    const { basket, usdg, alice, keeper, amd, tsla } = await loadFixture(basketFixture);
    await deposit({ usdg }, basket, alice, USDG(10_000));
    await basket.connect(keeper).allocate(amd.vault, USDG(4_000));
    await basket.connect(keeper).allocate(tsla.vault, USDG(4_000));
    await expect(basket.connect(keeper).allocate(tsla.vault, USDG(500))).to.be.revertedWithCustomError(basket, "OverAllocated");
    expect(await basket.idle()).to.equal(USDG(2_000));
    const total = await basket.totalAssets();
    expect(total).to.be.closeTo(USDG(10_000), USDG(1));
    // USDG exits come from the idle balance.
    expect(await basket.maxWithdraw(alice.address)).to.equal(USDG(2_000));
    await expect(basket.connect(alice).withdraw(USDG(2_500), alice.address, alice.address)).to.be.reverted;
    const before = await usdg.balanceOf(alice.address);
    await basket.connect(alice).withdraw(USDG(2_000), alice.address, alice.address);
    expect((await usdg.balanceOf(alice.address)) - before).to.equal(USDG(2_000));
  });

  it("pays the rest in kind: idle USDG plus a slice of every Pool", async function () {
    const { basket, usdg, alice, keeper, amd, tsla } = await loadFixture(basketFixture);
    await deposit({ usdg }, basket, alice, USDG(10_000));
    await basket.connect(keeper).allocate(amd.vault, USDG(4_000));
    await basket.connect(keeper).allocate(tsla.vault, USDG(3_000));
    const shares = await basket.balanceOf(alice.address);
    const u0 = await usdg.balanceOf(alice.address);
    await basket.connect(alice).redeemInKind(shares, alice.address, alice.address);
    expect((await usdg.balanceOf(alice.address)) - u0).to.equal(USDG(3_000));
    expect(await amd.vault.balanceOf(alice.address)).to.be.gt(0n);
    expect(await tsla.vault.balanceOf(alice.address)).to.be.gt(0n);
    expect(await basket.totalSupply()).to.equal(0n);
  });

  it("waits for fresh prices before USDG deposits and exits, but in-kind always works", async function () {
    const { basket, usdg, alice, keeper, amd } = await loadFixture(basketFixture);
    await deposit({ usdg }, basket, alice, USDG(5_000));
    await basket.connect(keeper).allocate(amd.vault, USDG(2_000));
    await time.increase(4_000); // the AMD feed allows 3,600 s
    expect(await basket.pricesUsable()).to.equal(false);
    expect(await basket.maxDeposit(alice.address)).to.equal(0n);
    expect(await basket.maxWithdraw(alice.address)).to.equal(0n);
    await basket.connect(alice).redeemInKind(await basket.balanceOf(alice.address), alice.address, alice.address);
    expect(await amd.vault.balanceOf(alice.address)).to.be.gt(0n);
  });

  it("lets the keeper bring USDG back from a Pool", async function () {
    const { basket, usdg, alice, keeper, amd } = await loadFixture(basketFixture);
    await deposit({ usdg }, basket, alice, USDG(5_000));
    await basket.connect(keeper).allocate(amd.vault, USDG(2_000));
    const held = await amd.vault.balanceOf(basket);
    await basket.connect(keeper).deallocate(amd.vault, held);
    expect(await amd.vault.balanceOf(basket)).to.equal(0n);
    expect(await basket.idle()).to.be.closeTo(USDG(5_000), USDG(1));
  });

  it("keeps the roles apart: only the keeper allocates, the guardian pauses, the admin lists and raises caps", async function () {
    const { basket, usdg, alice, keeper, guardian, admin, amd, tsla } = await loadFixture(basketFixture);
    await deposit({ usdg }, basket, alice, USDG(1_000));
    await expect(basket.connect(alice).allocate(amd.vault, USDG(100))).to.be.reverted;
    await expect(basket.connect(guardian).setHeldValueCap(1)).to.be.reverted;
    await expect(basket.connect(guardian).lowerHeldValueCap(USDG(50_000))).to.be.revertedWithCustomError(basket, "InvalidConfig");
    await basket.connect(guardian).lowerHeldValueCap(USDG(1_500));
    await basket.connect(guardian).pause();
    await usdg.connect(alice).approve(basket, USDG(100));
    await expect(basket.connect(alice).deposit(USDG(100), alice.address)).to.be.reverted;
    await expect(basket.connect(keeper).allocate(amd.vault, USDG(100))).to.be.reverted;
    // Exits stay open while paused.
    await basket.connect(alice).withdraw(USDG(500), alice.address, alice.address);
    await expect(basket.connect(guardian).unpause()).to.be.reverted;
    await basket.connect(admin).unpause();
    await expect(basket.connect(admin).listPool(tsla.vault)).to.be.revertedWithCustomError(basket, "InvalidConfig");
    await basket.connect(admin).delistPool(tsla.vault);
    expect(await basket.isListed(tsla.vault)).to.equal(false);
    await expect(basket.connect(keeper).allocate(tsla.vault, USDG(100))).to.be.revertedWithCustomError(basket, "NotListed");
  });

  it("refuses USDG deposits and exits while a held Pool trades off Chainlink, like the Pools do", async function () {
    const { basket, usdg, alice, bob, keeper, amd } = await loadFixture(basketFixture);
    await deposit({ usdg }, basket, alice, USDG(5_000));
    await basket.connect(keeper).allocate(amd.vault, USDG(2_000));
    expect(await basket.pricesUsable()).to.equal(true);
    // The AMD pool drops 20% below Chainlink while the feed still reads fresh.
    await amd.position.setSpot(USDG(120));
    expect(await amd.vault.priceUsable()).to.equal(false);
    expect(await basket.pricesUsable()).to.equal(false);
    expect(await basket.maxDeposit(bob.address)).to.equal(0n);
    expect(await basket.maxWithdraw(alice.address)).to.equal(0n);
    await usdg.connect(bob).approve(basket, USDG(1_000));
    await expect(basket.connect(bob).deposit(USDG(1_000), bob.address)).to.be.reverted;
    await expect(basket.connect(alice).withdraw(USDG(100), alice.address, alice.address)).to.be.reverted;
    // Leaving in kind needs no price.
    await basket.connect(alice).redeemInKind(await basket.balanceOf(alice.address), alice.address, alice.address);
    // Back within 2%: open again.
    await amd.position.setSpot(USDG(152));
    expect(await basket.pricesUsable()).to.equal(true);
  });

  it("allows one USDG withdrawal from the Pools per interval", async function () {
    const { basket, usdg, alice, keeper, amd, tsla } = await loadFixture(basketFixture);
    await deposit({ usdg }, basket, alice, USDG(5_000));
    await basket.connect(keeper).allocate(amd.vault, USDG(2_000));
    await basket.connect(keeper).allocate(tsla.vault, USDG(2_000));
    const half = (await amd.vault.balanceOf(basket)) / 2n;
    await basket.connect(keeper).deallocate(amd.vault, half);
    await expect(basket.connect(keeper).deallocate(tsla.vault, half)).to.be.revertedWithCustomError(basket, "TooSoon");
    await time.increase(30 * 60);
    await basket.connect(keeper).deallocate(tsla.vault, half);
  });

  it("delists a Pool despite a dust donation, but not one it really holds", async function () {
    const { basket, usdg, alice, admin, keeper, amd, tsla } = await loadFixture(basketFixture);
    await deposit({ usdg }, basket, alice, USDG(5_000));
    await basket.connect(keeper).allocate(amd.vault, USDG(1_000));
    await expect(basket.connect(admin).delistPool(amd.vault)).to.be.revertedWithCustomError(basket, "StillHeld");
    await deposit({ usdg }, tsla.vault, alice, USDG(10));
    await tsla.vault.connect(alice).transfer(basket, 10n ** 9n);
    await basket.connect(admin).delistPool(tsla.vault);
    expect(await basket.isListed(tsla.vault)).to.equal(false);
  });

  it("stops at its cap", async function () {
    const { basket, usdg, alice } = await loadFixture(basketFixture);
    await usdg.connect(alice).approve(basket, USDG(50_000));
    await expect(basket.connect(alice).deposit(USDG(40_001), alice.address)).to.be.reverted;
    await basket.connect(alice).deposit(USDG(40_000), alice.address);
  });
});
