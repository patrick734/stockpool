"use client";

import { useState, type ReactNode } from "react";
import { formatUnits, maxUint256, type Address } from "viem";
import { useAccount } from "wagmi";
import { basketAbi, creditDeskAbi, vaultAbi } from "@/generated/abis";
import { BRAND } from "@/lib/brand";
import { USDG, addressUrl, txUrl, type Pool } from "@/lib/config";
import { SHARE_DECIMALS, useBasket, useCreditLine, usePoolAccount, type PoolState } from "@/lib/data";
import { num, parseAmount, trimZeros, usd } from "@/lib/format";
import { stockToken, usdgToken } from "@/lib/tokens";
import { useTx } from "@/lib/tx";
import { TokenDot } from "./TokenDot";
import { useOpenWallet } from "./Wallet";

type Tx = ReturnType<typeof useTx>;
const shareNum = (v: bigint) => num(Number(formatUnits(v, SHARE_DECIMALS)));

function TxLine({ tx }: { tx: Tx }) {
  if (tx.error) return <p className="msg err">{tx.error}</p>;
  if (!tx.message) return null;
  return (
    <p className={`msg ${tx.busy ? "" : "ok"}`}>
      {tx.message}{" "}
      {tx.hash && (
        <a href={txUrl(tx.hash)} target="_blank" rel="noopener">
          View transaction
        </a>
      )}
    </p>
  );
}

function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length > 4 ? Math.ceil(options.length / 2) : options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, text]) => (
        <button key={v} role="tab" aria-selected={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** An amount box with a Max button and the unit on the right. */
function Amount({ label, value, onChange, max, decimals, unit, maxText }: { label: string; value: string; onChange: (v: string) => void; max?: bigint; decimals: number; unit: ReactNode; maxText?: string }) {
  return (
    <label className="amount-box">
      <span className="amount-top">
        <span>{label}</span>
        {max !== undefined && max > 0n && (
          <button type="button" className="max" onClick={() => onChange(trimZeros(formatUnits(max, decimals)))}>
            Max {maxText}
          </button>
        )}
      </span>
      <span className="amount-row">
        <input inputMode="decimal" placeholder="0" value={value} onChange={(e) => onChange(e.target.value.replace(",", "."))} aria-label={label} />
        <span className="unit">{unit}</span>
      </span>
    </label>
  );
}

function Act({ tx, ready, blocked, label, onClick }: { tx: Tx; ready: boolean; blocked: string | null; label: string; onClick: () => void }) {
  const { address } = useAccount();
  const openWallet = useOpenWallet();
  if (!address)
    return (
      <button className="button wide" onClick={openWallet}>
        Connect wallet
      </button>
    );
  return (
    <button className="button wide" disabled={!ready || tx.busy || Boolean(blocked)} onClick={onClick}>
      {tx.busy ? tx.message : blocked ?? label}
    </button>
  );
}

const USDG_UNIT = (
  <>
    <TokenDot token={usdgToken(USDG)} /> USDG
  </>
);

/* ------------------------------------------------------------------ Pool */

type PoolMode = "deposit" | "withdraw" | "kind";

export function PoolPanel({ p }: { p: PoolState }) {
  const { address } = useAccount();
  const { data: a } = usePoolAccount(p);
  const tx = useTx();
  const [mode, setMode] = useState<PoolMode>("deposit");
  const [input, setInput] = useState("");
  const kind = mode === "kind";
  const amt = parseAmount(input, kind ? SHARE_DECIMALS : 6);
  const limit = mode === "deposit" ? (a ? (a.usdgBalance < a.maxDeposit ? a.usdgBalance : a.maxDeposit) : undefined) : mode === "withdraw" ? a?.maxWithdraw : a?.shares;
  const blocked =
    mode === "deposit" && p.paused
      ? "Deposits are paused"
      : !kind && !p.usable
        ? p.fresh
          ? "The pool is off Chainlink’s price: withdraw in kind"
          : "No fresh Chainlink price: withdraw in kind"
        : amt && limit !== undefined && amt > limit
          ? mode === "deposit" && a && amt > a.usdgBalance
            ? "Not enough USDG"
            : "More than you can take"
          : null;

  const go = async () => {
    if (!amt || !address) return;
    let ok = false;
    if (mode === "deposit")
      ok = await tx.run(`Depositing into the ${p.ticker} Pool`, async ({ approve, call }) => {
        await approve(USDG, p.vault, amt);
        return call({ address: p.vault, abi: vaultAbi, functionName: "deposit", args: [amt, address] });
      });
    else if (mode === "withdraw")
      ok = await tx.run("Withdrawing", ({ call }) =>
        // All of it: redeem every share (an exact withdrawal would need extra shares to cover selling the stock part).
        a && limit !== undefined && amt >= limit
          ? call({ address: p.vault, abi: vaultAbi, functionName: "redeem", args: [a.shares, address, address] })
          : call({ address: p.vault, abi: vaultAbi, functionName: "withdraw", args: [amt, address, address] }),
      );
    else ok = await tx.run("Withdrawing in kind", ({ call }) => call({ address: p.vault, abi: vaultAbi, functionName: "redeemInKind", args: [amt, address, address, 0n, 0n] }));
    if (ok) setInput("");
  };

  const notes: Record<PoolMode, string> = {
    deposit: `Your USDG goes into the ${p.ticker} Pool and the keeper places it in the ${p.ticker}/USDG range with everyone else’s. Shares are priced at Chainlink, never at the pool, so nobody can push the pool’s price to take value from you.`,
    withdraw: "Pays exactly this much USDG. If the Pool has to sell some stock to raise it, that cost (at most 1%) is yours, not the other depositors’.",
    kind: `Your share of the ${p.ticker} and USDG the Pool holds, with no swap and no price needed. Works when the market is closed or the Pool is paused.`,
  };

  return (
    <div className="panel">
      <Tabs
        label="Pool action"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setInput("");
          tx.reset();
        }}
        options={[
          ["deposit", "Deposit"],
          ["withdraw", "Withdraw"],
          ["kind", "In kind"],
        ]}
      />
      <Amount
        label={kind ? "Pool shares" : mode === "deposit" ? "You deposit" : "You withdraw"}
        value={input}
        onChange={setInput}
        max={limit}
        decimals={kind ? SHARE_DECIMALS : 6}
        maxText={limit === undefined ? "" : kind ? shareNum(limit) : usd(limit)}
        unit={kind ? `sp${p.ticker}` : USDG_UNIT}
      />
      {address && a && a.shares > 0n && (a.value === undefined || a.value >= 10_000n) && (
        <p className="holding">
          You hold <b>{a.value !== undefined ? usd(a.value) : `${shareNum(a.shares)} sp${p.ticker}`}</b> in this Pool.
        </p>
      )}
      <p className="note">{notes[mode]}</p>
      <Act tx={tx} ready={Boolean(amt)} blocked={blocked} onClick={go} label={mode === "deposit" ? `Deposit into the ${p.ticker} Pool` : mode === "withdraw" ? "Withdraw USDG" : `Withdraw ${p.ticker} and USDG`} />
      <TxLine tx={tx} />
    </div>
  );
}

/* ------------------------------------------------------------------ Basket */

type BasketMode = "deposit" | "withdraw" | "kind";

export function BasketPanel() {
  const { address } = useAccount();
  const { data: b } = useBasket();
  const tx = useTx();
  const [mode, setMode] = useState<BasketMode>("deposit");
  const [input, setInput] = useState("");
  if (!b) return <div className="panel"><p className="note">Reading the Basket…</p></div>;
  const me = b.me;
  const kind = mode === "kind";
  const amt = parseAmount(input, kind ? SHARE_DECIMALS : 6);
  const limit = mode === "deposit" ? (me ? (me.usdgBalance < me.maxDeposit ? me.usdgBalance : me.maxDeposit) : undefined) : mode === "withdraw" ? me?.maxWithdraw : me?.shares;
  const blocked =
    mode === "deposit" && b.paused
      ? "Deposits are paused"
      : !kind && !b.usable
        ? "A Pool’s price is stale or off Chainlink: withdraw in kind"
        : amt && limit !== undefined && amt > limit
          ? mode === "deposit" && me && amt > me.usdgBalance
            ? "Not enough USDG"
            : "More than you can take"
          : null;
  const go = async () => {
    if (!amt || !address) return;
    let ok = false;
    if (mode === "deposit")
      ok = await tx.run("Depositing into the Basket", async ({ approve, call }) => {
        await approve(USDG, b.address, amt);
        return call({ address: b.address, abi: basketAbi, functionName: "deposit", args: [amt, address] });
      });
    else if (mode === "withdraw") ok = await tx.run("Withdrawing", ({ call }) => call({ address: b.address, abi: basketAbi, functionName: "withdraw", args: [amt, address, address] }));
    else ok = await tx.run("Withdrawing in kind", ({ call }) => call({ address: b.address, abi: basketAbi, functionName: "redeemInKind", args: [amt, address, address] }));
    if (ok) setInput("");
  };
  const notes: Record<BasketMode, string> = {
    deposit: `One deposit, spread across every Pool. The keeper keeps about a fifth in USDG for withdrawals and moves the rest into the Pools, at most ${(b.maxAllocationBps / 100).toFixed(0)}% into any one.`,
    withdraw: "Paid from the USDG the Basket keeps on hand. For more than that, withdraw in kind.",
    kind: "Your share of the Basket’s USDG plus your share of its shares in each Pool, sent to your wallet. No price needed. You can then withdraw from each Pool.",
  };
  return (
    <div className="panel">
      <Tabs
        label="Basket action"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setInput("");
          tx.reset();
        }}
        options={[
          ["deposit", "Deposit"],
          ["withdraw", "Withdraw"],
          ["kind", "In kind"],
        ]}
      />
      <Amount
        label={kind ? "Basket shares" : mode === "deposit" ? "You deposit" : "You withdraw"}
        value={input}
        onChange={setInput}
        max={limit}
        decimals={kind ? SHARE_DECIMALS : 6}
        maxText={limit === undefined ? "" : kind ? shareNum(limit) : usd(limit)}
        unit={kind ? "spBASKET" : USDG_UNIT}
      />
      {address && me && me.shares > 0n && (me.value === undefined || me.value >= 10_000n) && (
        <p className="holding">
          You hold <b>{me.value !== undefined ? usd(me.value) : `${shareNum(me.shares)} spBASKET`}</b> in the Basket.
        </p>
      )}
      <p className="note">{notes[mode]}</p>
      <Act tx={tx} ready={Boolean(amt)} blocked={blocked} onClick={go} label={mode === "deposit" ? "Deposit into the Basket" : mode === "withdraw" ? "Withdraw USDG" : "Withdraw in kind"} />
      <TxLine tx={tx} />
    </div>
  );
}

/* ------------------------------------------------------------------ Credit line */

const TABS = [
  ["pledge", "Pledge"],
  ["borrow", "Borrow"],
  ["repay", "Repay"],
  ["release", "Release"],
  ["lend", "Lend"],
  ["withdraw", "Take back"],
] as const;
type Tab = (typeof TABS)[number][0];
const WAD = 10n ** 18n;
const rate = (v?: bigint) => (v === undefined ? "—" : `${(Number(formatUnits(v, 18)) * 100).toFixed(2)}%`);

export function CreditLine({ ticker, desk, pool }: { ticker: string; desk: Address; pool: Pool }) {
  const { address } = useAccount();
  const { data: s } = useCreditLine(desk, pool.vault);
  const tx = useTx();
  const [tab, setTab] = useState<Tab>("pledge");
  const [input, setInput] = useState("");
  const shares = tab === "pledge" || tab === "release";
  const amt = parseAmount(input, shares ? SHARE_DECIMALS : 6);
  const me = s?.me;
  const min = (x?: bigint, y?: bigint) => (x === undefined || y === undefined ? undefined : x < y ? x : y);
  const pledgeRoom = s ? (() => {
    const cap = (s.vaultSupply * BigInt(s.risk[4])) / 10_000n;
    return cap > s.totalPledged ? cap - s.totalPledged : 0n;
  })() : undefined;
  const limit: bigint | undefined = me
    ? { lend: min(me.usdgBal, me.maxDeposit), withdraw: me.lent, pledge: min(me.shares, pledgeRoom), borrow: me.borrowable, repay: min(me.debt, me.usdgBal), release: me.pledged }[tab]
    : undefined;

  const go = async () => {
    if (!amt || !address) return;
    const c = (fn: string, args: readonly unknown[]) => ({ address: desk, abi: creditDeskAbi, functionName: fn, args });
    const actions: Record<Tab, () => Promise<boolean>> = {
      lend: () =>
        tx.run("Lending", async ({ approve, call }) => {
          await approve(USDG, desk, amt);
          return call(c("deposit", [amt, address]));
        }),
      withdraw: () => tx.run("Taking it back", ({ call }) => call(c("withdraw", [amt, address, address]))),
      pledge: () =>
        tx.run("Pledging", async ({ approve, call }) => {
          await approve(pool.vault, desk, amt);
          return call(c("pledge", [amt]));
        }),
      borrow: () => tx.run("Borrowing", ({ call }) => call(c("borrow", [amt, address]))),
      repay: () =>
        tx.run("Repaying", async ({ approve, call }) => {
          // Interest accrues until the transaction lands: a full repayment sends the max and the line caps it.
          const full = me && amt >= me.debt && me.usdgBal > me.debt + me.debt / 1000n;
          await approve(USDG, desk, full ? amt + amt / 1000n + 1n : amt);
          return call(c("repay", [full ? maxUint256 : amt, address]));
        }),
      release: () => tx.run("Releasing", ({ call }) => call(c("release", [amt, address]))),
    };
    if (await actions[tab]()) setInput("");
  };

  const blurb: Record<Tab, string> = {
    pledge: `Pledge ${ticker} Pool shares (sp${ticker}) as collateral. They keep earning the Pool’s fees while pledged.`,
    borrow: "Borrow USDG against what you pledged, up to the loan-to-value limit. Needs a fresh Chainlink price. The rate moves with how much of the line is in use.",
    repay: "Repay any part of your loan whenever you like. Repaying never waits for a price.",
    release: "Take pledged shares back. With a loan open, what stays pledged must still cover it.",
    lend: `Lend USDG to ${ticker} borrowers and earn the interest they pay. You get sc${ticker} lender shares.`,
    withdraw: "Take lent USDG back, up to the cash the line holds right now.",
  };
  const paused = s?.paused && (tab === "lend" || tab === "pledge" || tab === "borrow");
  const blocked = paused ? "Paused by the guardian" : amt && limit !== undefined && amt > limit ? "More than you can take" : null;
  const health = me?.health;
  const healthText = health === undefined ? "…" : health > 1000n * WAD ? "no loan" : Number(formatUnits(health, 18)).toFixed(2);
  const inUse = s ? Number(formatUnits(s.utilization, 18)) : 0;

  return (
    <article className="line" id={`line-${ticker.toLowerCase()}`}>
      <div className="line-info">
        <div className="line-head">
          <TokenDot token={stockToken(pool)} />
          <div>
            <h3>{ticker} credit line</h3>
            <p>Borrow USDG against {ticker} Pool shares</p>
          </div>
          <a href={addressUrl(desk)} target="_blank" rel="noopener" className="ext">
            Contract
          </a>
        </div>
        <dl className="spec">
          <div>
            <dt>Borrow up to</dt>
            <dd>{s ? `${(s.risk[0] / 100).toFixed(0)}% of value` : "…"}</dd>
          </div>
          <div>
            <dt>Liquidation past</dt>
            <dd>{s ? `${(s.risk[1] / 100).toFixed(0)}% of value` : "…"}</dd>
          </div>
          <div>
            <dt>Borrow rate</dt>
            <dd>{rate(s?.borrowRate)} a year</dd>
          </div>
          <div>
            <dt>Lenders earn</dt>
            <dd>{s && s.supplyRate > 0n ? `${rate(s.supplyRate)} a year` : "Borrowers’ interest"}</dd>
          </div>
          <div>
            <dt>Lent in</dt>
            <dd>{s ? (s.supplied >= 1_000_000n ? usd(s.supplied, true) : "Open to lenders") : "…"}</dd>
          </div>
          <div>
            <dt>Borrowed</dt>
            <dd>{s ? (inUse >= 0.01 ? `${(inUse * 100).toFixed(0)}% of the line` : "None yet") : "…"}</dd>
          </div>
        </dl>
        <p className="note">
          {s
            ? `If a loan grows past ${(s.risk[1] / 100).toFixed(0)}% of the pledged shares’ value, anyone can repay up to half of it and take shares worth ${(s.risk[2] / 100).toFixed(0)}% more than they repaid.`
            : ""}
        </p>
        {me && (me.pledged > 0n || me.debt > 0n || me.lent > 0n) && (
          <dl className="spec mine">
            {me.pledged > 0n && (
              <div>
                <dt>You pledged</dt>
                <dd>
                  {shareNum(me.pledged)} sp{ticker}
                  {me.collateral ? `, worth ${usd(me.collateral)}` : ""}
                </dd>
              </div>
            )}
            {me.debt > 0n && (
              <div>
                <dt>Your loan</dt>
                <dd>
                  {usd(me.debt)}, health {healthText}
                </dd>
              </div>
            )}
            {me.borrowable > 0n && (
              <div>
                <dt>You can still borrow</dt>
                <dd>{usd(me.borrowable)}</dd>
              </div>
            )}
            {me.lent > 0n && (
              <div>
                <dt>You lent</dt>
                <dd>{usd(me.lent)}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
      <div className="panel">
        <Tabs
          label={`${ticker} credit line action`}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setInput("");
            tx.reset();
          }}
          options={TABS}
        />
        <Amount
          label={shares ? "Pool shares" : "USDG"}
          value={input}
          onChange={setInput}
          max={limit}
          decimals={shares ? SHARE_DECIMALS : 6}
          maxText={limit === undefined ? "" : shares ? shareNum(limit) : usd(limit)}
          unit={shares ? `sp${ticker}` : USDG_UNIT}
        />
        <p className="note">{blurb[tab]}</p>
        <Act tx={tx} ready={Boolean(amt)} blocked={blocked} onClick={go} label={TABS.find(([t]) => t === tab)![1]} />
        <TxLine tx={tx} />
      </div>
    </article>
  );
}

export const FEE_NOTE = `70% of every swap fee stays with depositors; 30% buys $${BRAND.token.symbol} and burns it.`;
