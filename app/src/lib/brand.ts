import deployed from "@/generated/deployment.json";

const gen = deployed as { token?: string | null; tokenSymbol?: string | null };
const isAddr = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

/** Everything brand-specific lives here. */
export const BRAND = {
  name: "Stockpool",
  tagline: "Shield or Boost a tokenized stock, one week at a time, on Robinhood Chain.",
  domain: (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
  x: process.env.NEXT_PUBLIC_X_URL || "",
  /** $SPOOL, launched on Pons from the dev wallet; set-token.sh records it in src/generated/deployment.json. */
  token: {
    symbol: gen.tokenSymbol || "SPOOL",
    address: (isAddr(gen.token) ? gen.token : "") as `0x${string}` | "",
  },
};
