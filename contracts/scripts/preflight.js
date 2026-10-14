// Read-only launch checks. Sends nothing and never needs a private key.
// Usage: node scripts/preflight.js
// Env: KEEPER_ADDRESS, DEPLOYER_ADDRESS, TOKEN_ADDRESS (optional),
//      DEPLOYER_ADDRESS (optional, for the gas balance check), ROBINHOOD_RPC_URL (optional).
// Exits 1 if any check fails, so a launch script can stop before deploying.
const { ethers } = require("ethers");
const config = require("../config/robinhood.json");
const pools = require("../config/robinhood.pools.json");

const RPC = process.env.ROBINHOOD_RPC_URL || config.network.rpcUrl;
const MIN_DEPLOYER_ETH = ethers.parseEther(process.env.MIN_DEPLOYER_ETH || "0.01");

let failed = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const warn = (msg) => console.log(`  warn  ${msg}`);
const fail = (msg) => {
  failed++;
  console.log(`  FAIL  ${msg}`);
};

async function withRetry(fn, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, config.network.chainId, { staticNetwork: true });

  console.log("Network");
  const chainId = await withRetry(() => provider.send("eth_chainId", []));
  if (BigInt(chainId) === BigInt(config.network.chainId)) ok(`chainId ${BigInt(chainId)} (Robinhood Chain)`);
  else fail(`chainId ${BigInt(chainId)}, expected ${config.network.chainId}`);

  console.log("Roles");
  const roles = {};
  const k = process.env.KEEPER_ADDRESS;
  if (!k || !ethers.isAddress(k)) fail("KEEPER_ADDRESS is not set to an address");
  else {
    roles.KEEPER_ADDRESS = ethers.getAddress(k);
    ok(`keeper ${roles.KEEPER_ADDRESS}: opens, locks and settles rounds and runs BuyBurn`);
  }

  if (process.env.DEPLOYER_ADDRESS) {
    console.log("Deployer");
    const d = process.env.DEPLOYER_ADDRESS;
    if (!ethers.isAddress(d)) fail("DEPLOYER_ADDRESS is not an address");
    else {
      const bal = await withRetry(() => provider.getBalance(d));
      const msg = `${ethers.getAddress(d)} holds ${ethers.formatEther(bal)} ETH`;
      if (bal >= MIN_DEPLOYER_ETH) ok(msg);
      else fail(`${msg}, needs at least ${ethers.formatEther(MIN_DEPLOYER_ETH)} for gas`);
      if (Object.values(roles).includes(ethers.getAddress(d))) fail("the dev wallet must not be the keeper");
      else ok("the dev wallet owns StockpoolRounds, BuyBurn and the swap adapter");
    }
  }

  console.log("Token");
  const w = process.env.TOKEN_ADDRESS;
  if (!w) ok("no token yet: deploying first; plug it in after the Pons launch with ./set-token.sh");
  else if (!ethers.isAddress(w)) fail("TOKEN_ADDRESS is not an address");
  else {
    const t = new ethers.Contract(w, ["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)", "function burn(uint256)"], provider);
    try {
      const [symbol, decimals, supply] = await withRetry(() => Promise.all([t.symbol(), t.decimals(), t.totalSupply()]));
      if (decimals !== 18n) fail(`${symbol} has ${decimals} decimals, needs 18`);
      else ok(`${symbol} at ${ethers.getAddress(w)}, supply ${ethers.formatEther(supply)}`);
      // A real burn must refuse to burn more than the caller holds; a fallback would accept it.
      const over = await provider.call({ from: ethers.ZeroAddress.replace(/0$/, "1"), to: w, data: t.interface.encodeFunctionData("burn", [10n ** 30n]) }).then(() => true, () => false);
      const zero = await provider.call({ from: ethers.ZeroAddress.replace(/0$/, "1"), to: w, data: t.interface.encodeFunctionData("burn", [0n]) }).then(() => true, () => false);
      if (zero && !over) ok("burn(uint256) works, as BuyBurn requires");
      else fail("token has no working burn(uint256); BuyBurn cannot retire it");
    } catch (e) {
      fail(`could not read the token at ${w}: ${e.shortMessage || e.message}`);
    }
  }

  // Every series needs a Stock Token and its Chainlink feed. Fees are sold through the stock's USDG pool; a stock
  // without one still gets a series, its fees just wait in BuyBurn.
  console.log("Series (Chainlink feeds now; pools from probe-pools, which launch.sh runs right before this)");
  const feedAbi = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"];
  let usable = 0;
  for (const ticker of config.launch.series) {
    const s = config.stockTokens[ticker];
    if (!s || !s.chainlinkFeed) {
      fail(`${ticker}: no Stock Token or Chainlink feed in config.stockTokens`);
      continue;
    }
    try {
      const [, answer, , updatedAt] = await withRetry(() => new ethers.Contract(s.chainlinkFeed, feedAbi, provider).latestRoundData());
      const age = Math.round((Date.now() / 1000 - Number(updatedAt)) / 3600);
      const pool = pools[ticker] && pools[ticker].pool;
      const sellable = pool && pool.liquidity && BigInt(pool.liquidity) >= BigInt(config.launch.poolMinLiquidity);
      ok(`${ticker}: $${(Number(answer) / 1e8).toFixed(2)}, ${age}h old${sellable ? "" : " (no liquid USDG pool: its fees wait in BuyBurn)"}`);
      usable++;
    } catch (e) {
      fail(`${ticker}: could not read its Chainlink feed: ${e.shortMessage || e.message}`);
    }
  }
  if (!usable) fail("no series can be listed");

  console.log(failed ? `\n${failed} check(s) failed. Fix them before deploying.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("Preflight could not finish:", e.shortMessage || e.message);
  process.exit(1);
});
