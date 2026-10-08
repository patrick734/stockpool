import { createConfig, http, injected } from "wagmi";
import { defineChain, type Address } from "viem";
import deployed from "@/generated/deployment.json";

export const CHAIN_ID = 4663;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER = "https://robinhoodchain.blockscout.com";

const addr = (v: unknown) => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined);
type PoolEntry = { vault: string; position: string; stock: string; name: string; feed?: string };
const d = deployed as Partial<{
  block: number;
  usdg: string;
  timelock: string;
  swapAdapter: string;
  buyBurn: string;
  oracle: string;
  feeRouter: string;
  registry: string;
  basket: string;
  pools: Record<string, PoolEntry>;
  creditLines: Record<string, string>;
}>;

export type Pool = { ticker: string; vault: Address; position: Address; stock: Address; name: string };

/** Every Pool, in the order the deploy listed them. Empty until ./launch.sh has run. */
export const POOLS: Pool[] = Object.entries(d.pools ?? {})
  .filter(([, p]) => addr(p.vault) && addr(p.position) && addr(p.stock))
  .map(([ticker, p]) => ({ ticker, vault: p.vault as Address, position: p.position as Address, stock: p.stock as Address, name: p.name }));
export const poolOf = (ticker?: string | null) => POOLS.find((p) => p.ticker === (ticker || "").toUpperCase());

export const CREDIT_LINES: { ticker: string; desk: Address; pool: Pool }[] = Object.entries(d.creditLines ?? {})
  .map(([ticker, desk]) => ({ ticker, desk: addr(desk)!, pool: poolOf(ticker)! }))
  .filter((c) => c.desk && c.pool);

export const CONTRACTS = {
  timelock: addr(d.timelock),
  swapAdapter: addr(d.swapAdapter),
  buyBurn: addr(d.buyBurn),
  oracle: addr(d.oracle),
  feeRouter: addr(d.feeRouter),
  registry: addr(d.registry),
  basket: addr(d.basket),
};
export const USDG = (addr(d.usdg) ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168") as Address;
export const LIVE = POOLS.length > 0;

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
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
