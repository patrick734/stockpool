"use client";

import { formatUnits } from "viem";
import { usd } from "@/lib/format";
import type { PoolState } from "@/lib/data";
import { stockToken } from "@/lib/tokens";
import { TokenDot } from "./TokenDot";

const price = (v?: bigint) => (v === undefined ? undefined : Number(formatUnits(v, 6)));
const money = (n?: number) => (n === undefined ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Where a Pool stands, in a few words. */
export function poolStatus(p: PoolState): { text: string; tone: "live" | "wait" | "off" } {
  if (p.paused) return { text: "Deposits paused", tone: "off" };
  if (!p.fresh) return { text: "Waiting for a price", tone: "wait" };
  if (!p.usable) return { text: "Off Chainlink’s price", tone: "wait" };
  if (!p.placed) return p.value && p.value > 0n ? { text: "Being placed", tone: "wait" } : { text: "Ready for deposits", tone: "wait" };
  if (p.range && (p.range.now < p.range.low || p.range.now > p.range.high)) return { text: "Moving its range", tone: "wait" };
  return { text: "Earning fees", tone: "live" };
}

/**
 * A Pool's range on a strip spanning 20% either side of Chainlink's price: the band is where the Pool's money sits,
 * the tall mark is Chainlink's price and the short one is the pool's own price.
 */
export function RangeStrip({ p, label = true }: { p: PoolState; label?: boolean }) {
  const ref = price(p.price) ?? p.range?.now;
  if (!ref) return <div className="strip strip-empty" aria-hidden="true" />;
  const lo = ref * 0.8;
  const hi = ref * 1.2;
  const at = (v: number) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  const band = p.range ? { left: at(p.range.low), width: Math.max(1.2, at(p.range.high) - at(p.range.low)) } : null;
  const desc = p.range
    ? `${p.ticker}: range ${money(p.range.low)} to ${money(p.range.high)}, Chainlink ${money(ref)}`
    : `${p.ticker}: no range placed yet, Chainlink ${money(ref)}`;
  return (
    <div className="strip" role="img" aria-label={desc}>
      <div className="strip-track">
        {band && <i className="strip-band" style={{ left: `${band.left}%`, width: `${band.width}%` }} />}
        {p.range && <i className="strip-pool" style={{ left: `${at(p.range.now)}%` }} />}
        <i className="strip-oracle" style={{ left: `${at(ref)}%` }} />
      </div>
      {label && p.range && (
        <div className="strip-scale">
          <span>{money(p.range.low)}</span>
          <span>{money(p.range.high)}</span>
        </div>
      )}
    </div>
  );
}

/** The hero: every Pool's range at a glance. */
export function PoolBoard({ pools, offline }: { pools?: PoolState[]; offline?: boolean }) {
  return (
    <div className="board">
      <div className="board-head">
        <h2>Pools right now</h2>
        <p>Band: where each Pool’s money sits. Line: Chainlink’s price.</p>
      </div>
      <ul className="board-list">
        {(pools ?? []).map((p) => {
          const s = poolStatus(p);
          return (
            <li key={p.vault}>
              <a href={`/pool/?t=${p.ticker}`} className="board-row">
                <TokenDot token={stockToken(p)} />
                <span className="board-name">
                  <b>{p.ticker}</b>
                  <em>{money(price(p.price))}</em>
                </span>
                <RangeStrip p={p} label={false} />
                <span className={`state ${s.tone}`}>{s.text}</span>
              </a>
            </li>
          );
        })}
        {!pools && <li className="board-loading">{offline ? "Can’t reach Robinhood Chain right now. Trying again…" : "Reading the Pools…"}</li>}
      </ul>
    </div>
  );
}

/** Every Pool, one row each. */
export function PoolTable({ pools }: { pools?: PoolState[] }) {
  return (
    <div className="table-wrap">
      <table className="pools">
        <thead>
          <tr>
            <th>Pool</th>
            <th className="num hide-s">Chainlink price</th>
            <th className="num">Deposited</th>
            <th className="num hide-s">Fees earned</th>
            <th className="hide-s">Range</th>
            <th aria-label="Action" />
          </tr>
        </thead>
        <tbody>
          {(pools ?? []).map((p) => {
            const s = poolStatus(p);
            return (
              <tr key={p.vault}>
                <td>
                  <a className="asset" href={`/pool/?t=${p.ticker}`}>
                    <TokenDot token={stockToken(p)} />
                    <span>
                      <b>{p.ticker} Pool</b>
                      <em>{p.name}</em>
                    </span>
                  </a>
                </td>
                <td className="num hide-s">{money(price(p.price))}</td>
                <td className="num">{p.value && p.value >= 1_000_000n ? usd(p.value, true) : <span className="soft">Open</span>}</td>
                <td className="num hide-s">{p.feesUsdg >= 10_000n ? usd(p.feesUsdg) : <span className="soft">—</span>}</td>
                <td className="hide-s range-cell">
                  <RangeStrip p={p} label={false} />
                  <span className={`state ${s.tone}`}>{s.text}</span>
                </td>
                <td className="num">
                  <a className="button small" href={`/pool/?t=${p.ticker}`}>
                    Deposit
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
