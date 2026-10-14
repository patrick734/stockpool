"use client";

import { BRAND } from "@/lib/brand";
import { CONTRACTS, SERIES, addressUrl } from "@/lib/config";
import { Footer, Header } from "@/components/Header";

const S = BRAND.token.symbol;

const TOPICS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "what",
    title: "What Stockpool is",
    body: (
      <>
        <p>
          Stockpool runs weekly rounds on Robinhood Stock Tokens. Holders of a stock pool it for one week and choose a side. <b>Shield</b> is owed the
          dollar value it put in plus a fixed coupon, and is paid first. <b>Boost</b> gets everything left: the stock&apos;s upside on the whole pool,
          and the first losses. Everything is paid in the same Stock Token that went in.
        </p>
        <p>
          It is fully backed: the two sides only ever split what was deposited. There is no borrowing, no liquidation and no debt, and nobody can move
          the deposits.
        </p>
      </>
    ),
  },
  {
    id: "round",
    title: "A round",
    body: (
      <>
        <p>
          Each stock has one round open for deposits at a time. Deposits close at the lock time (Mondays, 14:00 UTC) and you can take them back until
          then. The round then runs for seven days; the next round opens as soon as this one locks.
        </p>
        <p>
          At the lock, Shield is matched up to 3× Boost. If more Shield came in, each Shield deposit is matched pro rata and the rest is refunded
          straight away (claim it from the Portfolio). A round where one side is empty is void and refunds everyone.
        </p>
      </>
    ),
  },
  {
    id: "math",
    title: "How the pool splits",
    body: (
      <>
        <p>With S Shield and B Boost (in the stock), start price P₀, end price P₁ and coupon c:</p>
        <ul>
          <li>Shield is owed S × P₀ × (1 + c) in dollars, paid in the stock at P₁: S × P₀ × (1 + c) ÷ P₁, never more than the whole pool S + B.</li>
          <li>Boost gets the rest of the pool.</li>
          <li>If Boost ends with more dollars than it put in, 5% of that profit is the protocol fee.</li>
        </ul>
        <p>
          Example, 300 Shield and 100 Boost at $180 with a 1% coupon. Stock +10% to $198: Shield gets back its $54,000 plus $540, about 275.5 shares;
          Boost gets about 124.5 shares, worth about +37% in dollars before the fee. Stock −10% to $162: Shield still gets $54,540 (336.7 shares) and
          Boost about 63.3 shares, −43%. Shield only loses dollars if the stock falls so far that Boost is wiped out (about −24% here).
        </p>
      </>
    ),
  },
  {
    id: "prices",
    title: "Prices",
    body: (
      <>
        <p>
          Both prices come from the stock&apos;s Chainlink feed on Robinhood Chain: the start price is the first Chainlink update at or after the lock
          time, the end price the first at or after the end time. The contract checks that the update before it is older than that time, so nobody can
          pick a better price by choosing when to call. Locking and settling are open to anyone; the keeper does it for everyone.
        </p>
        <p>
          Stock feeds pause over weekends and holidays, so the price used can be the next market update. If no usable price arrives within 7 days, the
          round is void and every deposit is refunded.
        </p>
      </>
    ),
  },
  {
    id: "spool",
    title: `$${S}`,
    body: (
      <>
        <p>
          The fee (5% of Boost&apos;s profit in a winning round) goes to StockpoolBuyBurn, which can only sell it for ${S} on its Pons pool and burn
          what it buys. It has no withdraw function.
        </p>
      </>
    ),
  },
  {
    id: "control",
    title: "Who controls what",
    body: (
      <>
        <p>
          The dev wallet owns the contracts. It can list a stock, set the terms of future rounds within hard limits (coupon at most 5%, fee at most 10%
          of Boost&apos;s profit, Shield at most 10× Boost), pause new deposits, and cancel a round that has not settled, which refunds every deposit in
          full (for a broken feed or a stock split). It cannot move deposits, change a round&apos;s terms once it is open, or take any part of a payout.
        </p>
        <p>The keeper wallet can only open the next round. Withdrawals before the lock, claims and refunds never depend on either.</p>
      </>
    ),
  },
  {
    id: "risks",
    title: "Risks",
    body: (
      <>
        <ul>
          <li>Boost can lose most or all of its deposit in a week. Shield&apos;s dollar value is only protected while Boost&apos;s cushion lasts.</li>
          <li>Payouts are in the Stock Token. Its dollar value is what Chainlink reports; the price you can sell it for may differ.</li>
          <li>A Stock Token event (a split, a corporate action) can make a round&apos;s prices meaningless; such a round should be cancelled and refunded.</li>
          <li>The contracts have not had an independent audit. This is not investment advice.</li>
        </ul>
      </>
    ),
  },
];

export default function Docs() {
  const rows: [string, string | undefined][] = [
    ["StockpoolRounds (Shield & Boost)", CONTRACTS.rounds],
    ["StockpoolBuyBurn", CONTRACTS.buyBurn],
    ["StockpoolSwapAdapter", CONTRACTS.swapAdapter],
    ["Owner (dev wallet)", CONTRACTS.owner],
    ["Keeper", CONTRACTS.keeper],
    ...SERIES.map((x) => [`${x.ticker} Chainlink feed`, x.feed] as [string, string]),
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
