#!/usr/bin/env bash
# Dev-wallet transactions after launch:
#   ./govern.sh register-pool   after $SPOOL graduates on Pons: register its pool so BuyBurn can buy and burn it
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
. "$ROOT/tools/env.sh"
load_launch_env "$ROOT/launch.env"
export DEPLOYER_ACCOUNT="${DEPLOYER_ACCOUNT:-stockpool-dev2}"
[ -n "${ROBINHOOD_RPC_URL:-}" ] && export ROBINHOOD_RPC_URL
case "${1:-}" in
  register-pool) S=scripts/register-pool-send.js ;;
  *) sed -n 2,3p "$0"; exit 1 ;;
esac
cd "$ROOT/contracts" && npx hardhat run "$S" --network robinhood
