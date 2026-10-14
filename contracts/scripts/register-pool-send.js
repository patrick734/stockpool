// Registers the token / ETH Pons pool once the token has graduated, sent from the dev wallet.
//   npx hardhat run scripts/register-pool-send.js --network robinhood
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { plan } = require("./register-pool");

async function main() {
  const label = network.name === "hardhat" ? "fork" : network.name;
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${label}.json`), "utf8"));
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No dev wallet signer: keystore ~/.foundry/keystores/stockpool-dev2 (or DEPLOYER_ACCOUNT) not found.");
  const p = await plan(ethers.provider, d);
  console.log(`Token ${p.token}, Pons pool ${p.id}: ${p.status}`);
  if (["not-initialized", "no-liquidity", "hook-not-allowed"].includes(p.status)) throw new Error(`Not ready: ${p.status}. Run again after the token graduates.`);
  if (p.status === "registered") return console.log("Already registered. Nothing to do.");
  const sent = await signer.sendTransaction({ to: p.tx.to, data: p.tx.data });
  console.log(`Sent from ${signer.address}: ${sent.hash}`);
  await sent.wait();
  console.log("Done: BuyBurn can now buy and burn the token.");
}

main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exit(1);
});
