/**
 * High-level Cross-VM client — unified calls across QoreChain's three VMs.
 *
 * QoreChain runs EVM, SVM, and CosmWasm side by side and lets a single native
 * account invoke a contract on any of them through the `x/crossvm` module's
 * {@link MsgCrossVMCall}. This helper wraps that message — and the cross-VM query
 * client — so an app developer never hand-builds a `{ typeUrl, value }`, encodes a
 * payload by hand, or remembers a service/method name.
 *
 * The headline capability is {@link CrossVMClient.callAtomic}: pack several
 * `MsgCrossVMCall` messages into ONE transaction body so they execute atomically
 * under a single signature — e.g. an EVM call, an SVM call, and a CosmWasm call
 * that all land together or not at all.
 *
 * Per-VM payload encoding (pick exactly one shape per call):
 *  - `{ payload }` — raw bytes / hex, passed through unchanged.
 *  - `{ evm: { abi, functionName, args } }` — ABI-encoded with viem's
 *    `encodeFunctionData` (selector + args). Requires the optional `viem` peer.
 *  - `{ cosmwasm: object }` — `JSON.stringify` then UTF-8 bytes (the CosmWasm
 *    execute-msg convention).
 *  - `{ svm: { data } }` — raw bytes / hex (already an SVM instruction blob).
 *
 * Construct one with {@link createCrossVMClient}, passing a connected
 * {@link TxClient} (for writes) and, optionally, a {@link CrossVmQueryClient}
 * and/or a {@link QorClient} for the reads.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import { crossvm as crossvmMsg } from "../messages/qorechain";
import type { TxClient, FeeInput, AutoFeeOptions } from "../tx/builder";
import type { BroadcastResult } from "../tx/broadcast";
import type { CrossVmQueryClient } from "../query/grpc";
import type { QorClient } from "../query/qor";
import type { Coin } from "../query/rest";
import type { QueryMessageResponse } from "../codegen/qorechain/crossvm/v1/query";

/** The three execution environments a cross-VM call can target. */
export type VMType = "evm" | "cosmwasm" | "svm";

/** The set of supported VM type strings. */
export const VM_TYPES = ["evm", "cosmwasm", "svm"] as const satisfies readonly VMType[];

/** A hex string (`0x`-prefixed) as accepted for raw payloads. */
export type Hex = `0x${string}`;

/** Raw, pre-encoded payload — passed through to the chain unchanged. */
export interface RawPayload {
  /** The opaque payload bytes (raw `Uint8Array` or `0x`-hex). */
  payload: Uint8Array | Hex;
}

/** EVM payload built by ABI-encoding a function call with viem. */
export interface EvmPayload {
  evm: {
    /** The contract ABI (viem `Abi`-compatible array). */
    abi: readonly unknown[];
    /** The function to call. */
    functionName: string;
    /** The call arguments. */
    args?: readonly unknown[];
  };
}

/** CosmWasm payload: a JSON execute-message object (stringified to UTF-8). */
export interface CosmWasmPayload {
  /** The CosmWasm execute message (e.g. `{ transfer: { ... } }`). */
  cosmwasm: object;
}

/** SVM payload: a pre-built instruction blob (raw bytes / hex). */
export interface SvmPayload {
  svm: {
    /** The SVM instruction data (raw `Uint8Array` or `0x`-hex). */
    data: Uint8Array | Hex;
  };
}

/** Exactly one of the supported payload shapes. */
export type PayloadInput =
  | RawPayload
  | EvmPayload
  | CosmWasmPayload
  | SvmPayload;

/** Shared write-path options forwarded to {@link TxClient.signAndBroadcast}. */
export interface CrossVMWriteOptions {
  /** Fee: an explicit `StdFee` or `"auto"` (simulate + price). Default `"auto"`. */
  fee?: FeeInput;
  /** Optional memo string. */
  memo?: string;
  /** Auto-fee tuning (gas multiplier / gas price) when `fee` is `"auto"`. */
  autoFee?: AutoFeeOptions;
}

/** Common cross-VM call fields (without the payload or write options). */
export interface CrossVMCallBase {
  /** The VM the call originates from. Defaults to `"evm"`. */
  sourceVm?: VMType;
  /** The VM the call targets. */
  targetVm: VMType;
  /** The target contract address/identifier on `targetVm`. */
  targetContract: string;
  /** Optional funds (coins) to forward with the call. */
  funds?: Coin[];
}

/** Options for a single cross-VM call (base + payload). */
export type CrossVMCallOptions = CrossVMCallBase & PayloadInput;

/** Options for {@link CrossVMClient.call} (adds write-path options). */
export type CallOptions = CrossVMCallOptions & CrossVMWriteOptions;

/** Result of a single {@link CrossVMClient.call}. */
export interface CrossVMCallResult {
  /** The cross-VM message id assigned by the chain (parsed from tx events). */
  messageId: string;
  /** The raw broadcast result. */
  result: BroadcastResult;
}

/** Result of an atomic {@link CrossVMClient.callAtomic} batch. */
export interface CrossVMAtomicResult {
  /** The cross-VM message ids assigned by the chain (best-effort, from events). */
  messageIds: string[];
  /** The raw broadcast result for the single packing transaction. */
  result: BroadcastResult;
}

/**
 * Ergonomic client for the `x/crossvm` module.
 *
 * Writes build + sign + broadcast a {@link MsgCrossVMCall}; {@link callAtomic}
 * packs several into one body. {@link buildCall} is the offline build-only path.
 * Reads return the typed query response (or the `qor_` JSON-RPC fallback).
 */
export interface CrossVMClient {
  /** Build, sign, and broadcast a single cross-VM call. */
  call(opts: CallOptions): Promise<CrossVMCallResult>;
  /** Build a single `MsgCrossVMCall` without broadcasting. */
  buildCall(opts: CrossVMCallOptions): EncodeObject;
  /**
   * Pack multiple cross-VM calls into ONE transaction body so they execute
   * atomically under a single signature (the triple-VM headline).
   */
  callAtomic(
    calls: CrossVMCallOptions[],
    opts?: CrossVMWriteOptions,
  ): Promise<CrossVMAtomicResult>;
  /**
   * Read a cross-VM message by id. Uses the typed query client when provided,
   * otherwise falls back to the `qor_getCrossVMMessage` JSON-RPC method.
   */
  getMessage(id: string): Promise<QueryMessageResponse | Record<string, unknown>>;
}

/** Options for {@link createCrossVMClient}. */
export interface CreateCrossVMClientOptions {
  /**
   * Typed query client for {@link CrossVMClient.getMessage} (preferred). Obtain
   * it via {@link connectQueryClients} / {@link createQueryClients}.
   */
  query?: CrossVmQueryClient;
  /**
   * `qor_` JSON-RPC client used as the {@link CrossVMClient.getMessage} fallback
   * (via `qor_getCrossVMMessage`) when no typed query client is supplied.
   */
  qor?: QorClient;
}

const HEX_RE = /^0x[0-9a-fA-F]*$/;

/** Coerce a raw `Uint8Array | Hex` payload to bytes. */
function rawToBytes(data: Uint8Array | Hex): Uint8Array {
  if (typeof data !== "string") return data;
  if (!HEX_RE.test(data)) {
    throw new Error(
      `crossvm: invalid hex payload (expected 0x-prefixed hex, got "${data.slice(0, 12)}...")`,
    );
  }
  const hex = data.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** UTF-8 encode a JSON object (the CosmWasm execute-msg convention). */
function cosmwasmToBytes(msg: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

/**
 * Resolve a {@link PayloadInput} to the raw `Uint8Array` the chain expects.
 *
 * The EVM path lazily imports viem's `encodeFunctionData` so the optional `viem`
 * peer is only required when an `{ evm: ... }` payload is actually used.
 */
async function encodePayload(input: PayloadInput): Promise<Uint8Array> {
  if ("payload" in input) {
    return rawToBytes(input.payload);
  }
  if ("cosmwasm" in input) {
    return cosmwasmToBytes(input.cosmwasm);
  }
  if ("svm" in input) {
    return rawToBytes(input.svm.data);
  }
  // EVM: ABI-encode the call (selector + args) via viem.
  const { encodeFunctionData } = await import("viem");
  const data = encodeFunctionData({
    // viem's Abi typing is structurally compatible; cast at the boundary.
    abi: input.evm.abi as never,
    functionName: input.evm.functionName as never,
    args: (input.evm.args ?? []) as never,
  } as never) as Hex;
  return rawToBytes(data);
}

function requireGetMessageSource(
  query: CrossVmQueryClient | undefined,
  qor: QorClient | undefined,
): void {
  if (!query && !qor) {
    throw new Error(
      "crossvm getMessage requires a query client or a qor client — pass { query } or { qor } to createCrossVMClient",
    );
  }
}

/**
 * Best-effort extraction of cross-VM message ids from a broadcast result.
 *
 * The chain returns the id in `MsgCrossVMCallResponse.messageId`; it is also
 * emitted as a typed event attribute. We scan the broadcast events for any
 * `message_id` / `messageId` attribute so the helper returns ids without an
 * extra round-trip. When none are present, an empty string is returned.
 */
function extractMessageIds(result: BroadcastResult): string[] {
  const events = (result as { events?: unknown }).events;
  const ids: string[] = [];
  if (Array.isArray(events)) {
    for (const ev of events as Array<{ attributes?: unknown }>) {
      const attrs = ev.attributes;
      if (!Array.isArray(attrs)) continue;
      for (const a of attrs as Array<{ key?: unknown; value?: unknown }>) {
        const key = String(a.key ?? "");
        if (key === "message_id" || key === "messageId") {
          ids.push(String(a.value ?? ""));
        }
      }
    }
  }
  return ids;
}

/**
 * Create a {@link CrossVMClient} bound to a connected {@link TxClient}.
 *
 * The `TxClient`'s sender address is used as the message `sender`, so the caller
 * never repeats their address. `sourceVm` defaults to `"evm"`.
 *
 * @param tx - A connected signing client (from `client.connectTx(signer)`).
 * @param opts - Optional typed query client and/or `qor_` client for reads.
 */
export function createCrossVMClient(
  tx: TxClient,
  opts: CreateCrossVMClientOptions = {},
): CrossVMClient {
  const sender = tx.senderAddress;
  const query = opts.query;
  const qor = opts.qor;

  const buildFrom = (o: CrossVMCallOptions, payload: Uint8Array): EncodeObject =>
    crossvmMsg.crossVmCall({
      sender,
      sourceVm: o.sourceVm ?? "evm",
      targetVm: o.targetVm,
      targetContract: o.targetContract,
      payload,
      funds: o.funds ?? [],
    });

  // Synchronous build-only path. Raw / svm / cosmwasm payloads need no async; the
  // EVM ABI path needs viem, so buildCall pre-encodes EVM payloads inline here.
  const buildCallSync = (o: CrossVMCallOptions, payload: Uint8Array): EncodeObject =>
    buildFrom(o, payload);

  const buildCall = (o: CrossVMCallOptions): EncodeObject => {
    if ("evm" in o) {
      throw new Error(
        "crossvm buildCall: EVM payloads are ABI-encoded asynchronously (viem). " +
          "Use `call`/`callAtomic`, or pre-encode and pass `{ payload }`.",
      );
    }
    // Synchronous encode for raw / cosmwasm / svm.
    let payload: Uint8Array;
    if ("payload" in o) payload = rawToBytes(o.payload);
    else if ("cosmwasm" in o) payload = cosmwasmToBytes(o.cosmwasm);
    else payload = rawToBytes(o.svm.data);
    return buildCallSync(o, payload);
  };

  const call = async (o: CallOptions): Promise<CrossVMCallResult> => {
    const payload = await encodePayload(o);
    const message = buildFrom(o, payload);
    const result = await tx.signAndBroadcast(
      [message],
      o.fee ?? "auto",
      o.memo ?? "",
      { autoFee: o.autoFee },
    );
    const [messageId = ""] = extractMessageIds(result);
    return { messageId, result };
  };

  const callAtomic = async (
    calls: CrossVMCallOptions[],
    w: CrossVMWriteOptions = {},
  ): Promise<CrossVMAtomicResult> => {
    if (calls.length === 0) {
      throw new Error("crossvm callAtomic: provide at least one call");
    }
    const messages = await Promise.all(
      calls.map(async (o) => buildFrom(o, await encodePayload(o))),
    );
    const result = await tx.signAndBroadcast(
      messages,
      w.fee ?? "auto",
      w.memo ?? "",
      { autoFee: w.autoFee },
    );
    return { messageIds: extractMessageIds(result), result };
  };

  const getMessage = (
    id: string,
  ): Promise<QueryMessageResponse | Record<string, unknown>> => {
    requireGetMessageSource(query, qor);
    if (query) return query.message({ id });
    return qor!.getCrossVmMessage(id);
  };

  return { call, buildCall, callAtomic, getMessage };
}
