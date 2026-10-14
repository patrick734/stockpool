// The rounds' fees arrive in BuyBurn as Stock Tokens. The keeper sells them for $SPOOL through the swap adapter and
// BuyBurn burns what it bought. BuyBurn allows at most one buy per minInterval, each capped per input token.
const { ethers } = require("ethers");
const abis = require("../abis");
const { exec, reason, blockTime } = require("../chain");
const { logger } = require("../log");
const { buildRoute } = require("../routes");

const BPS = 10_000n;

function feeTokens(ctx) {
  return Object.entries(ctx.dep.series || {}).map(([symbol, s]) => ({ symbol, address: ethers.getAddress(s.token) }));
}

function symbolOf(ctx, a) {
  if (a === ethers.ZeroAddress) return "ETH";
  if (ctx.dep.usdg && a.toLowerCase() === String(ctx.dep.usdg).toLowerCase()) return "USDG";
  if (a.toLowerCase() === String(ctx.dep.token).toLowerCase()) return ctx.dep.tokenSymbol || "SPOOL";
  for (const [t, s] of Object.entries(ctx.dep.series || {})) if (a.toLowerCase() === s.token.toLowerCase()) return t;
  return a;
}

async function runBuyBurn(ctx) {
  const log = logger("buyburn", "BuyBurn");
  const cfg = ctx.cfg.buyBurn;
  if (!cfg.enabled || !ctx.dep.buyBurn) return;
  const bb = new ethers.Contract(ctx.dep.buyBurn, abis.BuyBurn, ctx.runner);
  if (!(await bb.hasRole(await bb.KEEPER_ROLE(), ctx.keeper))) return log.warn("keeper lacks KEEPER_ROLE on BuyBurn; skipping", { keeper: ctx.keeper });
  if (await bb.halted()) return log.info("halted by the guardian, skipping");
  if (!ctx.dep.token) {
    const t = await bb.token();
    if (t === ethers.ZeroAddress) return log.info("$SPOOL not set yet; fees wait in BuyBurn");
    ctx.dep.token = t;
  }
  const [last, interval, now] = await Promise.all([bb.lastRun(), bb.minInterval(), blockTime(ctx.provider)]);
  if (now < last + interval) return log.info("rate limited by minInterval", { nextInSec: last + interval - now });

  const candidates = [];
  for (const t of feeTokens(ctx)) {
    const erc = new ethers.Contract(t.address, abis.ERC20, ctx.provider);
    const [bal, cap] = await Promise.all([erc.balanceOf(ctx.dep.buyBurn), bb.maxInputPerRun(t.address)]);
    if (bal === 0n) continue;
    if (cap === 0n) {
      log.warn("fees held but maxInputPerRun is 0; the owner must set a limit", { token: t.symbol, balance: bal });
      continue;
    }
    candidates.push({ ...t, amount: bal < cap ? bal : cap });
  }
  if (!candidates.length) return log.info("no fees waiting");
  candidates.sort((a, b) => (a.amount > b.amount ? -1 : 1));

  for (const c of candidates) {
    const tlog = logger("buyburn", c.symbol);
    let route, hops;
    try {
      const spec = cfg.routes[c.symbol] ?? cfg.defaultRoute;
      ({ route, path: hops } = buildRoute(ctx, spec, c.address, ctx.dep.token));
    } catch (e) {
      tlog.error("bad route config", { reason: e.message });
      continue;
    }
    const pathText = hops ? hops.map((a) => symbolOf(ctx, a)).join("->") : "adapter-default";
    // Quote by simulating the real call with minOut = 1: it returns exactly what the swap delivers.
    let quoted;
    try {
      quoted = await bb.buyAndBurn.staticCall(c.address, c.amount, 1n, route, { from: ctx.keeper });
    } catch (e) {
      tlog.warn("quote failed, skipping this token", { amountIn: c.amount, path: pathText, reason: reason(e) });
      continue;
    }
    const minOut = (quoted * (BPS - BigInt(cfg.slippageBps))) / BPS;
    if (minOut === 0n) continue;
    tlog.info("buying and burning", { amountIn: ethers.formatEther(c.amount), path: pathText, quoted: ethers.formatEther(quoted) });
    const r = await exec(ctx, tlog, bb, "buyAndBurn", [c.address, c.amount, minOut, route], "buyAndBurn");
    if (r.ok) return; // one buy per minInterval
  }
}

module.exports = { runBuyBurn };
