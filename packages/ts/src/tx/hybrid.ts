/**
 * Encoding and attachment of the QoreChain PQC hybrid-signature extension to a
 * native tx.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  The wallet ↔ chain contract (now known and enforced)
 * ──────────────────────────────────────────────────────────────────────────
 * These are low-level encode/attach primitives. The full, contract-correct
 * hybrid build sequence lives in {@link ../tx/hybrid-tx} ({@link buildHybridTx}
 * / {@link signAndBroadcastHybrid}) — prefer those for end-to-end signing. This
 * module documents the on-wire encoding the chain reads:
 *
 *  - `PQCHybridSignature` struct, JSON field tags (`algorithm_id`,
 *    `pqc_signature`, `pqc_public_key,omitempty`), and type URL
 *    `/qorechain.pqc.v1.PQCHybridSignature`.
 *  - The ante handler extracts the extension by type URL and JSON-decodes it, so
 *    the `Any.value` carries the struct's Go-JSON encoding (Go marshals
 *    `[]byte` as standard padded base64 strings), NOT a protobuf message. This
 *    module encodes accordingly (see {@link toGoJson}).
 *  - PLACEMENT: the extension is a CRITICAL extension option — it goes in
 *    `TxBody.extension_options`. {@link buildHybridTx} always uses this slot.
 *    This module additionally exposes `non_critical_extension_options` via
 *    {@link AttachHybridOptions.placement} for callers with other needs, but the
 *    chain reads the critical slot.
 *  - SIGNED BYTES: the ML-DSA-87 signature is computed over the tx body WITH the
 *    PQC extension REMOVED, framed with the authInfo bytes:
 *    `BE32(len(B0)) || B0 || BE32(len(A)) || A` (see {@link buildHybridTx} for
 *    the full contract). This module does not decide what the PQC signature
 *    signs — {@link buildHybridTx} does.
 *
 * Cross-implementation proto byte-determinism (cosmjs encode vs. the chain's
 * re-marshal) is confirmed on the live testnet for the default registry message
 * types.
 */

import { Any } from "cosmjs-types/google/protobuf/any";
import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import {
  HYBRID_SIG_TYPE_URL,
  type PQCHybridSignature,
} from "../accounts/pqc";

/** Where the hybrid-signature extension is placed within the `TxBody`. */
export type HybridPlacement =
  | "non_critical_extension_options"
  | "extension_options";

/** Options for {@link attachHybridExtension}. */
export interface AttachHybridOptions {
  /**
   * Which `TxBody` extension list to attach the extension to. Defaults to
   * `"non_critical_extension_options"`. See the module header: the exact slot
   * the ante handler reads is not determinable from public core and needs
   * live-testnet verification.
   */
  placement?: HybridPlacement;
}

/**
 * Serialize a {@link PQCHybridSignature} the way Go's `encoding/json` would
 * marshal the core struct, so the node's JSON-decoding ante handler can read it.
 *
 * Go marshals `[]byte` fields as standard (padded) base64 strings, and omits
 * `pqc_public_key` entirely when empty (`omitempty`). The numeric `algorithm_id`
 * is emitted as a JSON number.
 */
function toGoJson(ext: PQCHybridSignature): string {
  const obj: {
    algorithm_id: number;
    pqc_signature: string;
    pqc_public_key?: string;
  } = {
    algorithm_id: ext.algorithm_id,
    pqc_signature: base64(ext.pqc_signature),
  };
  if (ext.pqc_public_key !== undefined && ext.pqc_public_key.length > 0) {
    obj.pqc_public_key = base64(ext.pqc_public_key);
  }
  return JSON.stringify(obj);
}

/** Standard base64 (padded) encoding of bytes, matching Go's `[]byte` marshal. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // btoa is available in Node 16+ and all SDK target runtimes.
  return btoa(binary);
}

/**
 * Encode a {@link PQCHybridSignature} into a protobuf `Any` for use as a
 * `TxBody` extension option.
 *
 * The `Any.typeUrl` is the core {@link HYBRID_SIG_TYPE_URL}; the `Any.value` is
 * the UTF-8 bytes of the struct's Go-JSON encoding (see {@link toGoJson} and the
 * module header — the chain reads this extension by type URL + JSON decoding,
 * not protobuf).
 */
export function encodeHybridExtension(ext: PQCHybridSignature): Any {
  const value = new TextEncoder().encode(toGoJson(ext));
  return Any.fromPartial({ typeUrl: HYBRID_SIG_TYPE_URL, value });
}

/**
 * Return a copy of `body` with the encoded hybrid-signature extension attached.
 *
 * The input `body` is not mutated. By default the extension is added to
 * `non_critical_extension_options`; pass `placement` to use `extension_options`
 * instead.
 *
 * @see The module header — both the placement and the bytes the PQC signature
 *   must cover require live-testnet verification against the `full` build.
 */
export function attachHybridExtension(
  body: TxBody,
  ext: PQCHybridSignature,
  opts: AttachHybridOptions = {},
): TxBody {
  const anyExt = encodeHybridExtension(ext);
  const placement = opts.placement ?? "non_critical_extension_options";
  const next = TxBody.fromPartial({
    messages: body.messages,
    memo: body.memo,
    timeoutHeight: body.timeoutHeight,
    extensionOptions: [...body.extensionOptions],
    nonCriticalExtensionOptions: [...body.nonCriticalExtensionOptions],
  });
  if (placement === "extension_options") {
    next.extensionOptions.push(anyExt);
  } else {
    next.nonCriticalExtensionOptions.push(anyExt);
  }
  return next;
}
