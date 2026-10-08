"use client";

import { BRAND } from "@/lib/brand";
import { CONTRACTS, CREDIT_LINES, POOLS, addressUrl } from "@/lib/config";
import { Footer, Header } from "@/components/Header";

const S = BRAND.token.symbol;

const TOPICS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "what",
    title: "What Stockpool is",
    body: (
      <>
        <p>
          Robinhood Stock Tokens trade on Uniswap v4 on Robinhood Chain. Every swap pays a fee to the people supplying the pool.
          Stockpool turns that into a deposit: you put USDG into a stock’s Pool, and a keeper holds it as one concentrated range in that
          stock’s USDG pool, centred on Chainlink’s price. The fees it earns compound into your shares.
        </p>
        <p>There are three ways in: a single Pool, the Basket (every Pool at once), and Borrow (loans against Pool shares, or lending).</p>
      </>
    ),
  },
  {
    id: "pools",
    title: "Pools",
    body: (
      <>
        <p>
          Each Pool is an ERC-4626 vault for one stock. Your shares are valued with Chainlink’s price for the stock, through Chainlink’s
          USDG/USD feed, never with the pool’s own price. Deposits are refused while the pool is more than 2% away from Chainlink, so
          nobody can push the pool to buy shares cheaply or sell them dearly.
        </p>
        <p>
          The keeper places the range about 12% either side of the price and moves it when the price walks toward an edge. Any swap it
          makes to rebalance is checked against Chainlink and refused if it loses more than 1%. Each Pool has a deposit cap.
        </p>
        <p>
          You can withdraw an exact amount of USDG while the price is live (if the Pool has to sell stock to pay you, that cost is
          yours, at most 1%), or withdraw in kind at any time: your share of the stock and USDG, with no price and no swap.
        </p>
      </>
    ),
  },
  {
    id: "basket",
    title: "The Basket",
    body: (
      <p>
        One deposit spread across every Pool. The keeper keeps about a fifth in USDG for withdrawals, tops up the Pools that hold the
        least, and the contract refuses any move that would put more than 40% into one Pool. Withdrawals in USDG come from that
        reserve. Like the Pools, the Basket takes deposits and pays USDG only while every Pool it holds has a fresh price and trades
        within 2% of Chainlink. Withdrawing in kind always works and hands you your slice of the reserve plus your slice of each
        Pool’s shares. The Basket charges no fee of its own.
      </p>
    ),
  },
  {
    id: "borrow",
    title: "Borrow and lend",
    body: (
      <>
        <p>
          Each credit line lends USDG against one Pool’s shares. Pledge shares (they keep earning) and borrow up to 40% of their value.
          The rate moves with how much of the line is borrowed. If a loan grows past 55% of the shares’ value, anyone can repay up to half
          of it and take shares worth 6% more than they repaid. A line can hold at most 30% of its Pool’s shares as collateral.
        </p>
        <p>
          Lenders supply USDG and earn the interest, less a 10% reserve that goes to the fee router. Each line is isolated: bad debt in
          one never reaches another. Borrowing needs a fresh Chainlink price; repaying never does.
        </p>
      </>
    ),
  },
  {
    id: "spool",
    title: `Fees and $${S}`,
    body: (
      <>
        <p>
          Of every swap fee a Pool earns, 70% stays in the Pool for its depositors and 30% goes to StockpoolFeeRouter, along with the
          credit lines’ reserves. The router forwards everything to StockpoolBuyBurn.
        </p>
        <p>
          StockpoolBuyBurn can only buy ${S} on its Pons pool and burn it. Runs are capped and at most hourly, and it has no withdraw
          function. ${S} launches on Pons; until its pool is registered after graduation, fees wait in StockpoolBuyBurn.
        </p>
      </>
    ),
  },
  {
    id: "safety",
    title: "Who can change what",
    body: (
      <>
        <p>
          Every setting (caps, fee share, risk limits, price feeds, the Basket’s Pools) is changed through StockpoolTimelock, which makes
          each change public for 48 hours before it can run.
        </p>
        <p>
          The guardian can pause new deposits and borrowing and lower caps, never raise them. Withdrawals, withdrawals in kind and
          repayments stay open while paused. The keeper can move a Pool’s range and the Basket’s money between its Pools, inside the
          Chainlink checks; it can never send funds anywhere else.
        </p>
      </>
    ),
  },
  {
    id: "risks",
    title: "Risks",
    body: (
      <ul>
        <li>A concentrated range earns more fees but sells into a falling stock and buys into a rising one, so a Pool can end up worth less than the USDG put in.</li>
        <li>When a Chainlink stock price goes stale (its feed stops updating, as it does over weekends), deposits, USDG withdrawals and borrowing wait; withdrawing in kind does not.</li>
        <li>Stock prices can jump when trading resumes. A loan past its limit can be liquidated at a discount.</li>
        <li>The contracts are tested against the real Uniswap v4 code but have not been independently audited.</li>
        <li>Nothing here is investment advice.</li>
      </ul>
    ),
  },
];

export default function Docs() {
  const rows: [string, string | undefined][] = [
    ["StockpoolTimelock (48h)", CONTRACTS.timelock],
    ["StockpoolBuyBurn", CONTRACTS.buyBurn],
    ["StockpoolFeeRouter", CONTRACTS.feeRouter],
    ["StockpoolOracle", CONTRACTS.oracle],
    ["StockpoolRegistry", CONTRACTS.registry],
    ["StockpoolSwapAdapter", CONTRACTS.swapAdapter],
    ["StockpoolBasket", CONTRACTS.basket],
    ...POOLS.flatMap((p) => [[`StockpoolVault ${p.ticker}`, p.vault], [`StockpoolPosition ${p.ticker}`, p.position]] as [string, string][]),
    ...CREDIT_LINES.map((c) => [`StockpoolCreditDesk ${c.ticker}`, c.desk] as [string, string]),
  ];
  return (
    <>
      <Header />
      <main className="frame page docs">
        <aside className="toc" aria-label="On this page">
          {TOPICS.map((t) => (
            <a key={t.id} href={`#${t.id}`}>
              {t.title}
            </a>
          ))}
          <a href="#contracts">Contracts</a>
        </aside>
        <div className="doc-body">
          <h1>How Stockpool works</h1>
          {TOPICS.map((t) => (
            <section key={t.id} id={t.id}>
              <h2>{t.title}</h2>
              {t.body}
            </section>
          ))}
          <section id="contracts">
            <h2>Contracts</h2>
            <p>Every Stockpool contract carries the Stockpool name and is verified on the Robinhood Chain explorer.</p>
            {rows.some(([, a]) => a) ? (
              <dl className="addresses">
                {rows
                  .filter(([, a]) => a)
                  .map(([k, a]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>
                        <a href={addressUrl(a!)} target="_blank" rel="noopener">
                          {a}
                        </a>
                      </dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <p className="note">The addresses appear here once the contracts are live.</p>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
