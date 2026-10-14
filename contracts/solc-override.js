// Optional offline compiler, when binaries.soliditylang.org is unreachable:
//   LOCAL_SOLC=/path/to/solc-0.8.26 (native binary) or SOLCJS_PATH=/path/to/soljson.js (solc@0.8.26 from npm).
// Unset, Hardhat downloads solc normally.
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, _hre, runSuper) => {
  if (process.env.LOCAL_SOLC && args.solcVersion === "0.8.26")
    return { compilerPath: process.env.LOCAL_SOLC, isSolcJs: false, version: args.solcVersion, longVersion: "0.8.26+commit.8a97fa7a" };
  if (process.env.SOLCJS_PATH) {
    const solc = require(path.join(path.dirname(process.env.SOLCJS_PATH), "index.js"));
    const longVersion = solc.version().replace(/\.Emscripten.*$/, "");
    if (longVersion.startsWith(args.solcVersion)) return { compilerPath: process.env.SOLCJS_PATH, isSolcJs: true, version: args.solcVersion, longVersion };
  }
  return runSuper();
});
