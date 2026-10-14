import { createConfig, http, injected } from "wagmi";
import { defineChain, type Address } from "viem";
import deployed from "@/generated/deployment.json";

const d = deployed as Partial<{
  chainId: number;
  block: number;
  owner: string;
  keeper: string;
  swapAdapter: string;
  buyBurn: string;
  rounds: string;
  series: Record<string, { id: number; token: string; feed: string; name: string }>;
}>;
const addr = (v: unknown) => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined);

export const CHAIN_ID = d.chainId ?? 4663;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER = "https://robinhoodchain.blockscout.com";

export type Series = { id: number; ticker: string; name: string; token: Address; feed: Address };

/** Every stock with Shield & Boost rounds, in the order the deploy listed them. Empty until ./launch.sh has run. */
export const SERIES: Series[] = Object.entries(d.series ?? {})
  .filter(([, s]) => addr(s.token) && addr(s.feed))
  .map(([ticker, s]) => ({ id: s.id, ticker, name: s.name, token: s.token as Address, feed: s.feed as Address }))
  .sort((a, b) => a.id - b.id);
export const seriesOf = (ticker?: string | null) => SERIES.find((s) => s.ticker === (ticker || "").toUpperCase());

export const CONTRACTS = {
  rounds: addr(d.rounds),
  buyBurn: addr(d.buyBurn),
  swapAdapter: addr(d.swapAdapter),
  owner: addr(d.owner),
  keeper: addr(d.keeper),
};
export const LIVE = Boolean(CONTRACTS.rounds && SERIES.length);

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 4663 ? "Robinhood Chain" : "Local chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
});

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [injected()],
  transports: { [robinhoodChain.id]: http(RPC_URL, { batch: true }) },
  ssr: true,
});

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;
