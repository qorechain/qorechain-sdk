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
 *  - `PQCHybridSignature` protobuf message (fields `algorithm_id` = 1,
 *    `pqc_signature` = 2, `pqc_public_key` = 3) and type URL
 *    `/qorechain.pqc.v1.PQCHybridSignature`.
 *  - The ante handler extracts the extension by type URL and PROTOBUF-decodes it,
 *    so the `Any.value` carries the message's protobuf encoding (via the
 *    generated `PQCHybridSignature` codec), NOT JSON. Its first byte is `0x08`
 *    (field-1 varint tag). A prior release JSON-encoded this value; the chain's
 *    tx decoder rejected every such tx at CheckTx (the leading `0x7b` = `{` was
 *    misread as field 15 `start_group`). Verified live on testnet 2026-07-05.
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
import { PQCHybridSignature as PQCHybridSignatureProto } from "../codegen/qorechain/pqc/v1/hybrid";

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
 * Encode a {@link PQCHybridSignature} into a protobuf `Any` for use as a
 * `TxBody` extension option.
 *
 * The `Any.typeUrl` is the core {@link HYBRID_SIG_TYPE_URL}; the `Any.value` is
 * the PROTOBUF encoding of the `PQCHybridSignature` message (via the generated
 * codec — fields `algorithmId` = 1, `pqcSignature` = 2, `pqcPublicKey` = 3), so
 * the encoded value always begins with `0x08` (field-1 varint tag). The chain's
 * ante handler protobuf-decodes this extension; a JSON-encoded value is rejected
 * by the tx decoder at CheckTx.
 */
export function encodeHybridExtension(ext: PQCHybridSignature): Any {
  const value = PQCHybridSignatureProto.encode(
    PQCHybridSignatureProto.fromPartial({
      algorithmId: ext.algorithm_id,
      pqcSignature: ext.pqc_signature,
      pqcPublicKey: ext.pqc_public_key ?? new Uint8Array(0),
    }),
  ).finish();
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
