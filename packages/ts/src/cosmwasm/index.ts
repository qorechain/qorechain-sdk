/**
 * CosmWasm contract interaction for QoreChain.
 *
 * This module rounds out the triple-VM surface (native + EVM + SVM + CosmWasm)
 * with thin, type-safe conveniences over `@cosmjs/cosmwasm-stargate`. It does
 * NOT reimplement cosmjs: the wrappers forward to a `CosmWasmClient` (reads) or
 * `SigningCosmWasmClient` (writes) with QoreChain-friendly defaults.
 *
 * Two construction helpers ({@link createCosmWasmClient}, {@link
 * connectCosmWasmSigner}) build the cosmjs clients against a network's `rpc`
 * endpoint. The wrapper functions, however, accept an already-built client so
 * they are unit-testable with a stubbed fake — no real connection required.
 */

import {
  CosmWasmClient,
  SigningCosmWasmClient,
} from "@cosmjs/cosmwasm-stargate";
import type { OfflineSigner } from "@cosmjs/proto-signing";
import type { Coin, StdFee } from "@cosmjs/amino";

/**
 * Arbitrary JSON value accepted/returned by contract calls. Mirrors cosmjs's
 * `JsonObject` (which is `any`) but keeps our public types honest.
 */
export type ContractMsg = Record<string, unknown>;

/** A `StdFee`, or cosmjs's `"auto"` (simulate) / a raw gas multiplier number. */
export type FeeInput = StdFee | "auto" | number;

/**
 * Read-only slice of `CosmWasmClient` used by the read wrappers. Declaring the
 * methods we use (rather than importing the concrete class) lets tests inject a
 * minimal fake.
 */
export interface CosmWasmReadClient {
  queryContractSmart(address: string, queryMsg: ContractMsg): Promise<unknown>;
  getContract(address: string): Promise<unknown>;
}

/** Signing slice of `SigningCosmWasmClient` used by the write wrappers. */
export interface CosmWasmSigningClient {
  upload(
    senderAddress: string,
    wasmCode: Uint8Array,
    fee: FeeInput,
    memo?: string,
  ): Promise<unknown>;
  instantiate(
    senderAddress: string,
    codeId: number,
    msg: ContractMsg,
    label: string,
    fee: FeeInput,
    options?: InstantiateOpts,
  ): Promise<unknown>;
  execute(
    senderAddress: string,
    contractAddress: string,
    msg: ContractMsg,
    fee: FeeInput,
    memo?: string,
    funds?: readonly Coin[],
  ): Promise<unknown>;
}

/** Options for {@link instantiate}: cosmjs `InstantiateOptions` plus the fee. */
export interface InstantiateOpts {
  /** Fee for the instantiate tx. Defaults to `"auto"` (simulate). */
  fee?: FeeInput;
  /** Optional memo. */
  memo?: string;
  /** Native funds sent to the new contract on instantiation. */
  funds?: readonly Coin[];
  /** Optional admin address (can migrate the contract). */
  admin?: string;
}

/**
 * Connect a read-only {@link CosmWasmClient} to a network's RPC endpoint.
 *
 * @param rpcUrl - The network's `rpc` endpoint (e.g. `endpoints.rpc`).
 */
export function createCosmWasmClient(rpcUrl: string): Promise<CosmWasmClient> {
  return CosmWasmClient.connect(rpcUrl);
}

/**
 * Connect a {@link SigningCosmWasmClient} for contract writes.
 *
 * @param rpcUrl - The network's `rpc` endpoint.
 * @param signer - An offline signer (e.g. from `@cosmjs/proto-signing`).
 */
export function connectCosmWasmSigner(
  rpcUrl: string,
  signer: OfflineSigner,
): Promise<SigningCosmWasmClient> {
  return SigningCosmWasmClient.connectWithSigner(rpcUrl, signer);
}

/** Run a contract's smart query (`queryContractSmart`). */
export function queryContractSmart<T = unknown>(
  client: CosmWasmReadClient,
  contractAddress: string,
  queryMsg: ContractMsg,
): Promise<T> {
  return client.queryContractSmart(contractAddress, queryMsg) as Promise<T>;
}

/** Fetch a contract's on-chain metadata (`getContract`). */
export function getContractInfo<T = unknown>(
  client: CosmWasmReadClient,
  contractAddress: string,
): Promise<T> {
  return client.getContract(contractAddress) as Promise<T>;
}

/**
 * Instantiate a contract from an uploaded code id.
 *
 * Forwards to `SigningCosmWasmClient.instantiate`, splitting our {@link
 * InstantiateOpts} into cosmjs's positional `fee` (default `"auto"`) and its
 * `InstantiateOptions` (`memo`/`funds`/`admin`).
 */
export function instantiate<T = unknown>(
  client: CosmWasmSigningClient,
  sender: string,
  codeId: number,
  initMsg: ContractMsg,
  label: string,
  opts: InstantiateOpts = {},
): Promise<T> {
  const { fee = "auto", memo, funds, admin } = opts;
  const options: InstantiateOpts = {};
  if (funds !== undefined) options.funds = funds;
  if (admin !== undefined) options.admin = admin;
  if (memo !== undefined) options.memo = memo;
  return client.instantiate(
    sender,
    codeId,
    initMsg,
    label,
    fee,
    options,
  ) as Promise<T>;
}

/** Execute a message against an instantiated contract. */
export function execute<T = unknown>(
  client: CosmWasmSigningClient,
  sender: string,
  contractAddress: string,
  msg: ContractMsg,
  fee: FeeInput,
  funds?: readonly Coin[],
): Promise<T> {
  return client.execute(
    sender,
    contractAddress,
    msg,
    fee,
    undefined,
    funds,
  ) as Promise<T>;
}

/** Upload (store) WASM bytecode, returning the assigned code id in the result. */
export function uploadCode<T = unknown>(
  client: CosmWasmSigningClient,
  sender: string,
  wasmBytes: Uint8Array,
  fee: FeeInput,
): Promise<T> {
  return client.upload(sender, wasmBytes, fee) as Promise<T>;
}
