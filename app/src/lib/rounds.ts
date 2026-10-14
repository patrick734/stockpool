"use client";

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { roundsAbi } from "@/generated/abis";
import { CHAIN_ID, CONTRACTS, SERIES, type Series } from "./config";

export const ONE = 10n ** 18n; // every Robinhood Stock Token has 18 decimals
export const SHIELD = 0;
export const BOOST = 1;
const SCAN = 120; // most recent rounds read on every refresh
const REFRESH = 20_000;

export const STATE = ["none", "open", "locked", "settled", "void"] as const;
export type RoundState = (typeof STATE)[number];

export type Round = {
  id: number;
  seriesId: number;
  lockAt: number;
  endAt: number;
  couponBps: number;
  feeBps: number;
  maxRatioBps: number;
  state: RoundState;
  shieldIn: bigint;
  boostIn: bigint;
  shieldMatched: bigint;
  startPrice: bigint;
  endPrice: bigint;
  shieldOut: bigint;
  boostOut: bigint;
  fee: bigint;
};

export type SeriesState = Series & {
  price?: bigint; // latest Chainlink answer, 8 decimals
  priceAt?: number;
  paused: boolean;
  couponBps: number;
  maxRatioBps: number;
  feeBps: number;
  open?: Round; // taking deposits
  running?: Round; // locked, not ended (or ended and waiting to be settled)
  history: Round[]; // settled or void, newest first
};

const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

function toRound(id: number, r: Record<string, unknown>): Round {
  return {
    id,
    seriesId: Number(r.seriesId),
    lockAt: Number(r.lockAt),
    endAt: Number(r.endAt),
    couponBps: Number(r.couponBps),
    feeBps: Number(r.feeBps),
    maxRatioBps: Number(r.maxRatioBps),
    state: STATE[Number(r.state)] ?? "none",
    shieldIn: r.shieldIn as bigint,
    boostIn: r.boostIn as bigint,
    shieldMatched: r.shieldMatched as bigint,
    startPrice: r.startPrice as bigint,
    endPrice: r.endPrice as bigint,
    shieldOut: r.shieldOut as bigint,
    boostOut: r.boostOut as bigint,
    fee: r.fee as bigint,
  };
}

/** The most recent rounds, by id (newest first). */
export function useRounds() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["rounds", CHAIN_ID],
    enabled: Boolean(client && CONTRACTS.rounds),
    refetchInterval: REFRESH,
    queryFn: async (): Promise<Round[]> => {
      const rounds = CONTRACTS.rounds!;
      const count = Number(await client!.readContract({ address: rounds, abi: roundsAbi, functionName: "roundCount" }));
      const ids = Array.from({ length: Math.min(count, SCAN) }, (_, i) => count - i);
      const rows = await Promise.all(ids.map((id) => client!.readContract({ address: rounds, abi: roundsAbi, functionName: "round", args: [BigInt(id)] })));
      return rows.map((r, i) => toRound(ids[i], r as unknown as Record<string, unknown>));
    },
  });
}

/** Every stock's live price and its open, running and past rounds. */
export function useSeries() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const rounds = useRounds();
  const live = useQuery({
    queryKey: ["series", CHAIN_ID],
    enabled: Boolean(client && CONTRACTS.rounds),
    refetchInterval: REFRESH,
    queryFn: async () =>
      Promise.all(
        SERIES.map(async (s) => {
          const [info, feed] = await Promise.all([
            client!.readContract({ address: CONTRACTS.rounds!, abi: roundsAbi, functionName: "series", args: [BigInt(s.id)] }),
            client!.readContract({ address: s.feed, abi: feedAbi, functionName: "latestRoundData" }).catch(() => undefined),
          ]);
          return { info: info as unknown as Record<string, unknown>, feed };
        }),
      ),
  });
  const data: SeriesState[] | undefined =
    live.data &&
    SERIES.map((s, i) => {
      const { info, feed } = live.data[i];
      const mine = (rounds.data ?? []).filter((r) => r.seriesId === s.id);
      return {
        ...s,
        price: feed && feed[1] > 0n ? feed[1] : undefined,
        priceAt: feed ? Number(feed[3]) : undefined,
        paused: Boolean(info.paused),
        couponBps: Number(info.couponBps),
        maxRatioBps: Number(info.maxRatioBps),
        feeBps: Number(info.feeBps),
        open: mine.find((r) => r.state === "open"),
        running: mine.find((r) => r.state === "locked"),
        history: mine.filter((r) => r.state === "settled" || r.state === "void"),
      };
    });
  return { data, isLoading: live.isLoading || rounds.isLoading, error: live.error || rounds.error };
}

export type Position = { round: Round; ticker: string; shield: bigint; boost: bigint; refunded: boolean; claimed: boolean; claimable: bigint };

/** The connected wallet's positions in recent rounds. */
export function usePositions() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { address } = useAccount();
  const rounds = useRounds();
  return useQuery({
    queryKey: ["positions", CHAIN_ID, address, rounds.data?.length, rounds.dataUpdatedAt],
    enabled: Boolean(client && address && rounds.data),
    refetchInterval: REFRESH,
    queryFn: async (): Promise<Position[]> => {
      const list = rounds.data!;
      const rows = await Promise.all(
        list.map(async (r) => {
          const [p, c] = await Promise.all([
            client!.readContract({ address: CONTRACTS.rounds!, abi: roundsAbi, functionName: "positions", args: [BigInt(r.id), address!] }),
            client!.readContract({ address: CONTRACTS.rounds!, abi: roundsAbi, functionName: "claimable", args: [BigInt(r.id), address!] }),
          ]);
          const [shield, boost, refunded, claimed] = p as readonly [bigint, bigint, boolean, boolean];
          const ticker = SERIES.find((s) => s.id === r.seriesId)?.ticker ?? "?";
          return { round: r, ticker, shield, boost, refunded, claimed, claimable: c as bigint };
        }),
      );
      return rows.filter((p) => p.shield > 0n || p.boost > 0n);
    },
  });
}

/** A Stock Token balance and allowance for the Rounds contract. */
export function useStockWallet(token?: Address) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { address } = useAccount();
  return useQuery({
    queryKey: ["wallet", CHAIN_ID, token, address],
    enabled: Boolean(client && token && address),
    refetchInterval: REFRESH,
    queryFn: async () => {
      const [balance, allowance] = await Promise.all([
        client!.readContract({ address: token!, abi: erc20Abi, functionName: "balanceOf", args: [address!] }),
        client!.readContract({ address: token!, abi: erc20Abi, functionName: "allowance", args: [address!, CONTRACTS.rounds!] }),
      ]);
      return { balance, allowance };
    },
  });
}

// ---------------------------------------------------------------- the payout math, as in StockpoolRounds._split

const mulDiv = (a: bigint, b: bigint, c: bigint) => (a * b) / c;

export function matchedShield(shieldIn: bigint, boostIn: bigint, maxRatioBps: number) {
  const cap = mulDiv(boostIn, BigInt(maxRatioBps), 10_000n);
  return shieldIn < cap ? shieldIn : cap;
}

/** Shield's and Boost's totals (in stock) if a round with these deposits ended at `endPrice`. */
export function split(o: { shieldMatched: bigint; boostIn: bigint; startPrice: bigint; endPrice: bigint; couponBps: number; feeBps: number }) {
  const total = o.shieldMatched + o.boostIn;
  if (o.endPrice <= 0n || o.startPrice <= 0n) return { shieldOut: 0n, boostOut: 0n, fee: 0n };
  const owed = mulDiv(o.shieldMatched, o.startPrice * (10_000n + BigInt(o.couponBps)), o.endPrice * 10_000n);
  const shieldOut = owed < total ? owed : total;
  const boostGross = total - shieldOut;
  const breakEven = mulDiv(o.boostIn, o.startPrice, o.endPrice);
  const fee = boostGross > breakEven ? mulDiv(boostGross - breakEven, BigInt(o.feeBps), 10_000n) : 0n;
  return { shieldOut, boostOut: boostGross - fee, fee };
}

/** Dollar return of each side for a price move, from the round's totals. */
export function returns(o: { shieldMatched: bigint; boostIn: bigint; couponBps: number; feeBps: number; move: number }) {
  const start = 10n ** 8n;
  const end = BigInt(Math.round(1e8 * (1 + o.move)));
  const s = split({ shieldMatched: o.shieldMatched, boostIn: o.boostIn, startPrice: start, endPrice: end, couponBps: o.couponBps, feeBps: o.feeBps });
  const usdRet = (out: bigint, inn: bigint) => (inn === 0n ? 0 : Number((out * end * 1_000_000n) / (inn * start)) / 1_000_000 - 1);
  return { shield: usdRet(s.shieldOut, o.shieldMatched), boost: usdRet(s.boostOut, o.boostIn) };
}

/** Boost's leverage: how much stock exposure each unit of Boost carries. */
export const leverage = (shieldMatched: bigint, boostIn: bigint) => (boostIn === 0n ? 0 : Number(((shieldMatched + boostIn) * 100n) / boostIn) / 100);

/** A settled round's dollar return for each side. */
export function settledReturns(r: Round) {
  if (r.state !== "settled" || r.startPrice === 0n) return null;
  const usd = (out: bigint, inn: bigint) => (inn === 0n ? null : Number((out * r.endPrice * 1_000_000n) / (inn * r.startPrice)) / 1_000_000 - 1);
  return { move: Number(r.endPrice - r.startPrice) / Number(r.startPrice), shield: usd(r.shieldOut, r.shieldMatched), boost: usd(r.boostOut, r.boostIn) };
}

export function countdown(t: number, now: number) {
  let s = Math.max(0, t - now);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const price8 = (v?: bigint) => (v === undefined ? "—" : "$" + (Number(v) / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const signedPct = (f: number | null | undefined, digits = 1) =>
  f === null || f === undefined || !Number.isFinite(f) ? "—" : `${f > 0 ? "+" : f < 0 ? "−" : ""}${Math.abs(f * 100).toFixed(digits)}%`;
