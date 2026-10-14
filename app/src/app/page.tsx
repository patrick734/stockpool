"use client";

import { BRAND } from "@/lib/brand";
import { LIVE } from "@/lib/config";
import { useSeries } from "@/lib/rounds";
import { Footer, Header } from "@/components/Header";
import { Payoff, StockCard, roundsTotal } from "@/components/Rounds";

export default function Home() {
  const { data, error } = useSeries();
  const inPlay = roundsTotal(data);
  return (
    <>
      <Header />
      <main>
        <section className="hero frame sb-hero">
          <div className="hero-copy">
            <h1>
              Pool a stock.
              <br />
              <span className="sb-shield-t">Shield</span> it or <span className="sb-boost-t">Boost</span> it.
            </h1>
            <p className="lede">
              Weekly rounds on Robinhood Stock Tokens. Shield gets its dollars back plus a fixed coupon. Boost takes the upside of the whole pool and the first
              losses. Settled at Chainlink&apos;s price, paid in the stock, fully backed.
            </p>
            <div className="hero-actions">
              <a className="button" href="#rounds">
                See this week&apos;s rounds
              </a>
              <a className="button quiet" href="/docs/">
                How it works
              </a>
            </div>
            <ul className="facts">
              <li>No liquidations, no borrowing: every payout comes out of the pool</li>
              <li>Start and end prices are the first Chainlink prices after fixed times</li>
              <li>5% of Boost&apos;s profit buys and burns ${BRAND.token.symbol}</li>
            </ul>
          </div>
          <div className="board sb-hero-chart">
            <Payoff shieldMatched={0n} boostIn={0n} couponBps={100} feeBps={500} />
            {LIVE && data && <p className="note">{inPlay > 0 ? `About $${Math.round(inPlay).toLocaleString("en-US")} in this week's rounds.` : "The first rounds are open for deposits."}</p>}
          </div>
        </section>

        <section id="rounds" className="block frame">
          <div className="block-head">
            <h2>This week&apos;s rounds</h2>
            <p>One round per stock, every week. Deposit the Stock Token on either side until the round locks; claim in the same stock after it ends.</p>
          </div>
          {!LIVE ? (
            <div className="board board-soon">
              <p>The rounds open when the contracts are live.</p>
            </div>
          ) : error ? (
            <p className="msg err">Could not read Robinhood Chain right now. Refresh in a moment.</p>
          ) : (
            <div className="sb-grid">
              {(data ?? []).map((s) => (
                <StockCard key={s.ticker} s={s} />
              ))}
              {!data && <p className="note">Reading the rounds…</p>}
            </div>
          )}
        </section>

        <section className="block frame">
          <div className="block-head">
            <h2>A round, step by step</h2>
          </div>
          <ol className="steps">
            <li>
              <span className="step-n">1</span>
              <h3>Deposit</h3>
              <p>Put a Stock Token on Shield or Boost while the round is open. You can take it back until the lock.</p>
            </li>
            <li>
              <span className="step-n">2</span>
              <h3>Lock</h3>
              <p>At the lock time the start price is the first Chainlink price at or after it. Shield is matched up to 3× Boost; the rest is refunded.</p>
            </li>
            <li>
              <span className="step-n">3</span>
              <h3>Run for a week</h3>
              <p>Shield is owed its dollar value plus the coupon. Boost owns everything above that, and absorbs any shortfall first.</p>
            </li>
            <li>
              <span className="step-n">4</span>
              <h3>Settle and claim</h3>
              <p>The end price is the first Chainlink price after the end. The pool splits in the stock; claim yours any time.</p>
            </li>
          </ol>
        </section>
      </main>
      <Footer />
    </>
  );
}
