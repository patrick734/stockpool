"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { erc20Abi, type Abi, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { CHAIN_ID } from "./config";
import { walletError } from "@/components/Wallet";

type TxState = { busy: boolean; message?: string; error?: string; hash?: Hash };

/** One user action on a round: switch chain if needed, approve if needed, simulate, send, wait, refresh. */
export function useTx() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const queryClient = useQueryClient();
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<TxState>({ busy: false });

  async function wait(hash: Hash) {
    if (!client) throw new Error("No connection to Robinhood Chain");
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction failed on-chain. Only gas was spent.");
  }

  async function approve(token: Address, spender: Address, amount: bigint) {
    if (!client || !address) throw new Error("Connect a wallet first");
    const current = await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [address, spender] });
    if (current >= amount) return;
    setState({ busy: true, message: "Approve in your wallet…" });
    await wait(await writeContractAsync({ address: token, abi: erc20Abi, chainId: CHAIN_ID, functionName: "approve", args: [spender, amount] }));
  }

  /** Simulates first, so a call that would fail says why before the wallet opens. */
  async function call(params: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<Hash> {
    if (!client || !address) throw new Error("Connect a wallet first");
    const { request } = await client.simulateContract({ ...params, account: address } as Parameters<typeof client.simulateContract>[0]);
    return writeContractAsync({ ...(request as Parameters<typeof writeContractAsync>[0]), chainId: CHAIN_ID });
  }

  async function run(label: string, send: (h: { approve: typeof approve; call: typeof call }) => Promise<Hash>) {
    setState({ busy: true, message: `${label}…` });
    try {
      if (chainId !== CHAIN_ID) {
        setState({ busy: true, message: "Switch your wallet to Robinhood Chain…" });
        await switchChainAsync({ chainId: CHAIN_ID });
      }
      const hash = await send({ approve, call });
      setState({ busy: true, message: `${label}: confirming…`, hash });
      await wait(hash);
      setState({ busy: false, message: `${label}: done.`, hash });
      await queryClient.invalidateQueries();
      return true;
    } catch (e) {
      setState({ busy: false, error: readable(e) });
      return false;
    }
  }

  return { ...state, run, reset: () => setState({ busy: false }) };
}

const KNOWN: Record<string, string> = {
  TooLate: "Deposits for this round have closed. The next round is open for deposits.",
  TooEarly: "Not yet: that happens at the round's lock or end time.",
  WrongState: "The round has moved on (locked, settled or void). Refresh the page.",
  SeriesPausedError: "New deposits in this stock are paused. Withdrawals and claims still work.",
  BelowMinimum: "Below the minimum deposit for this stock.",
  Insufficient: "More than you deposited on that side.",
  NothingToClaim: "Nothing to claim in that round right now.",
  BadPriceRound: "That Chainlink round is not the first one after the round's time.",
  ERC20InsufficientBalance: "Not enough of that stock in your wallet.",
  ERC20InsufficientAllowance: "The approval did not go through. Try again.",
};

/** Wallet errors, and the contracts' own errors, as one plain sentence. */
function readable(e: unknown): string {
  let name: string | undefined;
  for (let x = e as { cause?: unknown; data?: { errorName?: string }; errorName?: string; message?: string } | undefined, i = 0; x && i < 8; i++) {
    name = x.data?.errorName ?? x.errorName ?? /Error: (\w+)\(/.exec(x.message ?? "")?.[1];
    if (name) break;
    x = x.cause as typeof x;
  }
  if (name && KNOWN[name]) return KNOWN[name];
  return walletError(e);
}
