#!/usr/bin/env node
// End-to-end check of the keeper against a local chain, sending real transactions there:
//   cd contracts && npx hardhat node --port 8547                               (terminal 1)
//   npx hardhat run scripts/deploy.js --network keeper && cd ../keeper && npm run smoke
// Jumps past the next lock time, pushes a price to every mock feed, then runs one keeper cycle as hardhat account #3
// (the demo deployment's keeper) and checks it locked and settled the due rounds, opened the next ones and burned fees.
const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");

const RPC = process.env.RPC_URL || "http://127.0.0.1:8547";
const KEEPER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"; // hardhat account #3

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "contracts", "deployments", "keeper.json"), "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC);
  const dev = await provider.getSigner(0); // the local node keeps its accounts unlocked
  const abis = require("../src/abis");
  const rounds = new ethers.Contract(dep.rounds, abis.Rounds, provider);
  const feedAbi = ["function setAnswer(int256)", "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"];

  const before = Number(await rounds.roundCount());
  const open = await rounds.round((await rounds.series(0)).lastRound);
  await provider.send("evm_setNextBlockTimestamp", [Number(open.lockAt) + 3600]);
  await provider.send("evm_mine", []);
  for (const s of Object.values(dep.series)) {
    const feed = new ethers.Contract(s.feed, feedAbi, dev);
    const [, answer] = await feed.latestRoundData();
    await (await feed.setAnswer((answer * 103n) / 100n)).wait();
  }

  process.env.RPC_URL = RPC;
  process.env.KEEPER_NETWORK = "keeper";
  process.env.KEEPER_PRIVATE_KEY = KEEPER_KEY;
  process.env.DRY_RUN = "0";
  const { init, cycle } = require("../src/index");
  const ctx = await init();
  await cycle(ctx, 1);

  let failed = 0;
  const check = (ok, msg) => {
    console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
    if (!ok) failed++;
  };
  const n = Object.keys(dep.series).length;
  const count = Number(await rounds.roundCount());
  check(count === before + n, `opened ${count - before} new rounds (one per stock)`);
  const states = [0, 0, 0, 0, 0];
  for (let id = 1; id <= count; id++) states[Number((await rounds.round(id)).state)]++;
  check(states[3] === 2 * n, `${states[3]} rounds settled (two per stock)`);
  check(states[2] === n, `${states[2]} rounds running (one per stock)`);
  check(states[1] === n, `${states[1]} rounds open for deposits (one per stock)`);
  const bb = new ethers.Contract(dep.buyBurn, abis.BuyBurn, provider);
  check((await bb.totalBurned()) > 0n, `BuyBurn has burned ${ethers.formatEther(await bb.totalBurned())} SPOOL`);
  console.log(failed ? `\n${failed} check(s) failed` : "\nKeeper smoke test passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
