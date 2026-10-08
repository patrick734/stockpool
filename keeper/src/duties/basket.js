// Basket duty: keep part of the Basket in USDG for exits and spread the rest evenly across its Pools.
//   idle above the buffer  -> allocate into the Pools furthest below an even share (within each Pool's cap and the
//                             Basket's per-Pool ceiling)
//   idle under half of it  -> take USDG back from the most-filled Pool
const { ethers } = require("ethers");
const abis = require("../abis");
const { exec, reason } = require("../chain");
const { logger } = require("../log");

const BPS = 10_000n;

async function runBasket(ctx) {
  const log = logger("basket");
  const cfg = ctx.cfg.basket || {};
  if (cfg.enabled === false || !ctx.dep.basket) return;
  const basket = new ethers.Contract(ctx.dep.basket, abis.Basket, ctx.runner);
  if (await basket.paused()) return log.info("paused, skipping");
  if (!(await basket.pricesUsable())) return log.info("a Pool price is stale or the pool is off Chainlink; waiting");
  if (!(await basket.hasRole(await basket.KEEPER_ROLE(), ctx.keeper))) return log.warn("keeper address lacks KEEPER_ROLE on the Basket");

  const poolAddrs = await basket.pools();
  const pools = [];
  for (const a of poolAddrs) {
    const v = new ethers.Contract(a, abis.LiquidityVault, ctx.provider);
    const [shares, paused, fresh] = await Promise.all([v.balanceOf(basket.target), v.paused(), v.priceUsable()]);
    const value = shares > 0n ? await v.convertToAssets(shares) : 0n;
    const room = paused || !fresh ? 0n : await v.maxDeposit(basket.target);
    pools.push({ address: a, vault: v, shares, value, room, usable: !paused && fresh });
  }
  const [idle, total, maxBps] = await Promise.all([basket.idle(), basket.totalAssets(), basket.maxAllocationBps()]);
  if (total === 0n) return log.info("empty");
  const buffer = (total * BigInt(Math.round((cfg.idlePct ?? 20) * 100))) / BPS;
  const minMove = ethers.parseUnits(String(cfg.minMoveUsdg ?? "50"), 6);
  const status = { total: ethers.formatUnits(total, 6), idle: ethers.formatUnits(idle, 6), buffer: ethers.formatUnits(buffer, 6) };

  if (idle > buffer + minMove) {
    let spare = idle - buffer;
    const usable = pools.filter((p) => p.usable);
    if (!usable.length) return log.info("no Pool can take deposits right now", status);
    // Even target per Pool, never above the Basket's own per-Pool ceiling (a hair under it, for rounding).
    const ceiling = (total * BigInt(maxBps)) / BPS - 1_000n;
    const even = (total - buffer) / BigInt(pools.length);
    const target = even < ceiling ? even : ceiling;
    usable.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
    let moved = 0;
    for (const p of usable) {
      if (spare < minMove) break;
      let amount = target > p.value ? target - p.value : 0n;
      if (amount > spare) amount = spare;
      if (amount > p.room) amount = p.room;
      if (amount < minMove) continue;
      const r = await exec(ctx, log, basket, "allocate", [p.address, amount], `allocate ${ethers.formatUnits(amount, 6)} USDG`, ["OverAllocated"]);
      if (r.ok) {
        spare -= amount;
        moved++;
      }
    }
    if (!moved) log.info("idle USDG above the buffer, but every Pool is at its share or cap", status);
    return;
  }

  if (idle * 2n < buffer) {
    const need = buffer - idle;
    const [last, interval, now] = await Promise.all([basket.lastDeallocation(), basket.DEALLOCATION_INTERVAL(), ctx.provider.getBlock("latest").then((b) => BigInt(b.timestamp))]);
    if (now < last + interval) return log.info("idle below the buffer; the Basket allows one withdrawal from the Pools per interval, waiting", status);
    const fullest = pools.filter((p) => p.shares > 0n && p.usable).sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0));
    if (!fullest.length) return log.info("idle below the buffer but nothing to bring back", status);
    for (const p of fullest) {
      try {
        let shares = await p.vault.convertToShares(need);
        const max = await p.vault.maxRedeem(basket.target);
        if (shares > max) shares = max;
        if (shares === 0n) continue;
        await exec(ctx, log, basket, "deallocate", [p.address, shares], `bring back about ${ethers.formatUnits(need, 6)} USDG`);
        return;
      } catch (e) {
        log.warn("could not size the withdrawal", { pool: p.address, reason: reason(e) });
      }
    }
    return;
  }
  log.info("balanced", status);
}

module.exports = { runBasket };
