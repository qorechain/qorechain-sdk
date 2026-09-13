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
 * A call executes inside the transaction and returns the callee's answer: the
 * result carries `executed`, `data` (the return value) and `gasUsed`, decoded
 * from `MsgCrossVMCallResponse`. Pass `async: true` to queue the call for a
 * later `ProcessQueue` dispatch instead, in which case nothing has run yet and
 * only the message id is meaningful.
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
import * as crossvmTx from "../codegen/qorechain/crossvm/v1/tx";
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
  /**
   * The VM the call claims to originate from.
   *
   * IGNORED BY THE CHAIN (v3.1.97). The chain derives the origin lane from the
   * execution context rather than trusting the caller's self-description, so
   * setting this changes nothing about how the call is handled. The field is
   * retained — and still sent, defaulting to `"evm"` — purely for wire
   * compatibility, so older nodes and clients keep accepting the message.
   */
  sourceVm?: VMType;
  /** The VM the call targets. */
  targetVm: VMType;
  /** The target contract address/identifier on `targetVm`. */
  targetContract: string;
  /** Optional funds (coins) to forward with the call. */
  funds?: Coin[];
  /**
   * Queue the call for a later `ProcessQueue` dispatch instead of executing it
   * inside this transaction.
   *
   * Defaults to `false`, matching the chain's default: execute now and return
   * the callee's answer (see {@link CrossVMCallResult.data}). With `async: true`
   * the call is only enqueued, so the response carries `executed: false` and no
   * `data` — use it when you do not need the result in this transaction.
   */
  async?: boolean;
}

/** Options for a single cross-VM call (base + payload). */
export type CrossVMCallOptions = CrossVMCallBase & PayloadInput;

/** Options for {@link CrossVMClient.call} (adds write-path options). */
export type CallOptions = CrossVMCallOptions & CrossVMWriteOptions;

/**
 * The decoded `MsgCrossVMCallResponse` fields for one cross-VM call.
 *
 * Populated from the tx's per-message responses when the node returns them
 * (`commit` broadcasts). When they are absent — a `sync`/`async` broadcast, or
 * an older node — `executed` is `false`, `data` is empty and `gasUsed` is `0n`;
 * read the result with {@link CrossVMClient.getMessage} instead.
 */
export interface CrossVMCallOutcome {
  /**
   * Whether the callee actually ran inside this transaction. `false` for a
   * queued (`async: true`) call, whose result is not known yet.
   */
  executed: boolean;
  /** The callee's return value. Empty when the call was queued. */
  data: Uint8Array;
  /** Gas consumed by the callee. `0n` when the call was queued. */
  gasUsed: bigint;
}

/** Result of a single {@link CrossVMClient.call}. */
export interface CrossVMCallResult extends CrossVMCallOutcome {
  /** The cross-VM message id assigned by the chain (parsed from tx events). */
  messageId: string;
  /** The raw broadcast result. */
  result: BroadcastResult;
}

/** Result of an atomic {@link CrossVMClient.callAtomic} batch. */
export interface CrossVMAtomicResult {
  /** The cross-VM message ids assigned by the chain (best-effort, from events). */
  messageIds: string[];
  /**
   * The decoded per-call outcomes, in the order the calls were passed.
   *
   * Empty when the node returned no per-message responses (see
   * {@link CrossVMCallOutcome}).
   */
  outcomes: CrossVMCallOutcome[];
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

/** The response type URL emitted for a `MsgCrossVMCall`. */
const CROSSVM_CALL_RESPONSE_TYPE_URL =
  "/qorechain.crossvm.v1.MsgCrossVMCallResponse";

/** The outcome reported when the node returned no decodable response. */
function unknownOutcome(): CrossVMCallOutcome {
  return { executed: false, data: new Uint8Array(0), gasUsed: 0n };
}

/**
 * Decode the `MsgCrossVMCallResponse` entries from a broadcast result.
 *
 * Only `commit` broadcasts carry per-message responses; anything else (or an
 * older node) yields an empty list, and callers fall back to
 * {@link CrossVMClient.getMessage}. Entries whose type URL is not a cross-VM
 * call response are skipped, so a mixed transaction body still lines up.
 */
function decodeCallOutcomes(result: BroadcastResult): CrossVMCallOutcome[] {
  const responses = result.msgResponses;
  if (!Array.isArray(responses)) return [];
  const out: CrossVMCallOutcome[] = [];
  for (const r of responses) {
    if (r?.typeUrl !== CROSSVM_CALL_RESPONSE_TYPE_URL) continue;
    try {
      const decoded = crossvmTx.MsgCrossVMCallResponse.decode(r.value);
      out.push({
        executed: decoded.executed,
        data: decoded.data,
        // uint64 is generated as a decimal string; surface it as a bigint.
        gasUsed: BigInt(decoded.gasUsed ?? 0),
      });
    } catch {
      // A response we cannot decode is reported as "unknown" rather than
      // dropped, so positional alignment with the calls is preserved.
      out.push(unknownOutcome());
    }
  }
  return out;
}

/**
 * Create a {@link CrossVMClient} bound to a connected {@link TxClient}.
 *
 * The `TxClient`'s sender address is used as the message `sender`, so the caller
 * never repeats their address. `sourceVm` still defaults to `"evm"` on the wire
 * but is ignored by the chain (see {@link CrossVMCallBase.sourceVm}); `async`
 * defaults to `false`, i.e. execute now and return the callee's answer.
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
      async: o.async ?? false,
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
    const [outcome = unknownOutcome()] = decodeCallOutcomes(result);
    return { messageId, ...outcome, result };
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
    return {
      messageIds: extractMessageIds(result),
      outcomes: decodeCallOutcomes(result),
      result,
    };
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
