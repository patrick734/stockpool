// Deploys Stockpool (Shield & Boost). See scripts/stockpool.js for what goes out.
//   Robinhood Chain (launch.sh):   npx hardhat run scripts/deploy.js --network robinhood
//   Rehearsal on a fork:           FORK=1 npx hardhat run scripts/deploy.js   (launch.sh --rehearsal)
//   Local demo (seeded):           npx hardhat run scripts/deploy.js --network localhost
// Live roles come from the environment launch.sh sets: DEPLOYER_ADDRESS (the dev wallet: owner of everything and
// BuyBurn's guardian) and KEEPER_ADDRESS. Started again after a dropped connection, it continues where it stopped.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { deployStockpool, DEMO_PRICES } = require("./stockpool");
const { nextLockAt } = require("../lib/schedule");

const FORK = network.name === "hardhat" && Boolean(process.env.FORK);
const LIVE = network.name === "robinhood" || FORK;
const wad = (n) => ethers.parseEther(String(n));
const send = async (p) => (await p).wait();

async function main() {
  const dir = path.join(__dirname, "..", "deployments");
  const label = FORK ? "fork" : network.name;
  const file = path.join(dir, `${label}.json`);
  const progressFile = path.join(dir, `${label}.progress.json`);
  if (FORK) fs.rmSync(progressFile, { force: true });
  if (fs.existsSync(file) && !fs.existsSync(progressFile) && process.env.FORCE !== "1" && !FORK) {
    console.log(`Already deployed: ${path.relative(process.cwd(), file)}. Nothing to do.`);
    return;
  }
  const signers = await ethers.getSigners();
  let signer = signers[0];
  let roles;
  if (FORK) {
    // The rehearsal acts as the real dev wallet on a local copy of the chain: same addresses, nothing sent.
    const dev = required("DEPLOYER_ADDRESS");
    await network.provider.send("hardhat_setBalance", [dev, "0x56BC75E2D63100000"]);
    signer = await ethers.getImpersonatedSigner(dev);
    roles = { admin: dev, guardian: dev, keeper: required("KEEPER_ADDRESS") };
  } else if (LIVE) {
    if (!signer) throw new Error("No dev wallet signer: keystore ~/.foundry/keystores/stockpool-dev2 (or DEPLOYER_ACCOUNT) not found.");
    roles = { admin: signer.address, guardian: signer.address, keeper: required("KEEPER_ADDRESS") };
  } else {
    roles = { admin: signer.address, guardian: signer.address, keeper: signers[3].address };
  }

  const token = LIVE ? process.env.TOKEN_ADDRESS || null : null;
  const { d, env } = await deployStockpool({ signer, roles, live: LIVE, progressFile, token });
  if (!LIVE) await localToken(signer, d, env);
  if (!LIVE) await seedLocal(d, env, signers);
  if (FORK) await rehearse(d, signer);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
  fs.rmSync(progressFile, { force: true });
  console.log(`\nWrote ${path.relative(process.cwd(), file)}`);
}

function required(name) {
  const v = process.env[name];
  if (!v || !ethers.isAddress(v)) throw new Error(`${name} must be set to an address`);
  return ethers.getAddress(v);
}

/** Local demo token: $SPOOL on the mock venue, plugged into BuyBurn like set-token.sh does live. */
async function localToken(signer, d, env) {
  const t = await (await ethers.getContractFactory("MockERC20", signer)).deploy("Stockpool", "SPOOL", 18);
  await t.waitForDeployment();
  const swap = await ethers.getContractAt("MockSwapAdapter", env.swap, signer);
  await send(t.mint(signer.address, wad(1_000_000_000)));
  await send(t.mint(swap, wad(100_000_000)));
  for (const [ticker, m] of Object.entries(env.markets)) await send(swap.setRate(m.token, t, wad(Math.round(DEMO_PRICES[ticker] * 100))));
  const bb = await ethers.getContractAt("StockpoolBuyBurn", d.buyBurn, signer);
  await send(bb.setToken(t));
  d.token = await t.getAddress();
  d.tokenSymbol = "SPOOL";
  d.tokenName = "Stockpool";
  d.tokenSetter = null;
}

/** Gives the local demo a history: per stock, one settled round, one running and one open for deposits. */
async function seedLocal(d, env, signers) {
  const [dev, , , keeper, demo, other] = signers;
  console.log("Seeding the local demo");
  const rounds = await ethers.getContractAt("StockpoolRounds", d.rounds);
  const moves = { NVDA: 0.062, TSLA: -0.081, AAPL: 0.014, META: 0.037, GOOGL: -0.022, MSFT: 0.009, SPY: 0.011 };
  const stocks = {};
  for (const [t, s] of Object.entries(d.series)) {
    const stock = await ethers.getContractAt("MockStockToken", s.token);
    for (const who of [demo, other]) {
      await send(stock.mint(who.address, wad(500)));
      await send(stock.connect(who).approve(rounds, ethers.MaxUint256));
    }
    stocks[t] = { stock, feed: await ethers.getContractAt("MockAggregator", s.feed), price: DEMO_PRICES[t] };
  }
  const deposits = async () => {
    for (const s of Object.values(d.series)) {
      const id = (await rounds.series(s.id)).lastRound;
      const n = Number(id) % 3;
      await send(rounds.connect(demo).deposit(id, 0, wad(6 + n * 2)));
      await send(rounds.connect(other).deposit(id, 0, wad(9 - n)));
      await send(rounds.connect(demo).deposit(id, 1, wad(3 + n)));
      await send(rounds.connect(other).deposit(id, 1, wad(2)));
    }
  };
  const travel = async (to) => {
    await ethers.provider.send("evm_setNextBlockTimestamp", [to]);
    await ethers.provider.send("evm_mine", []);
  };
  const price = async (t, usd) => {
    await send(stocks[t].feed.connect(dev).setAnswer(Math.round(usd * 1e8)));
    return stocks[t].feed.latestId();
  };

  const running = {}; // the locked round of each stock
  await deposits(); // round 1 of every stock
  for (let step = 0; step < 2; step++) {
    const first = await rounds.round((await rounds.series(0)).lastRound);
    const lockAt = Number(first.lockAt);
    await travel(lockAt + 60);
    for (const [t, s] of Object.entries(d.series)) {
      const id = (await rounds.series(s.id)).lastRound;
      // One round ends exactly when the next locks, so one Chainlink round prices both.
      if (step > 0) stocks[t].price *= 1 + moves[t];
      const cl = await price(t, stocks[t].price);
      if (running[t]) await send(rounds.settle(running[t], cl));
      await send(rounds.lock(id, cl));
      running[t] = id;
      await send(rounds.connect(keeper).openRound(s.id, nextLockAt(lockAt + 60)));
    }
    await deposits();
  }
  // a settled round leaves fees in BuyBurn: spend some, as the keeper would
  const bb = await ethers.getContractAt("StockpoolBuyBurn", d.buyBurn);
  for (const s of Object.values(d.series)) {
    const stock = await ethers.getContractAt("MockStockToken", s.token);
    const bal = await stock.balanceOf(d.buyBurn);
    if (bal > 0n) {
      await send(bb.connect(keeper).buyAndBurn(s.token, bal, 1, "0x"));
      break;
    }
  }
  d.demoUser = demo.address;
}

/** Fork rehearsal: plays one round with the real Stock Tokens and Chainlink feeds' answers. */
async function rehearse(d, dev) {
  console.log("Rehearsal: checking every series reads its Chainlink feed");
  for (const [t, s] of Object.entries(d.series)) {
    const feed = await ethers.getContractAt("AggregatorV3Interface", s.feed);
    const [id, answer, , updatedAt] = await feed.latestRoundData();
    console.log(`  ${t.padEnd(6)} $${(Number(answer) / 1e8).toFixed(2)} (round ${id}, ${new Date(Number(updatedAt) * 1000).toUTCString()})`);
  }
  const rounds = await ethers.getContractAt("StockpoolRounds", d.rounds, dev);
  console.log(`  ${await rounds.roundCount()} rounds open; owner ${await rounds.owner()}; operator ${await rounds.operator()}`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exit(1);
});
