import type { Address } from "viem";

export type Token = { address: Address; symbol: string; name: string; decimals: number; kind: "base" | "stock"; logo?: string };

export const stockToken = (s: { token: Address; ticker: string; name: string }): Token => ({ address: s.token, symbol: s.ticker, name: s.name, decimals: 18, kind: "stock" });
