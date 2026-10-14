"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { roundsAbi } from "@/generated/abis";
import { CONTRACTS, txUrl } from "@/lib/config";
import { amount, parseAmount } from "@/lib/format";
import {
  BOOST,
  SHIELD,
  countdown,
  leverage,
  matchedShield,
  price8,
  returns,
  settledReturns,
  signedPct,
  split,
  useStockWallet,
  usePositions,
  type Round,
  type SeriesState,
} from "@/lib/rounds";
import { stockToken } from "@/lib/tokens";
import { useTx } from "@/lib/tx";
import { TokenDot } from "./TokenDot";
import { useOpenWallet } from "./Wallet";

export function useNow(step = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), step);
    return () => clearInterval(t);
  }, [step]);
  return now;
}

const units = (v: bigint) => Number(formatUnits(v, 18));

/** Shield's matched amount and Boost's leverage for a round's live totals. */
function sides(r: Round) {
  const matched = r.state === "open" ? matchedShield(r.shieldIn, r.boostIn, r.maxRatioBps) : r.shieldMatched;
  return { matched, lev: leverage(matched, r.boostIn) };
}

// ---------------------------------------------------------------- home: one card per stock

export function StockCard({ s }: { s: SeriesState }) {
  const now = useNow(30_000);
  const r = s.open;
  const last = s.history.find((h) => h.state === "settled");
  const lastRet = last ? settledReturns(last) : null;
  const total = r ? r.shieldIn + r.boostIn : 0n;
  const shieldShare = r && total > 0n ? Number((r.shieldIn * 1000n) / total) / 10 : 50;
  const lev = r ? sides(r).lev : 0;
  return (
    <a className="sb-card" href={`/stock/?t=${s.ticker}`}>
      <div className="sb-card-head">
        <TokenDot token={stockToken(s)} />
        <div>
          <b>{s.ticker}</b>
          <em>{s.name}</em>
        </div>
        <span className="sb-price">{price8(s.price)}</span>
      </div>
      {r && total === 0n ? (
        <p className="note sb-empty">Round {r.id} is open: no deposits yet. Be the first on either side.</p>
      ) : null}
      {r && total > 0n ? (
        <>
          <div className="sb-bar" aria-label={`Shield ${shieldShare.toFixed(0)}%, Boost ${(100 - shieldShare).toFixed(0)}% of deposits`}>
            <i className="sb-shield" style={{ width: `${shieldShare}%` }} />
            <i className="sb-boost" style={{ width: `${100 - shieldShare}%` }} />
          </div>
          <div className="sb-card-sides">
            <span>
              <i className="dot sb-shield" /> Shield {amount(r.shieldIn, 18)}
            </span>
            <span>
              Boost {amount(r.boostIn, 18)} <i className="dot sb-boost" />
            </span>
          </div>
        </>
      ) : null}
      {!r && <p className="note">{s.paused ? "Paused: no new rounds." : "Next round opens shortly."}</p>}
      {r && (
        <dl className="sb-card-facts">
          <div>
            <dt>Deposits close</dt>
            <dd>{countdown(r.lockAt, now)}</dd>
          </div>
          <div>
            <dt>Shield coupon</dt>
            <dd>+{(r.couponBps / 100).toFixed(2)}%</dd>
          </div>
          <div>
            <dt>Boost leverage</dt>
            <dd>{lev ? `${lev.toFixed(2)}×` : "—"}</dd>
          </div>
        </dl>
      )}
      <div className="sb-card-foot">
        <span>{lastRet ? `Last week ${signedPct(lastRet.move)}: Shield ${signedPct(lastRet.shield)} · Boost ${signedPct(lastRet.boost)}` : "No settled round yet"}</span>
        <span className="sb-go">Pick a side →</span>
      </div>
    </a>
  );
}

// ---------------------------------------------------------------- the payoff chart

/** Dollar return of Shield and Boost across price moves, for a round's current totals. */
export function Payoff({ shieldMatched, boostIn, couponBps, feeBps, mark }: { shieldMatched: bigint; boostIn: bigint; couponBps: number; feeBps: number; mark?: number }) {
  const W = 560;
  const H = 260;
  const P = { l: 46, r: 14, t: 16, b: 34 };
  const range = 0.3;
  const sample = shieldMatched > 0n && boostIn > 0n ? { s: shieldMatched, b: boostIn } : { s: 3n * 10n ** 18n, b: 10n ** 18n };
  const pts = useMemo(() => {
    const out: { m: number; s: number; b: number }[] = [];
    for (let i = 0; i <= 60; i++) {
      const m = -range + (2 * range * i) / 60;
      const r = returns({ shieldMatched: sample.s, boostIn: sample.b, couponBps, feeBps, move: m });
      out.push({ m, s: r.shield, b: r.boost });
    }
    return out;
  }, [sample.s, sample.b, couponBps, feeBps]);
  const yMax = Math.max(0.3, ...pts.map((p) => Math.min(p.b, 1.5)));
  const yMin = -1;
  const x = (m: number) => P.l + ((m + range) / (2 * range)) * (W - P.l - P.r);
  const y = (v: number) => P.t + ((yMax - Math.max(yMin, Math.min(yMax, v))) / (yMax - yMin)) * (H - P.t - P.b);
  const line = (k: "s" | "b") => pts.map((p, i) => `${i ? "L" : "M"}${x(p.m).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const ticksY = [-1, -0.5, 0, 0.5, 1].filter((t) => t <= yMax);
  return (
    <figure className="payoff">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dollar return of Shield and Boost by how much the stock moves over the round">
        {ticksY.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className={t === 0 ? "pf-zero" : "pf-grid"} />
            <text x={P.l - 8} y={y(t) + 4} className="pf-label" textAnchor="end">
              {t > 0 ? "+" : ""}
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {[-0.3, -0.15, 0, 0.15, 0.3].map((m) => (
          <text key={m} x={x(m)} y={H - 10} className="pf-label" textAnchor="middle">
            {m > 0 ? "+" : ""}
            {Math.round(m * 100)}%
          </text>
        ))}
        <line x1={x(0)} x2={x(0)} y1={P.t} y2={H - P.b} className="pf-grid" />
        {mark !== undefined && Math.abs(mark) <= range && <line x1={x(mark)} x2={x(mark)} y1={P.t} y2={H - P.b} className="pf-mark" />}
        <path d={line("b")} className="pf-boost" />
        <path d={line("s")} className="pf-shield" />
      </svg>
      <figcaption>
        <span>
          <i className="dot sb-shield" /> Shield
        </span>
        <span>
          <i className="dot sb-boost" /> Boost
        </span>
        <span className="note">Dollar return by the stock&apos;s move over the round{shieldMatched > 0n && boostIn > 0n ? ", at this round's totals" : " (example: 3 Shield per Boost)"}.</span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- deposit into the open round

export function DepositPanel({ s }: { s: SeriesState }) {
  const r = s.open;
  const now = useNow();
  const { isConnected } = useAccount();
  const openWallet = useOpenWallet();
  const wallet = useStockWallet(s.token);
  const positions = usePositions();
  const tx = useTx();
  const [side, setSide] = useState<0 | 1>(SHIELD);
  const [text, setText] = useState("");
  const value = parseAmount(text, 18);
  const mine = r ? positions.data?.find((p) => p.round.id === r.id) : undefined;

  if (!r) return <div className="panel"><p className="note">{s.paused ? "New rounds in this stock are paused." : "The next round opens as soon as the running one locks."}</p></div>;

  const shieldIn = r.shieldIn + (side === SHIELD && value ? value : 0n);
  const boostIn = r.boostIn + (side === BOOST && value ? value : 0n);
  const matched = matchedShield(shieldIn, boostIn, r.maxRatioBps);
  const lev = leverage(matched, boostIn);
  const fillPct = side === SHIELD && shieldIn > 0n ? Number((matched * 1000n) / shieldIn) / 10 : 100;
  const moves = [-0.15, -0.05, 0, 0.05, 0.15];

  async function deposit() {
    if (!value || !r) return;
    const ok = await tx.run(side === SHIELD ? "Deposit to Shield" : "Deposit to Boost", async ({ approve, call }) => {
      await approve(s.token, CONTRACTS.rounds!, value);
      return call({ address: CONTRACTS.rounds!, abi: roundsAbi, functionName: "deposit", args: [BigInt(r.id), side, value] });
    });
    if (ok) setText("");
  }
  async function withdraw(which: 0 | 1, amt: bigint) {
    await tx.run("Withdraw", async ({ call }) => call({ address: CONTRACTS.rounds!, abi: roundsAbi, functionName: "withdraw", args: [BigInt(r!.id), which, amt] }));
  }

  return (
    <div className="panel sb-panel">
      <div className="sb-panel-head">
        <h2>Round {r.id}</h2>
        <span className="state live">Deposits open · close in {countdown(r.lockAt, now)}</span>
      </div>
      <div className="tabs sb-tabs" role="tablist">
        <button role="tab" aria-selected={side === SHIELD} className={side === SHIELD ? "on shield" : ""} onClick={() => setSide(SHIELD)}>
          <b>Shield</b>
          <span>Your dollars back + {(r.couponBps / 100).toFixed(2)}%</span>
        </button>
        <button role="tab" aria-selected={side === BOOST} className={side === BOOST ? "on boost" : ""} onClick={() => setSide(BOOST)}>
          <b>Boost</b>
          <span>{lev ? `${lev.toFixed(2)}× the move` : "Leveraged upside"}</span>
        </button>
      </div>
      <p className="note sb-explain">
        {side === SHIELD
          ? `Shield is owed the dollar value you put in plus ${(r.couponBps / 100).toFixed(2)}%, paid first, in ${s.ticker}. It keeps that value whether ${s.ticker} rises or falls, unless the stock falls so far that Boost is wiped out.`
          : `Boost gets everything left after Shield is paid: the stock's upside on the whole pool, and the first losses. ${s.feeBps / 100}% of Boost's profit, if any, buys and burns $SPOOL.`}
      </p>
      <label className="amount-box">
        <div className="amount-top">
          <span>Amount</span>
          {wallet.data && (
            <button className="max" onClick={() => setText(formatUnits(wallet.data!.balance, 18))}>
              Balance {amount(wallet.data.balance, 18)} {s.ticker}
            </button>
          )}
        </div>
        <div className="amount-row">
          <input inputMode="decimal" placeholder="0.0" value={text} onChange={(e) => setText(e.target.value.replace(",", "."))} />
          <span className="unit">
            <TokenDot token={stockToken(s)} /> {s.ticker}
          </span>
        </div>
      </label>
      {value && (
        <table className="sb-scen">
          <caption>If {s.ticker} moves this much by the end ({new Date(r.endAt * 1000).toUTCString().slice(0, 16)}), your deposit in dollars:</caption>
          <tbody>
            <tr>
              {moves.map((m) => (
                <th key={m}>{signedPct(m, 0)}</th>
              ))}
            </tr>
            <tr>
              {moves.map((m) => {
                const ret = returns({ shieldMatched: matched, boostIn, couponBps: r.couponBps, feeBps: r.feeBps, move: m });
                const v = side === SHIELD ? ret.shield : ret.boost;
                return (
                  <td key={m} className={v >= 0 ? "up" : "down"}>
                    {signedPct(v)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      )}
      {side === SHIELD && value && fillPct < 100 && (
        <p className="msg">Right now only {fillPct.toFixed(0)}% of Shield would be matched (Shield is capped at {r.maxRatioBps / 10_000}× Boost). The rest is refunded at the lock.</p>
      )}
      {!isConnected ? (
        <button className="button wide" onClick={openWallet}>
          Connect wallet
        </button>
      ) : (
        <button className={`button wide ${side === SHIELD ? "sb-btn-shield" : "sb-btn-boost"}`} disabled={!value || tx.busy || (wallet.data && value > wallet.data.balance)} onClick={deposit}>
          {wallet.data && value && value > wallet.data.balance ? `Not enough ${s.ticker}` : `${side === SHIELD ? "Shield" : "Boost"} ${value ? amount(value, 18) : ""} ${s.ticker}`}
        </button>
      )}
      {(tx.message || tx.error) && (
        <p className={`msg ${tx.error ? "err" : "ok"}`}>
          {tx.error ?? tx.message}{" "}
          {tx.hash && (
            <a href={txUrl(tx.hash)} target="_blank" rel="noopener">
              View
            </a>
          )}
        </p>
      )}
      {mine && (mine.shield > 0n || mine.boost > 0n) && (
        <div className="holding">
          <span>Your deposits this round</span>
          {mine.shield > 0n && (
            <span>
              <b>{amount(mine.shield, 18)}</b> Shield{" "}
              <button className="button small quiet" disabled={tx.busy} onClick={() => withdraw(SHIELD, mine.shield)}>
                Take back
              </button>
            </span>
          )}
          {mine.boost > 0n && (
            <span>
              <b>{amount(mine.boost, 18)}</b> Boost{" "}
              <button className="button small quiet" disabled={tx.busy} onClick={() => withdraw(BOOST, mine.boost)}>
                Take back
              </button>
            </span>
          )}
        </div>
      )}
      <p className="note fine">You can take deposits back until the round locks. You need {s.ticker} Stock Tokens on Robinhood Chain in your wallet.</p>
    </div>
  );
}

// ---------------------------------------------------------------- the running round

export function RunningPanel({ s }: { s: SeriesState }) {
  const r = s.running;
  const now = useNow();
  if (!r) return null;
  const move = s.price && r.startPrice > 0n ? Number(s.price - r.startPrice) / Number(r.startPrice) : undefined;
  const ifNow = s.price ? split({ shieldMatched: r.shieldMatched, boostIn: r.boostIn, startPrice: r.startPrice, endPrice: s.price, couponBps: r.couponBps, feeBps: r.feeBps }) : null;
  const ret = move !== undefined ? returns({ shieldMatched: r.shieldMatched, boostIn: r.boostIn, couponBps: r.couponBps, feeBps: r.feeBps, move }) : null;
  const ended = now >= r.endAt;
  return (
    <div className="panel sb-panel">
      <div className="sb-panel-head">
        <h2>Round {r.id} is running</h2>
        <span className={`state ${ended ? "wait" : "live"}`}>{ended ? "Ended: settling" : `Ends in ${countdown(r.endAt, now)}`}</span>
      </div>
      <dl className="spec">
        <div>
          <dt>Start price</dt>
          <dd>{price8(r.startPrice)}</dd>
        </div>
        <div>
          <dt>Now (Chainlink)</dt>
          <dd>
            {price8(s.price)} <small className={move !== undefined && move >= 0 ? "up" : "down"}>{signedPct(move)}</small>
          </dd>
        </div>
        <div>
          <dt>Shield / Boost</dt>
          <dd>
            {amount(r.shieldMatched, 18)} / {amount(r.boostIn, 18)} {s.ticker}
          </dd>
        </div>
        <div>
          <dt>Boost leverage</dt>
          <dd>{leverage(r.shieldMatched, r.boostIn).toFixed(2)}×</dd>
        </div>
      </dl>
      {ret && ifNow && (
        <div className="sb-ifnow">
          <span>If it ended at today&apos;s price</span>
          <b className="shield">Shield {signedPct(ret.shield)}</b>
          <b className="boost">Boost {signedPct(ret.boost)}</b>
        </div>
      )}
      <Payoff shieldMatched={r.shieldMatched} boostIn={r.boostIn} couponBps={r.couponBps} feeBps={r.feeBps} mark={move} />
    </div>
  );
}

// ---------------------------------------------------------------- past rounds

export function History({ s }: { s: SeriesState }) {
  if (!s.history.length) return <p className="note">No round of {s.ticker} has ended yet.</p>;
  return (
    <div className="table-wrap">
      <table className="pools sb-history">
        <thead>
          <tr>
            <th>Round</th>
            <th>Ended</th>
            <th className="num">End price</th>
            <th className="num">Move</th>
            <th className="num">Shield</th>
            <th className="num">Boost</th>
          </tr>
        </thead>
        <tbody>
          {s.history.map((r) => {
            const ret = settledReturns(r);
            return (
              <tr key={r.id}>
                <td>#{r.id}</td>
                <td>{new Date(r.endAt * 1000).toUTCString().slice(5, 11)}</td>
                <td className="num">{r.state === "void" ? "void: refunded" : price8(r.endPrice)}</td>
                <td className="num">{ret ? signedPct(ret.move) : "—"}</td>
                <td className="num">{ret ? signedPct(ret.shield) : "—"}</td>
                <td className={`num ${ret && (ret.boost ?? 0) >= 0 ? "up" : "down"}`}>{ret ? signedPct(ret.boost) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const roundsTotal = (list: SeriesState[] | undefined) =>
  (list ?? []).reduce((t, s) => t + (s.open ? units(s.open.shieldIn + s.open.boostIn) * (Number(s.price ?? 0n) / 1e8) : 0) + (s.running ? units(s.running.shieldMatched + s.running.boostIn) * (Number(s.price ?? 0n) / 1e8) : 0), 0);
