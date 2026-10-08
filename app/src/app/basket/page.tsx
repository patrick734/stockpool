"use client";

import { LIVE } from "@/lib/config";
import { useBasket } from "@/lib/data";
import { usd } from "@/lib/format";
import { Footer, Header } from "@/components/Header";
import { BasketPanel } from "@/components/Panels";
import { Allocation } from "@/components/Sections";

export default function BasketPage() {
  const { data: b } = useBasket();
  return (
    <>
      <Header />
      <main className="frame page">
        <div className="page-head plain">
          <div>
            <h1>The Basket</h1>
            <p>One deposit, earning in every Pool at once.</p>
          </div>
        </div>
        {!LIVE ? (
          <p className="note">The Basket opens when the contracts are live.</p>
        ) : (
          <div className="pool-grid">
            <div className="pool-info">
              <Allocation basket={b} />
              <dl className="spec">
                <div>
                  <dt>In the Basket</dt>
                  <dd>{b?.total !== undefined && b.total >= 1_000_000n ? usd(b.total, true) : b ? "Open" : "…"}</dd>
                </div>
                <div>
                  <dt>Room left</dt>
                  <dd>{b ? usd(b.total !== undefined && b.cap > b.total ? b.cap - b.total : b.cap, true) : "…"}</dd>
                </div>
                <div>
                  <dt>Pools</dt>
                  <dd>{b ? b.pools.length : "…"}</dd>
                </div>
                <div>
                  <dt>Most in one Pool</dt>
                  <dd>{b ? `${(b.maxAllocationBps / 100).toFixed(0)}%` : "…"}</dd>
                </div>
                <div>
                  <dt>Kept in USDG</dt>
                  <dd>About 20%</dd>
                </div>
                <div>
                  <dt>Basket fee</dt>
                  <dd>None</dd>
                </div>
              </dl>
              <p className="note">
                The keeper tops up the Pools that hold the least and brings USDG back when withdrawals run the reserve down. It can only
                move money between the Basket and the Pools listed here.
              </p>
            </div>
            <BasketPanel />
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
