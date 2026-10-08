"use client";

import { BRAND } from "@/lib/brand";
import { CREDIT_LINES, LIVE } from "@/lib/config";
import { useBasket, usePools } from "@/lib/data";
import { usd } from "@/lib/format";
import { Footer, Header } from "@/components/Header";
import { PoolBoard, PoolTable } from "@/components/Pools";
import { Allocation, LinesSummary, SpoolSection, Steps } from "@/components/Sections";

export default function Home() {
  const { data: pools, isError: offline } = usePools();
  const { data: basket } = useBasket();
  const deposited = (pools ?? []).reduce((s, p) => s + (p.value ?? 0n), 0n);
  return (
    <>
      <Header />
      <main>
        <section className="hero frame">
          <div className="hero-copy">
            <h1>Every trade pays the pool.</h1>
            <p className="lede">
              When someone swaps a Robinhood Stock Token on Uniswap, they pay a fee to whoever supplies the pool. {BRAND.name} lets you
              be that supplier with plain USDG: deposit into a stock’s Pool and a keeper holds it in a tight range around Chainlink’s
              price, where the trades happen.
            </p>
            <div className="hero-actions">
              <a className="button" href="#pools">
                Choose a Pool
              </a>
              <a className="button quiet" href="/basket/">
                Use the Basket
              </a>
            </div>
            <ul className="facts">
              <li>70% of every swap fee stays with depositors and compounds.</li>
              <li>Shares are priced by Chainlink, never by the pool.</li>
              <li>Withdraw in kind any time, even when the market is closed.</li>
              {deposited >= 1_000_000_000n && <li>{usd(deposited, true)} deposited across the Pools.</li>}
            </ul>
          </div>
          {LIVE ? <PoolBoard pools={pools} offline={offline && !pools} /> : <div className="board board-soon"><p>The Pools open when the contracts are live.</p></div>}
        </section>

        {LIVE && (
          <section id="pools" className="block frame">
            <div className="block-head">
              <h2>Pools</h2>
              <p>One Pool per stock. Each keeps a single range in that stock’s USDG pool on Uniswap v4 and moves it when the price does.</p>
            </div>
            <PoolTable pools={pools} />
          </section>
        )}

        {LIVE && (
          <section className="block frame split">
            <div>
              <h2>Or take all of them.</h2>
              <p>
                The Basket is one deposit spread across every Pool. The keeper keeps about a fifth in USDG for withdrawals and puts the
                rest to work, at most {basket ? (basket.maxAllocationBps / 100).toFixed(0) : "40"}% into any one Pool.
              </p>
              <a className="button" href="/basket/">
                Open the Basket
              </a>
            </div>
            <Allocation basket={basket} />
          </section>
        )}

        {CREDIT_LINES.length > 0 && (
          <section className="block frame split">
            <div>
              <h2>Borrow without selling.</h2>
              <p>
                Pledge your Pool shares and borrow USDG against them. Your shares keep earning while they back the loan. Or lend USDG and
                earn the interest borrowers pay.
              </p>
              <a className="button" href="/borrow/">
                Go to Borrow
              </a>
            </div>
            <LinesSummary />
          </section>
        )}

        <Steps />
        <SpoolSection />
      </main>
      <Footer />
    </>
  );
}

