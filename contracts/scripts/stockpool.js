// Deploys Stockpool (Shield & Boost) from one wallet. Shared by deploy.js (the real deploy, a fork rehearsal and the
// local demo).
//
//   StockpoolSwapAdapter   the Uniswap v4 pools BuyBurn may swap through (Stock Token -> USDG -> ETH -> $SPOOL)
//   StockpoolBuyBurn       spends the rounds' fees on $SPOOL and burns it; no withdraw function
//   StockpoolRounds        Shield & Boost: one series per Stock Token, a new round every week
//
// The dev wallet owns all three. The keeper is a separate wallet: it opens, locks and settles rounds and runs BuyBurn.
// Every step is checked on chain before it is sent and every new address is saved the moment it exists, so a run that
// stops halfway (a dropped RPC connection) continues where it stopped when started again.
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const config = require("../config/robinhood.json");
const { nextLockAt } = require("../lib/schedule");

const L = config.launch;
const ADMIN = ethers.ZeroHash;
const wad = (n) => ethers.parseEther(String(n));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const DEMO_PRICES = { NVDA: 180.12, TSLA: 378.34, AAPL: 236.31, META: 740.25, GOOGL: 245.6, MSFT: 512.4, SPY: 662.1 };

function poolKey(a, b, fee, tickSpacing) {
  const [currency0, currency1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return { currency0, currency1, fee, tickSpacing, hooks: ethers.ZeroAddress };
}

/**
 * @param {object} o
 * @param {import("ethers").Signer} o.signer  the dev wallet (live), its impersonation (fork) or a local account
 * @param {{admin: string, guardian: string, keeper: string}} o.roles
 * @param {boolean} o.live                     real Stock Tokens, Chainlink feeds and Uniswap pools
 * @param {string} o.progressFile              where addresses are saved as they appear
 * @param {string|null} o.token                $SPOOL if it already exists, else null (set later with set-token.sh)
 */
async function deployStockpool({ signer, roles, live, progressFile, token = null }) {
  const progress = fs.existsSync(progressFile) ? JSON.parse(fs.readFileSync(progressFile, "utf8")) : {};
  const remember = (k, v) => {
    progress[k] = v;
    fs.mkdirSync(path.dirname(progressFile), { recursive: true });
    fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2) + "\n");
  };
  if (progress.block === undefined) remember("block", await ethers.provider.getBlockNumber());
  let sent = 0;
  const tx = async (p) => {
    sent++;
    return (await p).wait();
  };
  async function contract(keyName, name, args) {
    if (progress[keyName]) {
      // Never deploy a second copy of something already recorded: a missing contract here means a bad RPC answer.
      if ((await ethers.provider.getCode(progress[keyName])) === "0x")
        throw new Error(`${name} ${progress[keyName]} is recorded but the RPC shows no code there. Run again in a minute.`);
      console.log(`  ${name.padEnd(22)} ${progress[keyName]} (already deployed)`);
      return ethers.getContractAt(name, progress[keyName], signer);
    }
    const c = await (await ethers.getContractFactory(name, signer)).deploy(...args);
    await c.waitForDeployment();
    sent++;
    const a = await c.getAddress();
    remember(keyName, a);
    console.log(`  ${name.padEnd(22)} ${a}`);
    return c;
  }

  const me = await signer.getAddress();
  if (!same(me, roles.admin)) throw new Error(`Deploy from the dev wallet ${roles.admin}, not ${me}.`);
  if (same(roles.keeper, roles.admin)) throw new Error("The keeper must be a separate wallet from the dev wallet.");
  const env = live ? liveEnv() : await localEnv(signer, progress, remember);
  console.log(`Deploying Stockpool from ${me}`);

  // ---------------------------------------------------------------- the burn side
  const swap = live
    ? await contract("swapAdapter", "StockpoolSwapAdapter", [me, config.uniswap.poolManager, env.usdg])
    : await ethers.getContractAt("MockSwapAdapter", env.swap, signer);
  if (live) {
    if (!(await swap.hookAllowed(config.pons.hook))) await tx(swap.setHookAllowed(config.pons.hook, true));
    const [, ethPool] = await swap.poolFor(ethers.ZeroAddress, env.usdg);
    const e = config.uniswap.ethUsdgPool;
    if (!ethPool) await tx(swap.setPool({ currency0: ethers.ZeroAddress, currency1: env.usdg, fee: e.fee, tickSpacing: e.tickSpacing, hooks: ethers.ZeroAddress }));
  }
  const buyBurn = await contract("buyBurn", "StockpoolBuyBurn", [
    token ?? ethers.ZeroAddress,
    await swap.getAddress(),
    me,
    roles.guardian,
    roles.keeper,
    L.buyBurnMinIntervalSeconds,
    token ? ethers.ZeroAddress : me,
  ]);
  if (!(await buyBurn.hasRole(ADMIN, me))) throw new Error("This wallet is not BuyBurn's admin.");

  // ---------------------------------------------------------------- Shield & Boost
  const rounds = await contract("rounds", "StockpoolRounds", [me, roles.keeper, await buyBurn.getAddress()]);
  if (!same(await rounds.owner(), me)) throw new Error("This wallet does not own StockpoolRounds.");
  if (!same(await rounds.operator(), roles.keeper)) await tx(rounds.setOperator(roles.keeper));

  const R = L.rounds;
  const listed = Number(await rounds.seriesCount());
  const bySeries = [];
  for (let i = 0; i < listed; i++) bySeries.push(await rounds.series(i));
  const series = {};
  console.log("Series");
  for (const t of L.series) {
    const m = env.markets[t];
    if (!m) {
      console.log(`  ${t.padEnd(6)} skipped: no Stock Token or Chainlink feed in the config`);
      continue;
    }
    let id = bySeries.findIndex((s) => same(s.token, m.token));
    if (id < 0) {
      id = Number(await rounds.seriesCount()); // series ids are list positions
      await tx(rounds.listSeries(m.token, m.feed, R.couponBps, R.feeBps, R.maxRatioBps, R.durationDays * 86400, wad(R.minDeposit)));
      bySeries.push(await rounds.series(id));
    }
    // Fees arrive in the Stock Token: BuyBurn sells them through the stock's USDG pool.
    if (live && m.pool) {
      const [, exists] = await swap.poolFor(m.token, env.usdg);
      if (!exists) await tx(swap.setPool(poolKey(m.token, env.usdg, m.pool.fee, m.pool.tickSpacing)));
    }
    if ((await buyBurn.maxInputPerRun(m.token)) !== wad(L.buyBurnMaxStockPerRun)) await tx(buyBurn.setInputLimit(m.token, wad(L.buyBurnMaxStockPerRun)));
    series[t] = { id, token: m.token, feed: m.feed, name: m.name, sellable: Boolean(!live || m.pool) };
    console.log(`  ${t.padEnd(6)} series ${id}${live && !m.pool ? " (no USDG pool yet: its fees wait in BuyBurn)" : ""}`);
  }
  if (!Object.keys(series).length) throw new Error("No series could be listed.");

  // ---------------------------------------------------------------- first rounds
  const now = Number((await ethers.provider.getBlock("latest")).timestamp);
  const lockAt = nextLockAt(now);
  for (const [t, s] of Object.entries(series)) {
    const sr = await rounds.series(s.id);
    if (sr.lastRound !== 0n) continue;
    await tx(rounds.openRound(s.id, lockAt));
    console.log(`  ${t.padEnd(6)} round open, deposits close ${new Date(lockAt * 1000).toUTCString()}`);
  }

  const d = {
    network: live ? "robinhood" : "local",
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    roles,
    owner: me,
    block: progress.block,
    swapAdapter: await swap.getAddress(),
    buyBurn: await buyBurn.getAddress(),
    rounds: await rounds.getAddress(),
    usdg: env.usdg,
    token,
    tokenSetter: token ? null : me,
    series,
  };
  console.log(`  ${Object.keys(series).length} series (${sent} transactions this run)`);
  return { d, sent, env };
}

/** The live markets: Stock Tokens, their Chainlink feeds and the hookless USDG pools probe-pools found. */
function liveEnv() {
  const pools = require("../config/robinhood.pools.json");
  const markets = {};
  for (const t of L.series) {
    const s = config.stockTokens[t];
    if (!s || !s.chainlinkFeed) continue;
    const p = pools[t] && pools[t].pool;
    const usable = p && p.liquidity && BigInt(p.liquidity) >= BigInt(L.poolMinLiquidity);
    markets[t] = { token: s.address, feed: s.chainlinkFeed, name: s.name, pool: usable ? { fee: p.fee, tickSpacing: p.tickSpacing } : null };
  }
  return { usdg: config.tokens.usdg.address, markets };
}

/** Local demo: mock Stock Tokens and feeds, and a mock swap venue that sells them for the demo $SPOOL. */
async function localEnv(signer, progress, remember) {
  if (progress.localEnv) return progress.localEnv;
  const deploy = async (name, args) => {
    const c = await (await ethers.getContractFactory(name, signer)).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const usdg = await deploy("MockERC20", ["Global Dollar", "USDG", 6]);
  const swap = await deploy("MockSwapAdapter", []);
  const markets = {};
  for (const t of L.series) {
    const price = DEMO_PRICES[t];
    if (!price) continue;
    const name = config.stockTokens[t].name;
    const stock = await deploy("MockStockToken", [name, t]);
    const feed = await deploy("MockAggregator", [8, Math.round(price * 1e8)]);
    markets[t] = { token: await stock.getAddress(), feed: await feed.getAddress(), name, price };
  }
  const env = { usdg: await usdg.getAddress(), swap: await swap.getAddress(), markets };
  remember("localEnv", env);
  return env;
}

module.exports = { deployStockpool, poolKey, DEMO_PRICES };
