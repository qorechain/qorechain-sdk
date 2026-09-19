/**
 * End-to-end hybrid (classical + post-quantum) transaction signing for
 * QoreChain.
 *
 * A hybrid transaction carries the usual classical secp256k1 signature in
 * `TxRaw.signatures` PLUS an ML-DSA-87 (Dilithium-5) signature attached to the
 * `TxBody` as a `PQCHybridSignature` extension. The chain's ante handler
 * verifies BOTH, so a hybrid account stays interoperable with classical
 * verification while gaining quantum safety.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  The wallet ↔ chain contract (enforced by the chain)
 * ──────────────────────────────────────────────────────────────────────────
 * The chain verifies the ML-DSA-87 signature over the tx body WITH the PQC
 * extension REMOVED. Concretely:
 *
 *  - `B0` = canonical protobuf bytes of the `TxBody` containing the
 *    messages/memo/timeoutHeight but NOT the `PQCHybridSignature` extension.
 *  - `A`  = the tx `authInfoBytes`, verbatim — the same bytes that are
 *    broadcast.
 *  - PQC signed message = the hybrid sign-bytes in the form the TARGET network
 *    verifies (see ./signbytes):
 *      v1: `BE32(len(B0)) || B0 || BE32(len(A)) || A`
 *      v2: `"qorechain-pqc-hybrid-v2" || BE64(len chainId) || chainId || v1-body`
 *    A network verifies exactly one form at any height. `qorechain-vladi` and
 *    `qorechain-diana` switch from v1 to v2 when their v3.1.98 upgrade is
 *    applied (at different heights); other chains are v2 from genesis. The
 *    default `signBytesVersion: "auto"` asks the network (needs `rest`).
 *  - PQC signature       = `ml_dsa87.sign(pqcSecretKey, message)` (pure
 *    ML-DSA-87, empty context) — 4627 bytes for Dilithium-5.
 *  - The `PQCHybridSignature` extension is then added to
 *    `TxBody.extension_options` (CRITICAL extension options) as an `Any` with
 *    `type_url = "/qorechain.pqc.v1.PQCHybridSignature"` and `value` = the
 *    PROTOBUF encoding of the `PQCHybridSignature` message (fields
 *    `algorithm_id` = 1, `pqc_signature` = 2, `pqc_public_key` = 3; the encoded
 *    value begins with `0x08`). The chain protobuf-decodes it — a JSON value is
 *    rejected by the tx decoder.
 *  - The CLASSICAL signature is computed normally (SIGN_MODE_DIRECT) over the
 *    FINAL body (the one WITH the PQC extension) + authInfo + chainId +
 *    accountNumber, and goes in `TxRaw.signatures` (outside the body). There is
 *    no self-reference: the classical signature never signs itself.
 *
 * The signer's PQC key must be registered on-chain (via `MsgRegisterPQCKey`)
 * before hybrid txs PQC-verify — unless `includePqcPublicKey` is set, which
 * embeds the key for auto-registration on first use. Registering the key is the
 * caller's responsibility.
 *
 * Determinism note: the framing above is byte-for-byte deterministic on the
 * wallet side. Cross-implementation determinism (this `cosmjs`/`cosmjs-types`
 * proto encoding vs. the chain's re-marshal of the same `TxBody`) is confirmed
 * against the live testnet; if a custom message type with non-canonical field
 * ordering were used, callers must ensure their `Registry` encodes canonically.
 */

import type { OfflineDirectSigner, Registry } from "@cosmjs/proto-signing";
import {
  encodePubkey,
  makeAuthInfoBytes,
} from "@cosmjs/proto-signing";
import { encodeSecp256k1Pubkey } from "@cosmjs/amino";
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing";
import {
  TxBody,
  TxRaw,
  SignDoc,
} from "cosmjs-types/cosmos/tx/v1beta1/tx";
import type { EncodeObject } from "@cosmjs/proto-signing";

import {
  pqcSign,
  buildHybridSignatureExtension,
  AlgorithmDilithium5,
  type PqcKeypair,
} from "../accounts/pqc";
import { encodeHybridExtension } from "./hybrid";
import {
  hybridSignBytes,
  isHybridSignBytesRejection,
  resolveSignBytesVersion,
  type SignBytesVersion,
  type SignBytesVersionOption,
} from "./signbytes";
import type { FetchLike } from "../query/http";
import type { StdFee } from "./fees";
import type { BroadcastMode, BroadcastResult } from "./broadcast";

/** The fields shared by {@link buildHybridTx} and {@link signAndBroadcastHybrid}. */
export interface BuildHybridTxOptions {
  /**
   * The protobuf message {@link Registry} used to encode the messages into the
   * `TxBody`. Use cosmjs's `defaultRegistryTypes` (plus any custom QoreChain
   * message types) — the same registry the network's `TxClient` is built with.
   */
  registry: Registry;
  /**
   * The classical secp256k1 direct signer (e.g. from
   * `directSignerFromPrivateKey`). Its first account is used as the signer
   * identity and to produce the SIGN_MODE_DIRECT classical signature.
   */
  signer: OfflineDirectSigner;
  /** The ML-DSA-87 (Dilithium-5) keypair providing the post-quantum half. */
  pqcKeypair: PqcKeypair;
  /** The transaction messages, as `{ typeUrl, value }` encode objects. */
  messages: readonly EncodeObject[];
  /** The fee to pay. */
  fee: StdFee;
  /** Optional memo. Defaults to `""`. */
  memo?: string;
  /** The chain id (e.g. `"qorechain-diana"`). */
  chainId: string;
  /** The on-chain account number of the signer. */
  accountNumber: number | bigint;
  /** The signer's current account sequence (nonce). */
  sequence: number | bigint;
  /** Optional `timeoutHeight` for the tx body. */
  timeoutHeight?: bigint;
  /**
   * When `true`, embed the 2592-byte ML-DSA-87 public key in the extension so
   * the chain can auto-register it on first use. Defaults to `false` (the key
   * is expected to already be registered via `MsgRegisterPQCKey`).
   */
  includePqcPublicKey?: boolean;
  /**
   * Which hybrid sign-bytes form to sign. `"auto"` (default) asks the network
   * via `rest` (see {@link resolveSignBytesVersion}); `"v1"` / `"v2"` force a
   * form. On `qorechain-vladi` / `qorechain-diana`, `"auto"` without `rest`
   * throws rather than guess.
   */
  signBytesVersion?: SignBytesVersionOption;
  /** The network's REST (LCD) base URL, used by `signBytesVersion: "auto"`. */
  rest?: string;
  /** Injectable `fetch` for the `"auto"` lookup. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Bypass the cached `"auto"` answer. */
  forceRefreshSignBytesVersion?: boolean;
}

/** The fully assembled hybrid transaction and the intermediate artifacts. */
export interface BuiltHybridTx {
  /** The assembled `TxRaw` (final body + authInfo + classical signature). */
  txRaw: TxRaw;
  /** Encoded `TxRaw` bytes, ready to broadcast. */
  txRawBytes: Uint8Array;
  /** The `authInfoBytes` (`A`) — identical in the PQC framing and the SignDoc. */
  authInfoBytes: Uint8Array;
  /** The exact bytes the ML-DSA-87 signature was computed over (the framing). */
  pqcSignedMessage: Uint8Array;
  /** The raw ML-DSA-87 signature (Dilithium-5: 4627 bytes). */
  pqcSignature: Uint8Array;
  /** The sign-bytes form the PQC signature was computed over. */
  signBytesVersion: SignBytesVersion;
}

/** Decode a standard base64 string to bytes (no extra deps; atob is universal). */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Build a fully signed hybrid transaction following the chain contract.
 *
 * The build sequence (see the module header for the exact contract):
 *  1. Encode `B0` — the `TxBody` WITHOUT the PQC extension.
 *  2. Encode `A`  — the single-signer `AuthInfo` (SIGN_MODE_DIRECT).
 *  3. Compute `message = BE32(len B0) || B0 || BE32(len A) || A`; ML-DSA-87
 *     sign it.
 *  4. Build the PQC extension `Any` and attach it to a NEW body identical to
 *     step 1 but with `extensionOptions = [ext]`; encode → final body bytes.
 *  5. SIGN_MODE_DIRECT classical sign over `SignDoc{ finalBody, A, chainId,
 *     accountNumber }`.
 *  6. Assemble `TxRaw{ finalBody, A, [classicalSig] }`.
 *
 * The returned {@link BuiltHybridTx} exposes the intermediate artifacts so the
 * contract can be asserted/audited.
 */
export async function buildHybridTx(
  opts: BuildHybridTxOptions,
): Promise<BuiltHybridTx> {
  const {
    registry,
    signer,
    pqcKeypair,
    messages,
    fee,
    chainId,
    accountNumber,
    sequence,
  } = opts;
  const memo = opts.memo ?? "";
  const timeoutHeight = opts.timeoutHeight ?? 0n;

  const accounts = await signer.getAccounts();
  if (accounts.length === 0) {
    throw new Error("signer exposes no accounts");
  }
  const account = accounts[0];

  // 1. B0 — body WITHOUT the PQC extension. Encode the messages via the registry.
  const encodedMessages = messages.map((m) => registry.encodeAsAny(m));
  const baseBody = TxBody.fromPartial({
    messages: encodedMessages,
    memo,
    timeoutHeight,
  });
  const b0 = TxBody.encode(baseBody).finish();

  // 2. A — single-signer AuthInfo (SIGN_MODE_DIRECT). The signer's classical
  //    secp256k1 pubkey identifies the account.
  const pubkeyAny = encodePubkey(encodeSecp256k1Pubkey(account.pubkey));
  const gasLimit = Number(fee.gas);
  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey: pubkeyAny, sequence: BigInt(sequence) }],
    fee.amount,
    gasLimit,
    fee.granter,
    fee.payer,
    SignMode.SIGN_MODE_DIRECT,
  );

  // 3. PQC sign-bytes, in the form this network verifies, + ML-DSA-87 over
  //    B0 + A (NOT the final body).
  const signBytesVersion = await resolveSignBytesVersion({
    chainId,
    rest: opts.rest,
    signBytesVersion: opts.signBytesVersion,
    fetch: opts.fetch,
    forceRefresh: opts.forceRefreshSignBytesVersion,
  });
  const pqcSignedMessage = hybridSignBytes(signBytesVersion, chainId, b0, authInfoBytes);
  const pqcSignature = pqcSign(pqcKeypair.secretKey, pqcSignedMessage);

  // 4. Build the PQC extension Any and attach it to the FINAL body as a
  //    CRITICAL extension option.
  const ext = buildHybridSignatureExtension({
    algorithmId: AlgorithmDilithium5,
    signature: pqcSignature,
    publicKey: opts.includePqcPublicKey ? pqcKeypair.publicKey : undefined,
  });
  const extAny = encodeHybridExtension(ext);
  const finalBody = TxBody.fromPartial({
    messages: encodedMessages,
    memo,
    timeoutHeight,
    extensionOptions: [extAny],
  });
  const bodyBytesFinal = TxBody.encode(finalBody).finish();

  // 5. Classical SIGN_MODE_DIRECT signature over the FINAL body + A.
  const signDoc = SignDoc.fromPartial({
    bodyBytes: bodyBytesFinal,
    authInfoBytes,
    chainId,
    accountNumber: BigInt(accountNumber),
  });
  const { signature } = await signer.signDirect(account.address, signDoc);
  const classicalSig = fromBase64(signature.signature);

  // 6. Assemble TxRaw.
  const txRaw = TxRaw.fromPartial({
    bodyBytes: bodyBytesFinal,
    authInfoBytes,
    signatures: [classicalSig],
  });
  const txRawBytes = TxRaw.encode(txRaw).finish();

  return {
    txRaw,
    txRawBytes,
    authInfoBytes,
    pqcSignedMessage,
    pqcSignature,
    signBytesVersion,
  };
}

/**
 * A minimal broadcast transport for raw tx bytes. cosmjs's `StargateClient`
 * (and `SigningStargateClient`) satisfy this shape via `broadcastTx` /
 * `broadcastTxSync`, so production callers can pass an existing client; unit
 * tests can inject a fake.
 */
export interface HybridBroadcaster {
  /** Poll-to-commit broadcast: returns the delivery result. */
  broadcastTx(
    tx: Uint8Array,
    timeoutMs?: number,
    pollIntervalMs?: number,
  ): Promise<{
    code: number;
    transactionHash: string;
    height?: number;
    gasUsed?: bigint;
    gasWanted?: bigint;
    rawLog?: string;
  }>;
  /** Submit and return after CheckTx: returns the tx hash. */
  broadcastTxSync(tx: Uint8Array): Promise<string>;
}

/** Options for {@link signAndBroadcastHybrid}. */
export interface SignAndBroadcastHybridOptions extends BuildHybridTxOptions {
  /** The broadcast transport (e.g. a connected `StargateClient`). */
  transport: HybridBroadcaster;
  /** Broadcast mode. Defaults to `"commit"`. */
  mode?: BroadcastMode;
}

/**
 * Build, sign, and broadcast a hybrid transaction.
 *
 * Broadcast mode maps onto the transport:
 * - `commit` (default): polls until the tx lands in a block; throws on a
 *   non-zero delivery code.
 * - `sync` / `async`: returns after mempool submission with just the tx hash.
 */
export async function signAndBroadcastHybrid(
  opts: SignAndBroadcastHybridOptions,
): Promise<BroadcastResult> {
  const auto = (opts.signBytesVersion ?? "auto") === "auto";
  try {
    return await broadcastHybridOnce(opts, false);
  } catch (e) {
    // Signed the form the network no longer (or not yet) verifies: the answer
    // was cached across an upgrade. Ask again once and resend once.
    if (!auto || !isHybridSignBytesRejection(e)) throw e;
    return broadcastHybridOnce(opts, true);
  }
}

async function broadcastHybridOnce(
  opts: SignAndBroadcastHybridOptions,
  forceRefresh: boolean,
): Promise<BroadcastResult> {
  const { transport } = opts;
  const mode: BroadcastMode = opts.mode ?? "commit";
  const built = await buildHybridTx({
    ...opts,
    forceRefreshSignBytesVersion: forceRefresh || opts.forceRefreshSignBytesVersion,
  });

  if (mode === "commit") {
    const res = await transport.broadcastTx(built.txRawBytes);
    if (res.code !== 0) {
      throw Object.assign(
        new Error(
          `hybrid transaction failed with code ${res.code}: ${res.rawLog ?? "(no log)"} (hash ${res.transactionHash})`,
        ),
        { code: res.code, rawLog: res.rawLog, transactionHash: res.transactionHash },
      );
    }
    return {
      transactionHash: res.transactionHash,
      code: res.code,
      height: res.height,
      gasUsed: res.gasUsed,
      gasWanted: res.gasWanted,
      rawLog: res.rawLog,
    };
  }

  const hash = await transport.broadcastTxSync(built.txRawBytes);
  return { transactionHash: hash, code: 0 };
}
