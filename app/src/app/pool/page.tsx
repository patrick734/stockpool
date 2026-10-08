"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { POOLS, addressUrl, poolOf } from "@/lib/config";
import { usePools } from "@/lib/data";
import { amount, usd } from "@/lib/format";
import { stockToken } from "@/lib/tokens";
import { Footer, Header } from "@/components/Header";
import { PoolPanel } from "@/components/Panels";
import { RangeStrip, poolStatus } from "@/components/Pools";
import { TokenDot } from "@/components/TokenDot";

export default function PoolPage() {
  const [ticker, setTicker] = useState<string | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    setTicker(poolOf(t)?.ticker ?? POOLS[0]?.ticker ?? null);
  }, []);
  const { data: pools } = usePools();
  const p = pools?.find((x) => x.ticker === ticker);
  const meta = poolOf(ticker);

  return (
    <>
      <Header />
      <main className="frame page">
        {!meta ? (
          <p className="note">{POOLS.length ? "Reading the Pool…" : "The Pools open when the contracts are live."}</p>
        ) : (
          <>
            <div className="page-head">
              <TokenDot token={stockToken(meta)} />
              <div>
                <h1>{meta.ticker} Pool</h1>
                <p>
                  {meta.name} and USDG on Uniswap v4{p ? `, ${poolStatus(p).text.toLowerCase()}` : ""}
                </p>
              </div>
            </div>
            <div className="pool-grid">
              <div className="pool-info">
                {p ? (
                  <>
                    <dl className="spec big">
                      <div>
                        <dt>Chainlink price</dt>
                        <dd>{p.price !== undefined ? usd(p.price) : "Price stale"}</dd>
                      </div>
                      {p.value !== undefined && p.value >= 1_000_000n && (
                        <div>
                          <dt>Deposited</dt>
                          <dd>{usd(p.value, true)}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Room left</dt>
                        <dd>{p.value !== undefined ? usd(p.cap > p.value ? p.cap - p.value : 0n, true) : usd(p.cap, true)}</dd>
                      </div>
                      <div>
                        <dt>Fees to depositors</dt>
                        <dd>{((10_000 - p.protocolShareBps) / 100).toFixed(0)}%</dd>
                      </div>
                      {p.feesUsdg >= 10_000n && (
                        <div>
                          <dt>Fees earned so far</dt>
                          <dd>{usd(p.feesUsdg)}</dd>
                        </div>
                      )}
                      {p.sharePrice !== undefined && (
                        <div>
                          <dt>One sp{p.ticker} share</dt>
                          <dd>${Number(formatUnits(p.sharePrice, 6)).toFixed(4)}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="range-card">
                      <h2>Where the money sits</h2>
                      <RangeStrip p={p} />
                      <p className="note">
                        {p.range
                          ? `The band is the Pool’s range: it earns on every trade between ${usd(BigInt(Math.round(p.range.low * 1e6)))} and ${usd(BigInt(Math.round(p.range.high * 1e6)))}. The tall line is Chainlink’s price, the short one the pool’s.`
                          : "No range yet: the keeper places one around Chainlink’s price as soon as there are deposits to place."}
                      </p>
                      {p.holdings && (p.holdings[0] > 0n || p.holdings[1] > 0n) && (
                        <p className="note">
                          Holding {amount(p.holdings[0], 18)} {p.ticker} and {usd(p.holdings[1])}.
                        </p>
                      )}
                    </div>
                    <p className="links">
                      <a className="ext" href={addressUrl(p.vault)} target="_blank" rel="noopener">
                        Pool contract
                      </a>
                      <a className="ext" href={addressUrl(p.position)} target="_blank" rel="noopener">
                        Range contract
                      </a>
                    </p>
                  </>
                ) : (
                  <p className="note">Reading the Pool…</p>
                )}
              </div>
              {p && <PoolPanel key={p.ticker} p={p} />}
            </div>
            <nav className="other-pools" aria-label="Other Pools">
              {POOLS.filter((x) => x.ticker !== meta.ticker).map((x) => (
                <a key={x.ticker} href={`/pool/?t=${x.ticker}`}>
                  <TokenDot token={stockToken(x)} /> {x.ticker} Pool
                </a>
              ))}
            </nav>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
