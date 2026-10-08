import type { Address } from "viem";

export type Token = { address: Address; symbol: string; name: string; decimals: number; kind: "base" | "stock"; logo?: string };

export const stockToken = (p: { stock: Address; ticker: string; name: string }): Token => ({ address: p.stock, symbol: p.ticker, name: p.name, decimals: 18, kind: "stock" });
export const usdgToken = (address: Address): Token => ({ address, symbol: "USDG", name: "Global Dollar", decimals: 6, kind: "base" });
