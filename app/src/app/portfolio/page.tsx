"use client";

import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { CREDIT_LINES, LIVE, poolOf } from "@/lib/config";
import { SHARE_DECIMALS, usePortfolio } from "@/lib/data";
import { num, usd } from "@/lib/format";
import { stockToken } from "@/lib/tokens";
import { Footer, Header } from "@/components/Header";
import { TokenDot } from "@/components/TokenDot";
import { useOpenWallet } from "@/components/Wallet";

const shares = (v: bigint) => num(Number(formatUnits(v, SHARE_DECIMALS)));

export default function PortfolioPage() {
  const { address } = useAccount();
  const openWallet = useOpenWallet();
  const { data } = usePortfolio(CREDIT_LINES.map((c) => ({ ticker: c.ticker, desk: c.desk })));
  const pools = data?.pools.filter((p) => p.shares > 0n) ?? [];
  const basket = data?.basket && data.basket.shares > 0n ? data.basket : null;
  const credit = data?.credit.filter((c) => c.lent > 0n || c.pledged > 0n || c.debt > 0n) ?? [];
  const total = pools.reduce((s, p) => s + (p.value ?? 0n), 0n) + (basket?.value ?? 0n) + credit.reduce((s, c) => s + c.lent + c.collateral - c.debt, 0n);
  const empty = data && !pools.length && !basket && !credit.length;

  return (
    <>
      <Header />
      <main className="frame page">
        <div className="page-head plain">
          <div>
            <h1>Portfolio</h1>
            <p>{address && total > 0n ? `${usd(total)} across Stockpool, valued at Chainlink’s prices.` : "Everything your wallet holds across Stockpool."}</p>
          </div>
        </div>
        {!LIVE ? (
          <p className="note">Stockpool opens when the contracts are live.</p>
        ) : !address ? (
          <div className="empty">
            <p>Connect a wallet to see your Pools, Basket and credit lines.</p>
            <button className="button" onClick={openWallet}>
              Connect wallet
            </button>
          </div>
        ) : !data ? (
          <p className="note">Reading your wallet…</p>
        ) : empty ? (
          <div className="empty">
            <p>Nothing here yet. Deposit USDG into a Pool or the Basket and it shows up here.</p>
            <a className="button" href="/#pools">
              Choose a Pool
            </a>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="pools">
              <thead>
                <tr>
                  <th>Position</th>
                  <th className="num">Shares</th>
                  <th className="num">Worth</th>
                  <th aria-label="Action" />
                </tr>
              </thead>
              <tbody>
                {pools.map((p) => (
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
                    <td className="num">
                      {shares(p.shares)} sp{p.ticker}
                    </td>
                    <td className="num">{p.value !== undefined ? usd(p.value) : "Price stale"}</td>
                    <td className="num">
                      <a className="button small quiet" href={`/pool/?t=${p.ticker}`}>
                        Manage
                      </a>
                    </td>
                  </tr>
                ))}
                {basket && (
                  <tr>
                    <td>
                      <a className="asset" href="/basket/">
                        <span>
                          <b>The Basket</b>
                          <em>Every Pool at once</em>
                        </span>
                      </a>
                    </td>
                    <td className="num">{shares(basket.shares)} spBASKET</td>
                    <td className="num">{basket.value !== undefined ? usd(basket.value) : "Price stale"}</td>
                    <td className="num">
                      <a className="button small quiet" href="/basket/">
                        Manage
                      </a>
                    </td>
                  </tr>
                )}
                {credit.map((c) => {
                  const pool = poolOf(c.ticker);
                  const bits = [c.lent > 0n && `Lent ${usd(c.lent)}`, c.debt > 0n && `borrowed ${usd(c.debt)}`, c.pledged > 0n && `${shares(c.pledged)} sp${c.ticker} pledged`].filter(Boolean);
                  return (
                    <tr key={c.desk}>
                      <td>
                        <a className="asset" href={`/borrow/#line-${c.ticker.toLowerCase()}`}>
                          {pool && <TokenDot token={stockToken(pool)} />}
                          <span>
                            <b>{c.ticker} credit line</b>
                            <em>{(s => s.charAt(0).toUpperCase() + s.slice(1))(bits.join(", "))}</em>
                          </span>
                        </a>
                      </td>
                      <td className="num">{c.pledged > 0n ? `${shares(c.pledged)} sp${c.ticker}` : ""}</td>
                      <td className="num">{(() => { const net = c.lent + c.collateral - c.debt; return net >= 0n ? usd(net) : `−${usd(-net)}`; })()}</td>
                      <td className="num">
                        <a className="button small quiet" href={`/borrow/#line-${c.ticker.toLowerCase()}`}>
                          Manage
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
