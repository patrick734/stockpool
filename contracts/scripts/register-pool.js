// Registers the Stockpool token's Pons pool (token / ETH) on the swap adapter once the token has graduated on Pons,
// which is what lets BuyBurn buy and burn it. Checks the pool is live first. Read-only; sends nothing.
// Prints the one transaction the dev wallet (the adapter's owner) sends; ./govern.sh register-pool sends it.
//   node scripts/register-pool.js [deployments/robinhood.json]
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const config = require("../config/robinhood.json");

const RPC = process.env.ROBINHOOD_RPC_URL || config.network.rpcUrl;
const POOLS_SLOT = 6n;
const ADAPTER_ABI = [
  "function setPool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)",
  "function poolFor(address a, address b) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, bool exists)",
  "function hookAllowed(address) view returns (bool)",
  "function owner() view returns (address)",
];

// Inspects the pool and adapter for deployment `d` and builds the registration transaction(s).
// Returns { status, ... } where status is one of: not-initialized, no-liquidity, hook-not-allowed, registered,
// or direct (the transaction for the dev wallet).
async function plan(provider, d) {
  if (!d.token) {
    // The file may predate set-token; the contract is the source of truth.
    const bb = new ethers.Contract(d.buyBurn, ["function token() view returns (address)"], provider);
    const onchain = await bb.token();
    if (onchain === ethers.ZeroAddress) throw new Error("The token is not set yet. Run ./set-token.sh first.");
    d = { ...d, token: onchain };
  }
  const adapter = new ethers.Contract(d.swapAdapter, ADAPTER_ABI, provider);
  const pm = new ethers.Contract(config.uniswap.poolManager, ["function extsload(bytes32) view returns (bytes32)"], provider);
  const key = { currency0: ethers.ZeroAddress, currency1: d.token, fee: config.pons.poolFee, tickSpacing: config.pons.poolTickSpacing, hooks: config.pons.hook };
  const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
  const slot = ethers.keccak256(ethers.concat([id, ethers.toBeHex(POOLS_SLOT, 32)]));
  const sqrtP = BigInt(await pm.extsload(slot)) & ((1n << 160n) - 1n);
  const liquidity = BigInt(await pm.extsload(ethers.toBeHex(BigInt(slot) + 3n, 32))) & ((1n << 128n) - 1n);
  const raw = Number(sqrtP) / 2 ** 96;
  const base = { id, key, perEth: raw * raw, liquidity, token: d.token };
  if (sqrtP === 0n) return { status: "not-initialized", ...base };
  if (liquidity === 0n) return { status: "no-liquidity", ...base };
  if (!(await adapter.hookAllowed(config.pons.hook))) return { status: "hook-not-allowed", ...base };
  const [, exists] = await adapter.poolFor(ethers.ZeroAddress, d.token);
  if (exists) return { status: "registered", ...base };

  const setPool = adapter.interface.encodeFunctionData("setPool", [key]);
  const owner = await adapter.owner();
  return { status: "direct", owner, tx: { to: d.swapAdapter, value: "0", data: setPool }, ...base };
}

async function main() {
  const file = path.resolve(process.argv[2] || path.join(__dirname, "..", "deployments", "robinhood.json"));
  if (!fs.existsSync(file)) throw new Error(`No deployment file at ${file}. Deploy first.`);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC, config.network.chainId, { staticNetwork: true });
  const p = await plan(provider, d);
  console.log(`Token ${p.token}\nPons pool ${p.id}`);
  switch (p.status) {
    case "not-initialized":
      throw new Error("The token / ETH Pons pool is not initialized yet: the token has not graduated. Run this again after graduation.");
    case "no-liquidity":
      throw new Error("The Pons pool exists but has no liquidity yet. Run this again once graduation finishes.");
    case "hook-not-allowed":
      throw new Error(`The adapter does not allow the Pons hook ${config.pons.hook}; allow it first (deploy.js does this on live deploys).`);
  }
  console.log(`  live: ${p.perEth.toFixed(0)} tokens per ETH, liquidity ${p.liquidity}`);
  if (p.status === "registered") return console.log("Already registered on the adapter. Nothing to do.");
  console.log(`\nThe adapter's owner ${p.owner} sends this (./govern.sh register-pool):`);
  console.log(JSON.stringify(p.tx, null, 2));
}

module.exports = { plan };

if (require.main === module) {
  main().catch((e) => {
    console.error(e.shortMessage || e.message);
    process.exit(1);
  });
}
