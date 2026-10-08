"use client";

import { CREDIT_LINES } from "@/lib/config";
import { Footer, Header } from "@/components/Header";
import { CreditLine } from "@/components/Panels";

export default function BorrowPage() {
  return (
    <>
      <Header />
      <main className="frame page">
        <div className="page-head plain">
          <div>
            <h1>Borrow</h1>
            <p>
              Pledge Pool shares and borrow USDG against them, or lend USDG and earn the interest. Each credit line stands alone: its bad
              debt can never touch another.
            </p>
          </div>
        </div>
        {CREDIT_LINES.length ? (
          CREDIT_LINES.map((c) => <CreditLine key={c.desk} ticker={c.ticker} desk={c.desk} pool={c.pool} />)
        ) : (
          <p className="note">The credit lines open when the contracts are live.</p>
        )}
        <p className="note fine">
          Stock prices can jump when trading resumes, and borrowing waits while Chainlink’s price is stale. A loan that passes its limit can be liquidated: anyone may
          repay part of it and take pledged shares at a discount.
        </p>
      </main>
      <Footer />
    </>
  );
}
