// ABIs come from the Hardhat build output in contracts/artifacts (run `npx hardhat compile` in contracts/ first), so
// the keeper always matches the Solidity source. KEEPER_ARTIFACTS_DIR overrides the location (the folder that
// contains `src/`).
const fs = require("fs");
const path = require("path");
const { CONTRACTS } = require("./config");

const DIR = process.env.KEEPER_ARTIFACTS_DIR || path.join(CONTRACTS, "artifacts");

const FILES = {
  Rounds: "src/StockpoolRounds.sol/StockpoolRounds.json",
  BuyBurn: "src/StockpoolBuyBurn.sol/StockpoolBuyBurn.json",
  SwapAdapter: "src/v4/StockpoolSwapAdapter.sol/StockpoolSwapAdapter.json",
};

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const AGGREGATOR = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

function load(name) {
  const file = path.join(DIR, FILES[name]);
  if (!fs.existsSync(file)) throw new Error(`Missing ABI artifact ${file}. Run \`npx hardhat compile\` in contracts/ first.`);
  return JSON.parse(fs.readFileSync(file, "utf8")).abi;
}

const abis = Object.fromEntries(Object.keys(FILES).map((n) => [n, load(n)]));
abis.ERC20 = ERC20;
abis.Aggregator = AGGREGATOR;

module.exports = abis;
