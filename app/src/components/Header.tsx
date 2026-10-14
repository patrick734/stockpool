"use client";

import { useId } from "react";
import { usePathname } from "next/navigation";
import { useAccount, useDisconnect } from "wagmi";
import { BRAND } from "@/lib/brand";
import { CHAIN_ID } from "@/lib/config";
import { short } from "@/lib/format";
import { useOpenWallet } from "./Wallet";

const LINKS = [
  { href: "/", label: "Rounds" },
  { href: "/portfolio/", label: "Portfolio" },
  { href: "/docs/", label: "Docs" },
];

export function Header() {
  const path = usePathname() || "/";
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const openWallet = useOpenWallet();
  const on = (href: string) => (href === "/" ? path === "/" || path.startsWith("/stock") : path.startsWith(href));
  return (
    <header className="masthead">
      <div className="frame masthead-row">
        <a className="brand" href="/" aria-label={`${BRAND.name} home`}>
          <Mark />
          <span>{BRAND.name}</span>
        </a>
        <nav className="menu" aria-label="Main">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} aria-current={on(l.href) ? "page" : undefined}>
              {l.label}
            </a>
          ))}
          <a href="/docs/#spool">${BRAND.token.symbol}</a>
        </nav>
        <div className="masthead-end">
          {isConnected && chainId !== CHAIN_ID && <span className="chain-warn">Wrong network</span>}
          {isConnected ? (
            <button className="button quiet" onClick={() => disconnect()} title="Disconnect">
              {short(address!)}
            </button>
          ) : (
            <button className="button" onClick={openWallet}>
              Connect wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/** The mark: a pool seen from the side, its water held between two range lines. */
export function Mark({ size = 26 }: { size?: number }) {
  const clip = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mark">
      <clipPath id={clip}>
        <rect x="3" y="3" width="26" height="26" rx="9" />
      </clipPath>
      <path d="M2 17.5c3.4-1.7 6.8-1.7 10.2 0s6.8 1.7 10.2 0 6.8-1.7 10.2 0V32H2z" className="mark-water" clipPath={`url(#${clip})`} />
      <rect x="3" y="3" width="26" height="26" rx="9" className="mark-basin" />
      <path d="M8 11.5h16" className="mark-line" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="frame foot-row">
        <div>
          <a className="brand" href="/">
            <Mark size={22} />
            <span>{BRAND.name}</span>
          </a>
          <p>{BRAND.tagline}</p>
        </div>
        <nav aria-label="Footer">
          <a href="/">Rounds</a>
          <a href="/portfolio/">Portfolio</a>
          <a href="/docs/">Docs</a>
          <a href="/docs/#contracts">Contracts</a>
          {BRAND.x && (
            <a href={BRAND.x} target="_blank" rel="noopener">
              X
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
