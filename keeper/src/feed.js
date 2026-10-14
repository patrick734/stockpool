// Finds the Chainlink round StockpoolRounds needs: the first round of a feed updated at or after a time `t`, i.e. the
// one whose predecessor was updated before `t`. Rounds of one feed phase are numbered 1, 2, 3... with updatedAt
// rising, so a binary search over the current phase finds it in a few reads.
const { ethers } = require("ethers");
const abis = require("./abis");

const PHASE_MASK = (1n << 64n) - 1n;

/** @returns {Promise<{id: bigint, answer: bigint, updatedAt: number} | null>} null while no round has reached `t`. */
async function firstRoundAtOrAfter(provider, feedAddress, t) {
  const feed = new ethers.Contract(feedAddress, abis.Aggregator, provider);
  const latest = await feed.latestRoundData();
  if (Number(latest.updatedAt) < t) return null;
  const phase = latest.roundId >> 64n;
  const at = async (n) => {
    try {
      const r = await feed.getRoundData((phase << 64n) | n);
      return Number(r[3]);
    } catch {
      return 0; // a missing round counts as older than anything
    }
  };
  // Invariant: round `lo` is older than t (or does not exist), round `hi` is at or after t.
  let lo = 0n;
  let hi = latest.roundId & PHASE_MASK;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if ((await at(mid)) >= t) hi = mid;
    else lo = mid;
  }
  // The contract cannot check the first round of a phase (it has no predecessor in the same phase).
  if (hi <= 1n) return { id: (phase << 64n) | hi, unusable: "first round of a feed phase" };
  const id = (phase << 64n) | hi;
  const r = await feed.getRoundData(id);
  return { id, answer: r[1], updatedAt: Number(r[3]) };
}

module.exports = { firstRoundAtOrAfter };
