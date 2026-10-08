// Writes what the website needs from a deployment into app/src/generated/deployment.json: every address, the Pools,
// the credit lines, the Basket and the token once set. Run by launch.sh and set-token.sh.
//   node scripts/export-web.js [robinhood|keeper|localhost]
const fs = require("fs");
const path = require("path");

const network = process.argv[2] || "robinhood";
const dep = path.join(__dirname, "..", "deployments", `${network}.json`);
const out = path.join(__dirname, "..", "..", "app", "src", "generated", "deployment.json");
if (!fs.existsSync(dep)) throw new Error(`No ${path.relative(process.cwd(), dep)}`);
const d = JSON.parse(fs.readFileSync(dep, "utf8"));
const site = {
  chainId: d.chainId,
  block: d.block,
  usdg: d.usdg,
  timelock: d.timelock,
  swapAdapter: d.swapAdapter,
  buyBurn: d.buyBurn,
  oracle: d.oracle,
  feeRouter: d.feeRouter,
  registry: d.registry,
  basket: d.basket,
  token: d.token || null,
  tokenSymbol: d.tokenSymbol || null,
  pools: Object.fromEntries(
    Object.entries(d.liquidityVaults).map(([t, w]) => [t, { vault: w.vault, position: w.position, stock: w.stock, name: w.name, feed: d.markets[t] && d.markets[t].feed }]),
  ),
  creditLines: d.creditLines,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(site, null, 2) + "\n");
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
