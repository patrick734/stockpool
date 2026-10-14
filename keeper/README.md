# Stockpool keeper

One cycle, for every stock with a series:

1. **Lock** each round whose deposits have closed, with the first Chainlink round at or after its lock time (found by a
   binary search over the feed's current phase). A round with an empty side is locked without a price: it voids itself.
2. **Settle** each round that has ended, with the first Chainlink round at or after its end time. One round ends exactly
   when the next one locks, so the same Chainlink round prices both.
3. **Open** the next round as soon as the last one has locked, locking on the next Monday 14:00 UTC
   (`contracts/lib/schedule.js`).
4. **Void** a round that could not be locked or settled within 7 days (`voidStale`), which refunds every deposit.

Then **BuyBurn**: the fees (Stock Tokens) are sold for $SPOOL through the swap adapter and burned, at most one buy per
hour, each capped per token. The quote is a simulation of the real call; the minimum output allows 2% slippage.

Locking and settling are open to anyone and the prices are fixed by the contract, so when the keeper runs never changes
a result. Opening rounds needs the operator role, which the keeper wallet holds.

```
npm install
DRY_RUN=1 node src/index.js --once          # simulate one cycle against Robinhood Chain
KEEPER_PRIVATE_KEY=... DRY_RUN=0 node src/index.js   # loop, sending transactions
```

Settings: `config.json` (override with `KEEPER_CONFIG=file.json`). Environment: `RPC_URL`, `KEEPER_NETWORK`
(deployment file name, default `robinhood`), `KEEPER_PRIVATE_KEY`, `DRY_RUN` (anything but `0` simulates).

On GitHub Actions (`.github/workflows/keeper.yml`) it runs one cycle every 15 minutes, dry until the repository variable
`KEEPER_LIVE` is `1`.

Smoke test against a local node: see the main README (`npm run smoke`).
