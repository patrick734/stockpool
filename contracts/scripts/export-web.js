// Writes what the website needs from a deployment into app/src/generated/deployment.json: the addresses, every series
// and the token once set. Run by launch.sh and set-token.sh.
//   node scripts/export-web.js [robinhood|localhost|hardhat]
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
  owner: d.owner,
  keeper: d.roles && d.roles.keeper,
  swapAdapter: d.swapAdapter,
  buyBurn: d.buyBurn,
  rounds: d.rounds,
  token: d.token || null,
  tokenSymbol: d.tokenSymbol || null,
  series: d.series,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(site, null, 2) + "\n");
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
