// Deploys all of Stockpool from one wallet. Shared by deploy.js (the real deploy and the local demo) and rehearse.js
// (a local copy of Robinhood Chain).
//
//   StockpoolTimelock      48h: admin of every Pool, credit line and the Basket, owner of the fee router, and (after
//                          ./govern.sh handoff) of the swap adapter, oracle and registry
//   StockpoolSwapAdapter   the Uniswap v4 pools the protocol may swap through
//   StockpoolBuyBurn       spends protocol fees on $SPOOL and burns it; no withdraw function
//   StockpoolOracle        Chainlink prices for the Stock Tokens, in USDG
//   StockpoolFeeRouter     forwards the Pools' and credit lines' protocol share to BuyBurn
//   StockpoolRegistry      the on-chain list of Pools, credit lines and the Basket
//   StockpoolPosition      one per Pool: its range in the hookless Stock Token / USDG Uniswap v4 pool
//   StockpoolVault         one per Pool: USDG deposits kept in a range around the Chainlink price
//   StockpoolCreditDesk    one per credit line: lenders supply USDG, borrowers pledge Pool shares
//   StockpoolBasket        one deposit spread across the Pools
//
// Every step is checked on chain before it is sent and every new address is saved the moment it exists, so a run that
// stops halfway (a dropped RPC connection) continues where it stopped when started again.
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const config = require("../config/robinhood.json");

const L = config.launch;
const ADMIN = ethers.ZeroHash;
const usdgUnits = (n) => ethers.parseUnits(String(n), 6);
const wad = (n) => ethers.parseEther(String(n));
const send = async (p) => (await p).wait();
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const DEMO_PRICES = { NVDA: 180.12, TSLA: 378.34, AAPL: 236.31, META: 740.25, GOOGL: 245.6, MSFT: 512.4, SPY: 662.1 };

function poolKey(stock, usdg, fee, tickSpacing) {
  const [currency0, currency1] = BigInt(stock) < BigInt(usdg) ? [stock, usdg] : [usdg, stock];
  return { currency0, currency1, fee, tickSpacing, hooks: ethers.ZeroAddress };
}

/**
 * @param {object} o
 * @param {import("ethers").Signer} o.signer  the dev wallet (live), its impersonation (rehearsal) or a local account
 * @param {{admin: string, guardian: string, keeper: string}} o.roles
 * @param {boolean} o.live                     real Uniswap pools and Chainlink feeds (live and rehearsal)
 * @param {string} o.progressFile              where addresses are saved as they appear
 * @param {string|null} o.token                $SPOOL if it already exists, else null (set later with set-token.sh)
 * @param {object} [o.chain]                   tests only: { usdg, markets, usdgFeed, sequencerFeed, uniswap, pools, lines, swap }
 * @returns {Promise<{d: object, sent: number}>} the deployment record
 */
async function deployStockpool({ signer, roles, live, progressFile, token = null, chain }) {
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
    return send(p);
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
  const env = chain || (live ? liveEnv() : await localEnv(signer, progress, remember));
  const uniswap = (chain && chain.uniswap) || config.uniswap;
  console.log(`Deploying Stockpool from ${me}`);

  // ---------------------------------------------------------------- governance and the burn side
  const timelock = await contract("timelock", "StockpoolTimelock", [live ? L.timelockDelaySeconds : 60, [roles.admin], [roles.admin], ethers.ZeroAddress]);
  const tl = await timelock.getAddress();

  const swap = live
    ? await contract("swapAdapter", "StockpoolSwapAdapter", [me, uniswap.poolManager, env.usdg])
    : await ethers.getContractAt("MockSwapAdapter", env.swap, signer);
  const ownsSwap = live && same(await swap.owner(), me);
  if (live && ownsSwap) {
    if (!(await swap.hookAllowed(config.pons.hook))) await tx(swap.setHookAllowed(config.pons.hook, true));
    const [, ethPool] = await swap.poolFor(ethers.ZeroAddress, env.usdg);
    const e = config.uniswap.ethUsdgPool;
    if (!ethPool) await tx(swap.setPool({ currency0: ethers.ZeroAddress, currency1: env.usdg, fee: e.fee, tickSpacing: e.tickSpacing, hooks: ethers.ZeroAddress }));
  }

  const pendingToken = !token;
  const buyBurn = await contract("buyBurn", "StockpoolBuyBurn", [
    token ?? ethers.ZeroAddress,
    await swap.getAddress(),
    me,
    roles.guardian,
    roles.keeper,
    L.buyBurnMinIntervalSeconds,
    pendingToken ? me : ethers.ZeroAddress,
  ]);
  const bbAdmin = await buyBurn.hasRole(ADMIN, me);
  const limit = async (input, amount) => {
    if ((await buyBurn.maxInputPerRun(input)) === amount) return;
    if (!bbAdmin) throw new Error("BuyBurn already belongs to the timelock; set input limits through it.");
    await tx(buyBurn.setInputLimit(input, amount));
  };
  await limit(env.usdg, usdgUnits(L.buyBurnMaxUsdgPerRun));

  const oracle = await contract("oracle", "StockpoolOracle", [me, env.sequencerFeed, env.usdgFeed, config.chainlink.usdgMaxAge, config.tokens.usdg.decimals]);
  const feeRouter = await contract("feeRouter", "StockpoolFeeRouter", [tl, await buyBurn.getAddress()]);
  const registry = await contract("registry", "StockpoolRegistry", [me]);

  const d = {
    network: live ? "robinhood" : "local",
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    roles,
    block: progress.block,
    timelock: tl,
    swapAdapter: await swap.getAddress(),
    buyBurn: await buyBurn.getAddress(),
    usdg: env.usdg,
    token: token,
    tokenSetter: pendingToken ? me : null,
    oracle: await oracle.getAddress(),
    feeRouter: await feeRouter.getAddress(),
    registry: await registry.getAddress(),
    stocks: {},
    markets: {},
    liquidityVaults: {},
    creditLines: {},
  };

  // ---------------------------------------------------------------- Pools
  console.log("Pools");
  const tickers = (chain && chain.pools) || L.pools;
  const oracleOwned = same(await oracle.owner(), me);
  for (const t of tickers) {
    const m = env.markets[t];
    if (!m) continue;
    if (!same(await oracle.feedOf(m.token), m.feed)) {
      if (!oracleOwned) throw new Error("The oracle already belongs to the timelock; set feeds through it.");
      await tx(oracle.setFeed(m.token, m.feed, config.chainlink.stockMaxAge));
    }
    if (live) {
      // The Pool sells and buys its Stock Token through the swap adapter's registered pool.
      const [key, exists] = await swap.poolFor(m.token, env.usdg);
      if (!exists) {
        if (!ownsSwap) {
          console.log(`  ${t.padEnd(6)} skipped: no ${t}/USDG pool on the swap adapter, which the timelock now owns`);
          continue;
        }
        await tx(swap.setPool(poolKey(m.token, env.usdg, m.fee, m.tickSpacing)));
      } else if (Number(key.fee) !== Number(m.fee) || Number(key.tickSpacing) !== Number(m.tickSpacing)) {
        console.log(`  ${t.padEnd(6)} note: the range sits in the ${m.fee}/${m.tickSpacing} pool and swaps use the ${key.fee}/${key.tickSpacing} pool`);
      }
    }
    // Pool fees arrive in USDG and in the Stock Token: BuyBurn takes both.
    await limit(m.token, wad(L.buyBurnMaxStockPerRun));
    const position = live
      ? await contract(`position.${t}`, "StockpoolPosition", [uniswap.poolManager, uniswap.positionManager, uniswap.permit2, d.oracle, poolKey(m.token, env.usdg, m.fee, m.tickSpacing), m.token, env.usdg])
      : await contract(`position.${t}`, "MockPosition", [m.token, env.usdg, usdgUnits(DEMO_PRICES[t])]);
    const vault = await contract(`vault.${t}`, "StockpoolVault", [
      {
        usdg: env.usdg,
        stock: m.token,
        position: await position.getAddress(),
        oracle: d.oracle,
        swapAdapter: d.swapAdapter,
        feeRouter: d.feeRouter,
        admin: tl,
        guardian: roles.guardian,
        keeper: roles.keeper,
        heldValueCap: usdgUnits(L.poolCapUsdg),
      },
      `Stockpool ${t} Pool`,
      `sp${t}`,
    ]);
    if (!same(await vault.position(), await position.getAddress())) throw new Error(`The ${t} vault is not tied to its recorded position.`);
    if (same(await position.vault(), ethers.ZeroAddress)) await tx(position.bind(vault));
    if (!same(await position.vault(), await vault.getAddress())) throw new Error(`The ${t} position is bound to another vault.`);
    if ((await registry.indexPlusOne(vault)) === 0n) await tx(registry.list(vault, 0, t));
    d.stocks[t] = { token: m.token, name: m.name };
    d.markets[t] = { token: m.token, feed: m.feed, name: m.name };
    d.liquidityVaults[t] = { vault: await vault.getAddress(), position: await position.getAddress(), stock: m.token, name: m.name };
  }
  const pools = Object.keys(d.liquidityVaults);
  if (!pools.length) throw new Error("No Pool could be deployed.");
  console.log(`  ${pools.join(" ")}`);

  // ---------------------------------------------------------------- credit lines
  const cl = L.creditLine;
  for (const t of (chain && chain.lines) || L.creditLines) {
    if (!d.liquidityVaults[t]) {
      console.log(`  ${t} credit line skipped: no ${t} Pool`);
      continue;
    }
    const desk = await contract(`creditLine.${t}`, "StockpoolCreditDesk", [
      d.liquidityVaults[t].vault,
      d.feeRouter,
      tl,
      roles.guardian,
      cl.risk,
      { baseRatePerYear: wad(cl.rates.baseRatePerYear), slope1PerYear: wad(cl.rates.slope1PerYear), slope2PerYear: wad(cl.rates.slope2PerYear), kinkUtilization: wad(cl.rates.kinkUtilization) },
      usdgUnits(cl.supplyCapUsdg),
      usdgUnits(cl.borrowCapUsdg),
      `Stockpool ${t} Credit Line`,
      `sc${t}`,
    ]);
    if ((await registry.indexPlusOne(desk)) === 0n) await tx(registry.list(desk, 1, t));
    d.creditLines[t] = await desk.getAddress();
  }
  console.log(`Credit lines: ${Object.keys(d.creditLines).join(" ")}`);

  // ---------------------------------------------------------------- Basket
  const basket = await contract("basket", "StockpoolBasket", [
    env.usdg,
    tl,
    roles.guardian,
    roles.keeper,
    pools.slice(0, 8).map((t) => d.liquidityVaults[t].vault),
    usdgUnits(L.basket.capUsdg),
    "Stockpool Basket",
    "spBASKET",
  ]);
  d.basket = await basket.getAddress();
  if ((await registry.indexPlusOne(basket)) === 0n) await tx(registry.list(basket, 2, "BASKET"));

  // ---------------------------------------------------------------- hand settings to the timelock
  console.log("Handing governance to the timelock");
  if (await buyBurn.hasRole(ADMIN, me)) {
    if (!(await buyBurn.hasRole(ADMIN, tl))) await tx(buyBurn.grantRole(ADMIN, tl));
    await tx(buyBurn.renounceRole(ADMIN, me));
  }
  const ownables = live ? [swap, oracle, registry] : [oracle, registry];
  for (const c of ownables) {
    const [owner, pending] = await Promise.all([c.owner(), c.pendingOwner()]);
    if (!same(owner, tl) && !same(pending, tl)) await tx(c.transferOwnership(tl));
  }
  d.pendingTimelockAcceptances = await Promise.all(ownables.map((c) => c.getAddress()));
  console.log(`  ${pools.length} Pools, ${Object.keys(d.creditLines).length} credit lines and the Basket (${sent} transactions this run)`);
  return { d, sent, env };
}

/** The live markets: Chainlink feeds and the hookless pools probe-pools found (config/robinhood.pools.json). */
function liveEnv() {
  const pools = require("../config/robinhood.pools.json");
  const markets = {};
  for (const t of L.pools) {
    const s = config.stockTokens[t];
    if (!s) throw new Error(`Unknown stock ${t} in config/robinhood.json`);
    const p = pools[t] && pools[t].pool;
    if (!p || !p.liquidity || BigInt(p.liquidity) < BigInt(L.poolMinLiquidity)) {
      console.log(`  ${t.padEnd(6)} skipped: no hookless ${t}/USDG pool with enough liquidity right now`);
      continue;
    }
    // A Pool's swaps may lose at most 1% against Chainlink, so a pool whose fee alone is near that can never be used.
    if (Number(p.fee) > L.poolMaxFee) {
      console.log(`  ${t.padEnd(6)} skipped: its pool charges ${Number(p.fee) / 10_000}% a swap, too close to the 1% swap-loss limit`);
      continue;
    }
    markets[t] = { token: s.address, feed: s.chainlinkFeed, name: s.name, fee: p.fee, tickSpacing: p.tickSpacing };
  }
  return { usdg: config.tokens.usdg.address, usdgFeed: config.chainlink.usdgUsdFeed, sequencerFeed: config.chainlink.sequencerUptimeFeed || ethers.ZeroAddress, markets };
}

/** Local demo: mock USDG, Stock Tokens, feeds and a mock swap venue that trades them at fixed prices. */
async function localEnv(signer, progress, remember) {
  if (progress.localEnv) return progress.localEnv;
  const deploy = async (name, args) => {
    const c = await (await ethers.getContractFactory(name, signer)).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const usdg = await deploy("MockERC20", ["Global Dollar", "USDG", 6]);
  const usdgFeed = await deploy("MockAggregator", [8, 100_000_000]);
  const swap = await deploy("MockSwapAdapter", []);
  await send(usdg.mint(swap, usdgUnits(100_000_000)));
  const markets = {};
  for (const t of L.pools) {
    const price = DEMO_PRICES[t];
    const name = config.stockTokens[t].name;
    const stock = await deploy("MockStockToken", [name, t]);
    const feed = await deploy("MockAggregator", [8, Math.round(price * 1e8)]);
    await send(stock.mint(swap, wad(1_000_000)));
    await send(swap.setRate(stock, usdg, usdgUnits(price)));
    await send(swap.setRate(usdg, stock, 10n ** 36n / usdgUnits(price)));
    markets[t] = { token: await stock.getAddress(), feed: await feed.getAddress(), name };
  }
  const env = { usdg: await usdg.getAddress(), usdgFeed: await usdgFeed.getAddress(), sequencerFeed: ethers.ZeroAddress, swap: await swap.getAddress(), markets };
  remember("localEnv", env);
  return env;
}

module.exports = { deployStockpool, poolKey, DEMO_PRICES };
