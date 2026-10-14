// Shield & Boost rounds, for one stock: lock a round once its deposits close, settle it once it ends, open the next
// one, and void a round that can no longer be priced. Locking and settling are open to anyone; the keeper just makes
// sure they happen. Every price is the first Chainlink round at or after the lock or end time, so when the keeper
// runs does not change any result.
const { ethers } = require("ethers");
const path = require("path");
const abis = require("../abis");
const { exec, blockTime } = require("../chain");
const { logger } = require("../log");
const { firstRoundAtOrAfter } = require("../feed");
const { CONTRACTS } = require("../config");
const { nextLockAt } = require(path.join(CONTRACTS, "lib", "schedule"));

const OPEN = 1n;
const LOCKED = 2n;
const GRACE = 7 * 86400;

function roundsContract(ctx) {
  return (ctx.roundsContract ||= new ethers.Contract(ctx.dep.rounds, abis.Rounds, ctx.runner));
}

/** Every recent round of this series that still needs the keeper: open or locked. */
async function pending(ctx, rounds, seriesId) {
  const count = Number(await rounds.roundCount());
  const from = Math.max(1, count - (ctx.cfg.rounds.scanBack || 60) + 1);
  const out = [];
  for (let id = count; id >= from; id--) {
    const r = await rounds.round(id);
    if (Number(r.seriesId) !== seriesId) continue;
    if (r.state === OPEN || r.state === LOCKED) out.push({ id, r });
  }
  return out.reverse();
}

async function runSeries(ctx, ticker, s) {
  const log = logger("rounds", ticker);
  const rounds = roundsContract(ctx);
  const now = Number(await blockTime(ctx.provider));

  for (const { id, r } of await pending(ctx, rounds, s.id)) {
    const due = r.state === OPEN ? Number(r.lockAt) : Number(r.endAt);
    if (now < due) continue;
    const what = r.state === OPEN ? "lock" : "settle";
    if (now > due + GRACE) {
      await exec(ctx, log, rounds, "voidStale", [id], `void round ${id}`);
      continue;
    }
    if (r.state === OPEN && (r.shieldIn === 0n || r.boostIn === 0n)) {
      // lock() voids a one-sided round on its own; no price needed
      await exec(ctx, log, rounds, "lock", [id, 0], `lock round ${id} (one side empty: void, refunds)`);
      continue;
    }
    const cl = await firstRoundAtOrAfter(ctx.provider, s.feed, due);
    if (!cl) {
      log.info(`round ${id}: waiting for the first Chainlink price after ${new Date(due * 1000).toISOString()}`);
      continue;
    }
    if (cl.unusable) {
      log.warn(`round ${id}: the first price after the ${what} time is the ${cl.unusable}; it voids itself ${GRACE / 86400} days later`);
      continue;
    }
    log.info(`${what} round ${id}`, { chainlinkRound: cl.id, price: ethers.formatUnits(cl.answer, 8), at: new Date(cl.updatedAt * 1000).toISOString() });
    await exec(ctx, log, rounds, what, [id, cl.id], `${what} round ${id}`);
  }

  // Keep one round open for deposits: the next one opens as soon as the last one locks.
  if (!ctx.cfg.rounds.openNext) return;
  const sr = await rounds.series(s.id);
  if (sr.paused) return log.info("series paused: no new rounds");
  if (sr.lastRound !== 0n) {
    const last = await rounds.round(sr.lastRound);
    if (last.state === OPEN && now < Number(last.lockAt)) return;
  }
  const lockAt = nextLockAt(now);
  log.info("opening the next round", { depositsClose: new Date(lockAt * 1000).toISOString() });
  await exec(ctx, log, rounds, "openRound", [s.id, lockAt], "openRound");
}

module.exports = { runSeries };
