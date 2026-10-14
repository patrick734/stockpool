"use client";

import { useEffect, useState } from "react";
import { SERIES, addressUrl, seriesOf } from "@/lib/config";
import { price8, useSeries } from "@/lib/rounds";
import { stockToken } from "@/lib/tokens";
import { Footer, Header } from "@/components/Header";
import { DepositPanel, History, Payoff, RunningPanel } from "@/components/Rounds";
import { TokenDot } from "@/components/TokenDot";

export default function StockPage() {
  const [ticker, setTicker] = useState<string | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    setTicker(seriesOf(t)?.ticker ?? SERIES[0]?.ticker ?? null);
  }, []);
  const { data } = useSeries();
  const s = data?.find((x) => x.ticker === ticker);
  const meta = seriesOf(ticker);

  return (
    <>
      <Header />
      <main className="frame page">
        {!meta ? (
          <p className="note">{SERIES.length ? "Reading the rounds…" : "The rounds open when the contracts are live."}</p>
        ) : (
          <>
            <div className="page-head">
              <TokenDot token={stockToken(meta)} />
              <div>
                <h1>{meta.ticker}</h1>
                <p>
                  {meta.name} · {s ? `${price8(s.price)} on Chainlink` : "reading…"} ·{" "}
                  <a className="ext" href={addressUrl(meta.token)} target="_blank" rel="noopener">
                    Stock Token
                  </a>
                </p>
              </div>
            </div>
            {s && (
              <div className="pool-grid sb-stock">
                <div className="sb-col">
                  <RunningPanel s={s} />
                  {!s.running && s.open && (
                    <div className="panel sb-panel">
                      <h2>How the sides pay</h2>
                      <Payoff shieldMatched={0n} boostIn={0n} couponBps={s.open.couponBps} feeBps={s.open.feeBps} />
                    </div>
                  )}
                  <div className="panel sb-panel">
                    <h2>Past rounds</h2>
                    <History s={s} />
                  </div>
                </div>
                <DepositPanel s={s} />
              </div>
            )}
            <nav className="other-pools" aria-label="Other stocks">
              {SERIES.filter((x) => x.ticker !== meta.ticker).map((x) => (
                <a key={x.ticker} href={`/stock/?t=${x.ticker}`} onClick={() => setTicker(x.ticker)}>
                  <TokenDot token={stockToken(x)} /> {x.ticker}
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
