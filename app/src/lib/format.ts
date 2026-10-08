import { formatUnits, parseUnits } from "viem";

/** US dollars from a 6-decimal USDG amount: $1,234.56, or whole dollars from $10,000 up. */
export function usd(v: bigint | undefined, whole = false): string {
  if (v === undefined) return "—";
  const n = Number(formatUnits(v, 6));
  const digits = whole || n >= 10_000 ? 0 : 2;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A plain number with sensible precision. */
export function num(n: number | undefined, maxSig = 6): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumSignificantDigits: maxSig });
}

export const amount = (v: bigint | undefined, decimals: number) => (v === undefined ? "—" : num(Number(formatUnits(v, decimals))));
export const pct = (fraction: number, digits = 1) => `${(fraction * 100).toFixed(digits)}%`;

/** Parses what the user typed; undefined if it isn't a valid amount. */
export function parseAmount(s: string, decimals: number): bigint | undefined {
  if (!s || !/^\d*\.?\d*$/.test(s) || s === ".") return undefined;
  try {
    const [w, f = ""] = s.split(".");
    const v = parseUnits(`${w || "0"}.${f.slice(0, decimals)}`, decimals);
    return v > 0n ? v : undefined;
  } catch {
    return undefined;
  }
}

export const trimZeros = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
