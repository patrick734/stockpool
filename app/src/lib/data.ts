"use client";

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { basketAbi, buyBurnAbi, creditDeskAbi, oracleAbi, positionAbi, vaultAbi } from "@/generated/abis";
import { CHAIN_ID, CONTRACTS, POOLS, USDG, poolOf, type Pool } from "./config";

export const ONE = 10n ** 18n; // every Robinhood Stock Token has 18 decimals
/** Pool, Basket and credit-line shares have 12 decimals (USDG's 6 plus a 6-decimal offset against share-price games). */
export const SHARE_DECIMALS = 12;
const SHARE_ONE = 10n ** 12n;
const REFRESH = 20_000;

export type PoolState = Pool & {
  value?: bigint; // USDG value of everything the Pool holds, at Chainlink; undefined while the price is stale
  supply: bigint;
  cap: bigint;
  paused: boolean;
  fresh: boolean;
  usable: boolean; // fresh price and the pool within its deviation limit: deposits and USDG exits are open
  holdings?: readonly [bigint, bigint]; // stock, USDG
  protocolShareBps: number;
  feesUsdg: bigint; // gross fees earned so far, stock fees valued at today's price
  price?: bigint; // USDG per share of stock, 6 dp
  sharePrice?: bigint; // USDG per Pool share, 6 dp
  placed: boolean;
  range?: { low: number; high: number; now: number }; // the keeper's range and the pool price, in USDG per share
};

const tickPrice = (tick: number, stockIsToken0: boolean) => {
  const raw = Math.pow(1.0001, tick); // token1 per token0, raw units
  return stockIsToken0 ? raw * 1e12 : 1e12 / raw; // USDG per whole share of stock
};

/** Every Pool's public state. */
export function usePools() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["pools", CHAIN_ID],
    enabled: Boolean(client && POOLS.length),
    refetchInterval: REFRESH,
    queryFn: async (): Promise<PoolState[]> => {
      const all = await Promise.all(
        POOLS.map(async (p): Promise<PoolState | null> => {
          try {
            const r = <T,>(functionName: string, args: readonly unknown[] = []) =>
              client!.readContract({ address: p.vault, abi: vaultAbi, functionName, args } as never) as Promise<T>;
            const q = <T,>(functionName: string) => client!.readContract({ address: p.position, abi: positionAbi, functionName } as never) as Promise<T>;
            const [supply, cap, paused, fresh, holdings, protocolShareBps, grossU, grossS, liquidity] = await Promise.all([
              r<bigint>("totalSupply"),
              r<bigint>("heldValueCap"),
              r<boolean>("paused"),
              r<boolean>("priceFresh"),
              // Valued at Chainlink inside the Pool, so this fails while the price is stale.
              r<readonly [bigint, bigint]>("holdings").catch(() => undefined),
              r<number>("protocolShareBps"),
              r<bigint>("grossUsdgFees"),
              r<bigint>("grossStockFees"),
              q<bigint>("liquidity").catch(() => 0n),
            ]);
            const usable = fresh ? await r<boolean>("priceUsable").catch(() => false) : false;
            const price =
              fresh && CONTRACTS.oracle
                ? await client!.readContract({ address: CONTRACTS.oracle, abi: oracleAbi, functionName: "usdgValue", args: [p.stock, ONE] }).catch(() => undefined)
                : undefined;
            const value = price !== undefined && holdings ? holdings[1] + (holdings[0] * price) / ONE : undefined;
            const sharePrice = supply > 0n && value !== undefined ? (value * SHARE_ONE) / supply : undefined;
            let range: PoolState["range"];
            if (liquidity > 0n) {
              try {
                const [[, tick], lower, upper, s0] = await Promise.all([q<readonly [bigint, number]>("slot0"), q<number>("tickLower"), q<number>("tickUpper"), q<boolean>("stockIsToken0")]);
                const a = tickPrice(lower, s0), b = tickPrice(upper, s0);
                range = { low: Math.min(a, b), high: Math.max(a, b), now: tickPrice(tick, s0) };
              } catch {
                range = undefined;
              }
            }
            const feesUsdg = grossU + (price !== undefined ? (grossS * price) / ONE : 0n);
            return { ...p, value, supply, cap, paused, fresh, usable, holdings, protocolShareBps: Number(protocolShareBps), feesUsdg, price, sharePrice, placed: liquidity > 0n, range };
          } catch {
            return null; // one unreadable Pool never hides the others
          }
        }),
      );
      const read = all.filter((x): x is PoolState => x !== null);
      if (!read.length) throw new Error("Could not read any Pool"); // an RPC outage, not an empty list
      return read;
    },
  });
}

/** The connected wallet's side of one Pool. */
export function usePoolAccount(pool?: Pool) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { address } = useAccount();
  return useQuery({
    queryKey: ["poolAccount", CHAIN_ID, pool?.vault, address],
    enabled: Boolean(client && pool && address),
    refetchInterval: REFRESH,
    queryFn: async () => {
      const r = <T,>(functionName: string, args: readonly unknown[] = []) =>
        client!.readContract({ address: pool!.vault, abi: vaultAbi, functionName, args } as never) as Promise<T>;
      const shares = await r<bigint>("balanceOf", [address!]);
      const [value, maxWithdraw, maxDeposit, usdgBalance] = await Promise.all([
        shares > 0n ? r<bigint>("convertToAssets", [shares]).catch(() => undefined) : Promise.resolve(0n),
        r<bigint>("maxWithdraw", [address!]),
        r<bigint>("maxDeposit", [address!]),
        client!.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [address!] }),
      ]);
      return { shares, value, maxWithdraw, maxDeposit, usdgBalance };
    },
  });
}

/** The Basket and the connected wallet's place in it. */
export function useBasket() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { address } = useAccount();
  const basket = CONTRACTS.basket;
  return useQuery({
    queryKey: ["basket", CHAIN_ID, basket, address],
    enabled: Boolean(client && basket),
    refetchInterval: REFRESH,
    queryFn: async () => {
      const r = <T,>(functionName: string, args: readonly unknown[] = []) =>
        client!.readContract({ address: basket!, abi: basketAbi, functionName, args } as never) as Promise<T>;
      const [pools, idle, cap, paused, usable, maxAllocationBps, supply] = await Promise.all([
        r<readonly Address[]>("pools"),
        r<bigint>("idle"),
        r<bigint>("heldValueCap"),
        r<boolean>("paused"),
        r<boolean>("pricesUsable"),
        r<number>("maxAllocationBps"),
        r<bigint>("totalSupply"),
      ]);
      const total = await r<bigint>("totalAssets").catch(() => undefined); // fails only while a price is stale
      const parts = await Promise.all(
        pools.map(async (v) => {
          const shares = (await client!.readContract({ address: v, abi: vaultAbi, functionName: "balanceOf", args: [basket!] })) as bigint;
          const value = shares > 0n ? await (client!.readContract({ address: v, abi: vaultAbi, functionName: "convertToAssets", args: [shares] }) as Promise<bigint>).catch(() => undefined) : 0n;
          return { vault: v, ticker: POOLS.find((p) => p.vault.toLowerCase() === v.toLowerCase())?.ticker ?? "?", shares, value };
        }),
      );
      let me = null;
      if (address) {
        const [shares, maxWithdraw, maxDeposit, usdgBalance] = await Promise.all([
          r<bigint>("balanceOf", [address]),
          r<bigint>("maxWithdraw", [address]),
          r<bigint>("maxDeposit", [address]),
          client!.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
        ]);
        const value = shares > 0n ? await r<bigint>("convertToAssets", [shares]).catch(() => undefined) : 0n;
        me = { shares, value, maxWithdraw, maxDeposit, usdgBalance };
      }
      return { address: basket!, pools: parts, idle, cap, paused, usable, maxAllocationBps: Number(maxAllocationBps), supply, total, me };
    },
  });
}

/** One credit line, and the connected wallet's position in it. */
export function useCreditLine(desk: Address, vault: Address) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { address } = useAccount();
  return useQuery({
    queryKey: ["credit", CHAIN_ID, desk, address],
    enabled: Boolean(client),
    refetchInterval: REFRESH,
    queryFn: async () => {
      const r = <T,>(functionName: string, args: readonly unknown[] = []) =>
        client!.readContract({ address: desk, abi: creditDeskAbi, functionName, args } as never) as Promise<T>;
      const [supplied, debt, utilization, borrowRate, supplyRate, risk, supplyCap, borrowCap, paused, totalPledged, vaultSupply] = await Promise.all([
        r<bigint>("totalAssets"),
        r<bigint>("totalDebt"),
        r<bigint>("utilization"),
        r<bigint>("borrowRatePerYear"),
        r<bigint>("supplyRatePerYear"),
        r<readonly [number, number, number, number, number, number]>("risk"),
        r<bigint>("supplyCap"),
        r<bigint>("borrowCap"),
        r<boolean>("paused"),
        r<bigint>("totalCollateralShares"),
        client!.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }) as Promise<bigint>,
      ]);
      let me = null;
      if (address) {
        const [lent, acct, myDebt, collateral, borrowable, health, shares, usdgBal, maxDeposit] = await Promise.all([
          r<bigint>("maxWithdraw", [address]),
          r<readonly [bigint, bigint]>("accounts", [address]),
          r<bigint>("debtOf", [address]),
          r<bigint>("collateralValue", [address]).catch(() => undefined),
          r<bigint>("borrowable", [address]),
          r<bigint>("healthFactor", [address]).catch(() => undefined),
          client!.readContract({ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
          client!.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
          r<bigint>("maxDeposit", [address]),
        ]);
        me = { lent, pledged: acct[0], debt: myDebt, collateral, borrowable, health, shares, usdgBal, maxDeposit };
      }
      return { supplied, debt, utilization, borrowRate, supplyRate, risk, supplyCap, borrowCap, paused, totalPledged, vaultSupply, me };
    },
  });
}

/** $SPOOL burned so far by StockpoolBuyBurn. */
export function useBurned() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  return useQuery({
    queryKey: ["burned", CHAIN_ID],
    enabled: Boolean(client && CONTRACTS.buyBurn),
    refetchInterval: 60_000,
    queryFn: async () => (await client!.readContract({ address: CONTRACTS.buyBurn!, abi: buyBurnAbi, functionName: "totalBurned" })) as bigint,
  });
}

/** Everything the connected wallet holds across Stockpool. */
export function usePortfolio(lines: { ticker: string; desk: Address }[]) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { address } = useAccount();
  return useQuery({
    queryKey: ["portfolio", CHAIN_ID, address],
    enabled: Boolean(client && address && POOLS.length),
    refetchInterval: REFRESH,
    queryFn: async () => {
      const pools = await Promise.all(
        POOLS.map(async (p) => {
          const shares = (await client!.readContract({ address: p.vault, abi: vaultAbi, functionName: "balanceOf", args: [address!] })) as bigint;
          const value = shares > 0n ? await (client!.readContract({ address: p.vault, abi: vaultAbi, functionName: "convertToAssets", args: [shares] }) as Promise<bigint>).catch(() => undefined) : 0n;
          return { ...p, shares, value };
        }),
      );
      let basket = null;
      if (CONTRACTS.basket) {
        const shares = (await client!.readContract({ address: CONTRACTS.basket, abi: basketAbi, functionName: "balanceOf", args: [address!] })) as bigint;
        const value = shares > 0n ? await (client!.readContract({ address: CONTRACTS.basket, abi: basketAbi, functionName: "convertToAssets", args: [shares] }) as Promise<bigint>).catch(() => undefined) : 0n;
        basket = { shares, value };
      }
      const credit = await Promise.all(
        lines.map(async (l) => {
          const r = <T,>(functionName: string, args: readonly unknown[]) => client!.readContract({ address: l.desk, abi: creditDeskAbi, functionName, args } as never) as Promise<T>;
          const [lent, acct, debt] = await Promise.all([r<bigint>("maxWithdraw", [address!]).catch(() => 0n), r<readonly [bigint, bigint]>("accounts", [address!]), r<bigint>("debtOf", [address!])]);
          const lentShares = await r<bigint>("balanceOf", [address!]);
          const lentValue = lentShares > 0n ? await r<bigint>("convertToAssets", [lentShares]) : 0n;
          const vault = poolOf(l.ticker)?.vault;
          const collateral =
            acct[0] > 0n && vault
              ? await (client!.readContract({ address: vault, abi: vaultAbi, functionName: "convertToAssets", args: [acct[0]] }) as Promise<bigint>).catch(() => 0n)
              : 0n;
          return { ticker: l.ticker, desk: l.desk, lent: lentValue > lent ? lentValue : lent, pledged: acct[0], collateral, debt };
        }),
      );
      return { pools, basket, credit };
    },
  });
}
