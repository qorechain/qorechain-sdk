/**
 * Attachment of the QoreChain PQC hybrid-signature extension to a native tx.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  ⚠️  LIVE-TESTNET VERIFICATION REQUIRED — DO NOT TREAT AS VERIFIED  ⚠️
 * ──────────────────────────────────────────────────────────────────────────
 * The classical signing path (see {@link TxClient}) is fully functional and
 * matches what the node's ante handler verifies for a secp256k1 account. The
 * HYBRID path implemented here is BEST-EFFORT, derived from the PUBLIC core
 * sources, which do NOT make the end-to-end wiring unambiguous:
 *
 *  - `x/pqc/types/hybrid.go` defines the `PQCHybridSignature` struct, its JSON
 *    field tags (`algorithm_id`, `pqc_signature`, `pqc_public_key,omitempty`),
 *    and the type URL `/qorechain.pqc.v1.PQCHybridSignature`.
 *  - `x/pqc/types/codec.go` states the ante handler "extracts it using the type
 *    URL and JSON decoding" — so the extension `Any.value` carries the struct's
 *    Go-JSON encoding (Go marshals `[]byte` as standard base64 strings), NOT a
 *    protobuf message. This module encodes accordingly.
 *  - The verifying decorator `PQCHybridVerifyDecorator` is a PASS-THROUGH STUB
 *    in the public build (`ante_hybrid_stub.go`, build tag `!full`); the real
 *    implementation lives in the private `full` build. Therefore the PUBLIC
 *    source does NOT reveal two things needed to finalize hybrid signing:
 *      1. PLACEMENT: whether the extension goes in `TxBody.extension_options`
 *         or `TxBody.non_critical_extension_options`. We DEFAULT to
 *         `non_critical_extension_options` (the conventional, fee-neutral slot
 *         for signatures that the SDK's default decoder won't reject), and
 *         expose {@link AttachHybridOptions.placement} to switch.
 *      2. SIGNED BYTES: exactly which bytes the ML-DSA-87 signature must cover
 *         (the SIGN_MODE_DIRECT sign-doc bytes? the raw TxBody bytes? the
 *         classical signature?). This CANNOT be determined from public source.
 *
 * Consequently this module only ENCODES and ATTACHES a caller-supplied
 * {@link PQCHybridSignature} object; it deliberately does NOT decide what the
 * PQC signature signs. The caller (or a future, testnet-verified builder hook)
 * must produce the signature over the correct bytes. Until verified against a
 * live testnet `full` build, do not assume a hybrid tx assembled this way will
 * pass the ante handler.
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
  const any = encodeHybridExtension(ext);
  const placement = opts.placement ?? "non_critical_extension_options";
  const next = TxBody.fromPartial({
    messages: body.messages,
    memo: body.memo,
    timeoutHeight: body.timeoutHeight,
    extensionOptions: [...body.extensionOptions],
    nonCriticalExtensionOptions: [...body.nonCriticalExtensionOptions],
  });
  if (placement === "extension_options") {
    next.extensionOptions.push(any);
  } else {
    next.nonCriticalExtensionOptions.push(any);
  }
  return next;
}
