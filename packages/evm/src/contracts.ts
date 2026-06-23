/**
 * Thin contract deploy/call wrappers over viem that default to the QoreChain
 * chain bound on the supplied client. These exist so the common cases need no
 * extra `chain`/`account` plumbing; for advanced use, call viem directly.
 */

import type {
  Abi,
  Account,
  Hash,
  Hex,
  PublicClient,
  WalletClient,
} from "viem";

/** Arguments for {@link deployContract}. */
export interface DeployContractArgs {
  /** Contract ABI (used for typed constructor args). */
  abi: Abi;
  /** Creation bytecode (`0x`-prefixed). */
  bytecode: Hex;
  /** Constructor arguments, if any. */
  args?: readonly unknown[];
}

/**
 * Deploy a contract using the wallet client's bound account and chain.
 * Returns the deployment transaction hash.
 */
export function deployContract(
  client: WalletClient,
  { abi, bytecode, args }: DeployContractArgs,
): Promise<Hash> {
  return client.deployContract({
    abi,
    bytecode,
    args,
    account: client.account as Account,
    chain: client.chain,
  } as Parameters<WalletClient["deployContract"]>[0]);
}

/**
 * Typed `readContract` passthrough. Defaults nothing beyond viem; provided so
 * callers can stay on a single import surface.
 */
export function readContract(
  client: PublicClient,
  params: Parameters<PublicClient["readContract"]>[0],
): ReturnType<PublicClient["readContract"]> {
  return client.readContract(params);
}

/**
 * Typed `writeContract` wrapper that defaults `account` and `chain` from the
 * wallet client when the caller omits them.
 */
export function writeContract(
  client: WalletClient,
  params: Parameters<WalletClient["writeContract"]>[0],
): Promise<Hash> {
  const p = params as Record<string, unknown>;
  return client.writeContract({
    account: client.account as Account,
    chain: client.chain,
    ...p,
  } as Parameters<WalletClient["writeContract"]>[0]);
}
