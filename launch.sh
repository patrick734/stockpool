#!/usr/bin/env bash
# Stockpool launch: deploys everything from ONE dev wallet and writes the addresses into the website.
#   Timelock (48h), swap adapter, BuyBurn, oracle, fee router, registry, a Pool for every stock with a usable
#   Uniswap v4 pool, the credit lines and the Basket. The dev wallet is the timelock's proposer and executor and the
#   guardian; the keeper is a separate bot wallet.
#
#   ./launch.sh --rehearsal   on a local copy of Robinhood Chain: deploys, then deposits, places ranges, withdraws,
#                             fills the Basket and borrows with what it deployed, and prints the cost. Spends nothing.
#   ./launch.sh               the real deploy. If it stops halfway, run it again: it continues where it stopped.
#
# Signs from ~/.foundry/keystores/$DEPLOYER_ACCOUNT (default stockpool-dev, made by
# `node tools/import-key.js stockpool-dev`), unlocked with ~/.foundry/stockpool.pw. No key is typed or printed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
C="$ROOT/contracts"
REHEARSAL=0
for a in "$@"; do case "$a" in --rehearsal) REHEARSAL=1 ;; *) echo "unknown option $a"; exit 1 ;; esac; done
step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }
stop() { printf '\n\033[31mSTOPPED: %s\033[0m\n' "$1"; exit 1; }

step "Settings"
for d in "$C" "$ROOT/keeper"; do [ -d "$d/node_modules" ] || (cd "$d" && npm install --no-audit --no-fund); done
. "$ROOT/tools/env.sh"
[ -f "$ROOT/launch.env" ] && { load_launch_env "$ROOT/launch.env"; echo "Loaded launch.env"; }
[[ "${KEEPER_ADDRESS:-}" =~ ^0x[0-9a-fA-F]{40}$ ]] || stop "KEEPER_ADDRESS is not set in launch.env (node tools/wallet.js keeper-secret prints it)."
[ -n "${ROBINHOOD_RPC_URL:-}" ] && export ROBINHOOD_RPC_URL
export DEPLOYER_ACCOUNT="${DEPLOYER_ACCOUNT:-stockpool-dev}"
[ -f "$HOME/.foundry/keystores/$DEPLOYER_ACCOUNT" ] || stop "No dev wallet keystore ~/.foundry/keystores/$DEPLOYER_ACCOUNT. Create it with: node tools/import-key.js $DEPLOYER_ACCOUNT"
DEV="$(node "$ROOT/tools/wallet.js" address "$DEPLOYER_ACCOUNT")" || stop "Could not unlock the dev wallet keystore."
lc() { echo "$1" | tr A-F a-f; }
[ "$(lc "$KEEPER_ADDRESS")" != "$(lc "$DEV")" ] || stop "The keeper must be a separate wallet from the dev wallet."
export DEPLOYER_ADDRESS="$DEV" ADMIN_MULTISIG="$DEV" GUARDIAN_MULTISIG="$DEV" KEEPER_ADDRESS
echo "Dev wallet: $DEV (deployer, timelock proposer/executor, guardian)"
echo "Keeper:     $KEEPER_ADDRESS"

OUT="$C/deployments/robinhood.json"
if [ $REHEARSAL = 0 ] && [ -f "$OUT" ] && [ ! -f "$C/deployments/robinhood.progress.json" ]; then
  stop "Already deployed (contracts/deployments/robinhood.json)."
fi

cd "$C" || exit 1
step "Compiling"
npx hardhat compile 2>&1 | tail -1 || stop "Contracts did not compile."
step "Refreshing live pool data"
node scripts/probe-pools.js | grep -E "NVDA|TSLA|AAPL|META|GOOGL|MSFT|SPY|chainId" || stop "Could not read the live pools. Check your connection (or ROBINHOOD_RPC_URL in launch.env) and run again."
step "Preflight checks"
node scripts/preflight.js || stop "Preflight failed. Fix the FAIL lines above and run again."

if [ $REHEARSAL = 1 ]; then
  step "Rehearsal on a local copy of Robinhood Chain"
  FORK=1 npx hardhat run scripts/rehearse.js 2>&1 | grep -v '^\s\+at '
  [ "${PIPESTATUS[0]}" = 0 ] || stop "Rehearsal failed. Read the FAIL lines above (a dropped RPC connection: run it again)."
  step "Rehearsal complete. Nothing was sent to Robinhood Chain."; exit 0
fi

printf '\n\033[33mThis deploys Stockpool to Robinhood Chain with real gas from %s.\033[0m\n' "$DEV"
read -r -p "Type DEPLOY to continue: " ans; [ "$ans" = "DEPLOY" ] || stop "Cancelled."

step "Deploying"
ok=0
for attempt in 1 2 3; do
  npx hardhat run scripts/deploy.js --network robinhood 2>&1 | grep -v '^\s\+at '
  [ "${PIPESTATUS[0]}" = 0 ] && [ -f "$OUT" ] && [ ! -f "$C/deployments/robinhood.progress.json" ] && { ok=1; break; }
  # Every address is saved as it appears, so the next attempt carries on from where this one stopped.
  printf '\033[33mAttempt %s did not finish (usually a dropped connection to the Robinhood RPC). Continuing.\033[0m\n' "$attempt"
  [ $attempt -lt 3 ] && sleep 10
done
[ $ok = 1 ] || stop "Not finished after 3 attempts. Run ./launch.sh again: it continues where it stopped."

step "Exporting addresses to the website"
node scripts/export-web.js robinhood || stop "Deployed, but exporting addresses failed. Run: (cd contracts && node scripts/export-web.js)"
step "Deployed"
echo "Next:"
echo "  1. Push (keeper and addresses): git add -A && git commit -m Deploy && git push"
echo "  2. Publish the source code: ./verify.sh"
echo "  3. Timelock handoff, now and again after 48h: ./govern.sh handoff"
echo "  4. After the handoff is complete: Vercel, then GitHub repository variable KEEPER_LIVE=1 (docs/LAUNCH.md)"
