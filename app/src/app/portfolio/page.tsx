"use client";

import { useAccount } from "wagmi";
import { roundsAbi } from "@/generated/abis";
import { CONTRACTS, LIVE, txUrl } from "@/lib/config";
import { amount } from "@/lib/format";
import { settledReturns, signedPct, usePositions, type Position } from "@/lib/rounds";
import { useTx } from "@/lib/tx";
import { Footer, Header } from "@/components/Header";
import { useOpenWallet } from "@/components/Wallet";

const label: Record<string, string> = { open: "Deposits open", locked: "Running", settled: "Settled", void: "Void: refunded" };

export default function PortfolioPage() {
  const { address } = useAccount();
  const openWallet = useOpenWallet();
  const { data, isLoading } = usePositions();
  const tx = useTx();
  const claimable = (data ?? []).filter((p) => p.claimable > 0n);

  async function claimAll() {
    await tx.run(`Claim ${claimable.length} round${claimable.length === 1 ? "" : "s"}`, async ({ call }) =>
      call({ address: CONTRACTS.rounds!, abi: roundsAbi, functionName: "claimMany", args: [claimable.map((p) => BigInt(p.round.id)), address!] }),
    );
  }

  return (
    <>
      <Header />
      <main className="frame page">
        <div className="page-head plain">
          <div>
            <h1>Portfolio</h1>
            <p>Your Shield and Boost positions in recent rounds. Claims pay in the round&apos;s Stock Token.</p>
          </div>
        </div>
        {!LIVE ? (
          <p className="note">The rounds open when the contracts are live.</p>
        ) : !address ? (
          <button className="button" onClick={openWallet}>
            Connect wallet
          </button>
        ) : isLoading || !data ? (
          <p className="note">Reading your positions…</p>
        ) : data.length === 0 ? (
          <div className="empty">
            <p>No positions yet.</p>
            <a className="button" href="/#rounds">
              Pick a side in this week&apos;s rounds
            </a>
          </div>
        ) : (
          <>
            {claimable.length > 0 && (
              <div className="sb-claimbar">
                <span>
                  {claimable.length} round{claimable.length === 1 ? "" : "s"} ready to claim
                </span>
                <button className="button" disabled={tx.busy} onClick={claimAll}>
                  Claim all
                </button>
              </div>
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
            <div className="table-wrap">
              <table className="pools">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Status</th>
                    <th className="num">Shield</th>
                    <th className="num">Boost</th>
                    <th className="num">Result</th>
                    <th className="num">To claim</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((p) => (
                    <Row key={p.round.id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

function Row({ p }: { p: Position }) {
  const ret = settledReturns(p.round);
  const result = ret ? [p.shield > 0n ? `Shield ${signedPct(ret.shield)}` : "", p.boost > 0n ? `Boost ${signedPct(ret.boost)}` : ""].filter(Boolean).join(" · ") : "—";
  return (
    <tr>
      <td>
        <a href={`/stock/?t=${p.ticker}`}>
          {p.ticker} #{p.round.id}
        </a>
      </td>
      <td>{p.claimed ? "Claimed" : label[p.round.state] ?? p.round.state}</td>
      <td className="num">{p.shield > 0n ? amount(p.shield, 18) : "—"}</td>
      <td className="num">{p.boost > 0n ? amount(p.boost, 18) : "—"}</td>
      <td className="num">{result}</td>
      <td className="num">{p.claimable > 0n ? `${amount(p.claimable, 18)} ${p.ticker}` : "—"}</td>
    </tr>
  );
}
