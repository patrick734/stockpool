"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { BRAND } from "@/lib/brand";
import { CONTRACTS, CREDIT_LINES, POOLS, addressUrl } from "@/lib/config";
import { useBasket, useBurned, useCreditLine } from "@/lib/data";
import { num, usd } from "@/lib/format";
import { stockToken } from "@/lib/tokens";
import { TokenDot } from "./TokenDot";

type Basket = ReturnType<typeof useBasket>["data"];

const SHADES = ["#1c6b64", "#2f8a7f", "#4aa597", "#6dbcae", "#93cfc3", "#b7ded5", "#d4ebe5", "#e6f2ee"];

/** Where the Basket's money is: one bar, a segment per Pool plus the USDG kept for withdrawals. */
export function Allocation({ basket }: { basket: Basket }) {
  if (!basket) return <div className="alloc alloc-loading" aria-hidden="true" />;
  const parts = basket.pools.map((p, i) => ({ label: `${p.ticker} Pool`, value: p.value ?? 0n, color: SHADES[i % SHADES.length] }));
  const all = [...parts, { label: "USDG reserve", value: basket.idle, color: "var(--brass)" }].filter((x) => x.value > 0n);
  const total = all.reduce((s, x) => s + x.value, 0n);
  if (total === 0n)
    return (
      <div className="alloc">
        <p className="alloc-title">Spreads across</p>
        <ul className="alloc-pools">
          {basket.pools.map((p) => {
            const pool = POOLS.find((x) => x.ticker === p.ticker);
            return <li key={p.vault}>{pool ? <TokenDot token={stockToken(pool)} /> : null} {p.ticker}</li>;
          })}
        </ul>
      </div>
    );
  return (
    <div className="alloc">
      <p className="alloc-title">The Basket now: {usd(total, true)}</p>
      <div className="alloc-bar" role="img" aria-label={all.map((x) => `${x.label} ${((Number(x.value) / Number(total)) * 100).toFixed(0)}%`).join(", ")}>
        {all.map((x) => (
          <i key={x.label} style={{ flexGrow: Number(x.value), background: x.color }} />
        ))}
      </div>
      <ul className="alloc-legend">
        {all.map((x) => (
          <li key={x.label}>
            <i style={{ background: x.color }} />
            {x.label} <span>{((Number(x.value) / Number(total)) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineRow({ ticker, desk, vault }: { ticker: string; desk: `0x${string}`; vault: `0x${string}` }) {
  const { data: s } = useCreditLine(desk, vault);
  const pool = POOLS.find((p) => p.ticker === ticker)!;
  return (
    <li>
      <a href={`/borrow/#line-${ticker.toLowerCase()}`}>
        <TokenDot token={stockToken(pool)} />
        <b>{ticker} credit line</b>
        <span>{s ? `${(Number(formatUnits(s.borrowRate, 18)) * 100).toFixed(2)}% a year, up to ${(s.risk[0] / 100).toFixed(0)}% of your shares’ value` : "…"}</span>
      </a>
    </li>
  );
}

export function LinesSummary() {
  return (
    <ul className="lines-summary">
      {CREDIT_LINES.map((c) => (
        <LineRow key={c.desk} ticker={c.ticker} desk={c.desk} vault={c.pool.vault} />
      ))}
    </ul>
  );
}

export function Steps() {
  const steps = [
    {
      t: "Deposit USDG",
      d: "You get Pool shares, priced at Chainlink’s price for the stock. A deposit is refused while the pool sits more than 2% away from Chainlink, so nobody can push the pool to take value from you.",
    },
    {
      t: "The keeper places it",
      d: "It swaps about half into the stock and puts both into one concentrated range around Chainlink’s price. When the price walks toward the edge, it moves the range. Every swap is checked against Chainlink and refused past a 1% loss.",
    },
    {
      t: "Fees compound",
      d: `Every trade through the range pays the pool fee. 70% stays in the Pool and raises what each share is worth. 30% goes to the fee router, which sends it to buy $${BRAND.token.symbol} and burn it.`,
    },
  ];
  return (
    <section className="block frame" id="how">
      <div className="block-head">
        <h2>How a Pool earns</h2>
        <p>The keeper does the liquidity work. The contract decides what it is allowed to do.</p>
      </div>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.t}>
            <span className="step-n" aria-hidden="true">
              {i + 1}
            </span>
            <h3>{s.t}</h3>
            <p>{s.d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SpoolSection() {
  const { data: burned } = useBurned();
  const [copied, setCopied] = useState(false);
  const { symbol, address } = BRAND.token;
  return (
    <section className="block frame spool" id="spool">
      <div>
        <h2>Where the other 30% goes</h2>
        <p>
          Every Pool and every credit line sends its protocol share to StockpoolBuyBurn. That contract can do one thing with it: buy $
          {symbol} on its Pons pool and burn it, at most once an hour and in small runs. It has no withdraw function.
        </p>
        {burned !== undefined && burned > 0n && (
          <p className="burned">
            <b>{num(Number(formatUnits(burned, 18)))}</b> ${symbol} burned so far
          </p>
        )}
      </div>
      <div className="ca">
        <p className="ca-label">${symbol} contract address</p>
        {address ? (
          <button
            className="ca-addr"
            onClick={() => {
              navigator.clipboard?.writeText(address).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {address}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        ) : (
          <p className="ca-soon">The official address appears here once ${symbol} is live. Anything posted before that is not ours.</p>
        )}
        {CONTRACTS.buyBurn && (
          <a className="ext" href={addressUrl(CONTRACTS.buyBurn)} target="_blank" rel="noopener">
            StockpoolBuyBurn on the explorer
          </a>
        )}
      </div>
    </section>
  );
}
