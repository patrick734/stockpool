# Stockpool

Earn the trading fees of tokenized stocks on Robinhood Chain (chain id 4663), with USDG.

Robinhood Stock Tokens trade on Uniswap v4, and every swap pays a fee to whoever supplies the pool. Stockpool lets you
be that supplier with one USDG deposit.

- **Pools** (`StockpoolVault`, one per stock): an ERC-4626 vault. A keeper holds its USDG as one concentrated range in
  that stock's USDG pool, centred on Chainlink's price. Shares are valued at Chainlink, never at the pool's price, and
  deposits are refused while the pool is more than 2% away from Chainlink. 70% of swap fees compound for depositors; 30%
  goes to the protocol. Withdraw in USDG, or in kind (your share of the stock and USDG, no price needed) at any time.
- **The Basket** (`StockpoolBasket`): one deposit spread across every Pool. The keeper keeps about 20% in USDG for
  withdrawals; the contract refuses any move that puts more than 40% into one Pool, and takes deposits and pays USDG
  only while every Pool it holds is priced and within 2% of Chainlink. No fee of its own.
- **Credit lines** (`StockpoolCreditDesk`, one per listed Pool): pledge Pool shares and borrow USDG up to 40% of their
  value, or lend USDG and earn the interest. Each line is isolated.
- **$SPOOL**: the protocol's 30% and the credit lines' reserves go through `StockpoolFeeRouter` to `StockpoolBuyBurn`,
  which can only buy $SPOOL on its Pons pool and burn it.
- **Governance**: once `./govern.sh handoff` has completed, every setting goes through `StockpoolTimelock` (48 hours).
  The guardian can pause and lower caps, never raise them. Withdrawals and repayments stay open while paused.

| Folder | Contents |
|---|---|
| `contracts/` | Hardhat project: the contracts, their tests and the deploy, verify and governance scripts |
| `keeper/` | The keeper bot: Basket allocation, Pool rebalances and harvests, credit-line reserves, fee routing, buy and burn |
| `app/` | The website (Next.js static export, deployed on Vercel) |
| `tools/` | Wallet tools: encrypted keystores, the keeper key straight into a GitHub secret |
| `launch-kit/` | Logo, X header and link preview image, and the script that draws them |

## Tests

```bash
cd contracts && npm install && npx hardhat test
cd ../keeper && npm install && npm test
```

The contract tests include the Pool and credit line against the real Uniswap v4 PoolManager, PositionManager and
Permit2 bytecode, and the full deploy (including a resumed one). The keeper also has an end-to-end smoke test against a
local node; see `keeper/README.md`.

## Website locally

```bash
cd contracts && npx hardhat node --port 8547                      # terminal 1
npx hardhat run scripts/deploy.js --network keeper && node scripts/export-web.js keeper
cd ../app && npm install && NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8547 npm run dev
```

## Using the contracts directly

Every contract is verified on the Robinhood Chain explorer (Contract → Write). Addresses are in
`contracts/deployments/robinhood.json` and on the website's Docs page. USDG has 6 decimals, so 100 USDG is `100000000`.

- **Deposit into a Pool:** on USDG, `approve(pool, amount)`; then on the Pool, `deposit(amount, yourAddress)`.
- **Withdraw:** `redeem(shares, yourAddress, yourAddress)` for USDG, or
  `redeemInKind(shares, yourAddress, yourAddress, 0, 0)` for your share of the stock and USDG.
- **Basket:** the same `deposit` and `redeem`; `redeemInKind(shares, yourAddress, yourAddress)` returns USDG plus Pool shares.
- **Lend on a credit line:** on USDG, `approve(creditLine, amount)`; then `deposit(amount, yourAddress)`.
- **Borrow:** on the Pool, `approve(creditLine, shares)`; on the credit line, `pledge(shares)`, then
  `borrow(amount, yourAddress)`. Repay with `repay(amount, yourAddress)` after approving USDG, and take shares back
  with `release(shares, yourAddress)`.

MIT licensed (see `LICENSE`). Not independently audited. Nothing here is investment advice.
