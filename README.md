# Stockpool

**Shield or Boost a tokenized stock, one week at a time, on Robinhood Chain (chain id 4663).**

Holders of a Robinhood Stock Token pool it for a weekly round and pick a side:

- **Shield** is owed the dollar value it put in plus a fixed coupon (1% a round at launch), and is paid first.
- **Boost** gets everything left over: the stock's upside on the whole pool, and the first losses.

Everything is paid in the same Stock Token that went in. The pool is fully backed: the two sides only split what was
deposited, so there is no borrowing, no liquidation and no debt.

| Contract | What it does |
|---|---|
| `StockpoolRounds` | Shield & Boost. One series per stock; a new round every week. Deposits close at the lock (Mondays 14:00 UTC); the round runs 7 days. Shield is matched up to 3× Boost, the rest refunded at the lock. Start and end prices are the **first Chainlink round at or after** the lock and end times (the contract checks the round before it is older), so nobody can pick a price by choosing when to call. A round that cannot be priced within 7 days is void and refunds everyone. |
| `StockpoolBuyBurn` | Receives the fee (5% of Boost's dollar profit in a winning round, in the stock) and can only sell it for **$SPOOL** on its Pons pool and burn it. No withdraw function. |
| `StockpoolSwapAdapter` | The Uniswap v4 pools BuyBurn may swap through: Stock Token → USDG → ETH → $SPOOL. |

**Who controls what.** The dev wallet owns the three contracts. It can list a stock, set the terms of *future* rounds
within hard caps (coupon ≤ 5%, fee ≤ 10% of Boost's profit, Shield ≤ 10× Boost), pause new deposits, and cancel an
unsettled round, which refunds every deposit in full. It cannot move deposits, change an open round's terms or take
any part of a payout. The keeper wallet can only open rounds; locking, settling and claiming are open to anyone.

The first Stockpool contracts (USDG liquidity Pools, Basket, credit lines) stay on-chain untouched; their record is
`contracts/deployments/v1-robinhood.json`.

| Folder | Contents |
|---|---|
| `contracts/` | Hardhat project: the contracts, tests, and the deploy, verify and token scripts |
| `keeper/` | The keeper bot: locks, settles and opens rounds; buys and burns $SPOOL with the fees |
| `app/` | The website (Next.js static export, on Vercel) |
| `tools/` | Wallet tools: encrypted keystores, the keeper key straight into a GitHub secret |
| `launch-kit/` | Logo, X header and link preview image, and the script that draws them |

## Launch (from your Mac)

```
node tools/import-key.js stockpool-dev2
```
```
cp -n launch.env.example launch.env && open -e launch.env
```
```
./launch.sh --rehearsal
```
```
./launch.sh
```
```
git add -A && git commit -m "Deploy Shield & Boost" && git push
```
```
./verify.sh
```

Then launch $SPOOL on Pons from the dev wallet and plug it in with `./set-token.sh 0xTOKEN`. Once $SPOOL graduates on
Pons, `./govern.sh register-pool` lets BuyBurn buy it. The keeper runs on GitHub Actions; set the repository variable
`KEEPER_LIVE` to `1` to let it send transactions.

## Tests

```
cd contracts && npm install && npx hardhat test
```

With a local node (`npx hardhat node --port 8547`), `npx hardhat run scripts/deploy.js --network keeper` deploys a
seeded demo and `cd ../keeper && npm run smoke` runs the keeper against it. The website runs against it with
`node scripts/export-web.js keeper` and `NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8547 npm run dev` in `app/`.

## Using the contract directly

Every contract is verified on the Robinhood Chain explorer (Contract → Write). Stock Tokens have 18 decimals.

- **Deposit:** on the Stock Token, `approve(rounds, amount)`; then `deposit(roundId, side, amount)` with side 0 for
  Shield and 1 for Boost. `withdraw(roundId, side, amount)` until the lock.
- **Claim:** `claim(roundId, yourAddress)` returns unmatched Shield while a round runs, and everything after it settles
  or is void. `claimMany([ids], yourAddress)` does several.
- **Read:** `round(id)`, `series(id)`, `positions(id, you)`, `claimable(id, you)`, and `preview(id, startPrice, endPrice)`
  for what each side would get at a given price.

MIT licensed (see `LICENSE`). Not independently audited. Nothing here is investment advice.
