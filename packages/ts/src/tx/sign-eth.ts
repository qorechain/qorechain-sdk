/**
 * eth_secp256k1 native-lane (QoreChain Native) transaction signing for QoreChain.
 *
 * A unified eth-native account (address = `keccak256(pubkey)[12:]`, see
 * {@link ../accounts/unified.deriveUnifiedAccount}) signs native transactions with
 * the `eth_secp256k1` scheme instead of the classic Native secp256k1 scheme. Two
 * things differ from the standard path:
 *
 *  1. The classical signature is secp256k1 over the **keccak256** of the SignDoc
 *     bytes (NOT sha256), serialized as the 64-byte `r ‖ s` (low-s normalized).
 *  2. The `SignerInfo` public key `Any` uses the type URL
 *     {@link ETHSECP256K1_PUBKEY_TYPE}; its `value` is the SAME wire shape as the
 *     standard Native secp256k1 `PubKey` (`{ key: compressedPubkey }`), only the
 *     type URL differs.
 *
 * This is the same account that spends on the EVM lane, so its `qor1…` / `0x…` /
 * base58 forms are one identity. Mainnet enforces the ML-DSA-87 hybrid extension;
 * {@link signHybridEth} attaches it, while {@link signClassicalEth} omits it (used
 * only for the one-time, bootstrap-exempt `MsgRegisterPQCKeyV2`).
 *
 * The hybrid PQC framing/extension reuse the SDK's existing, live-testnet-verified
 * helpers ({@link ../tx/hybrid.encodeHybridExtension}, the per-network hybrid
 * sign-bytes ({@link ./signbytes.hybridSignBytes}), and {@link ../accounts/pqc.buildHybridSignatureExtension}); only the
 * classical hash (keccak vs sha256) and the pubkey type URL change here.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  TxBody,
  AuthInfo,
  TxRaw,
  SignerInfo,
  ModeInfo,
  Fee,
  SignDoc,
} from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing";
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys";
import { Any } from "cosmjs-types/google/protobuf/any";
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
  isLegacySignBytesChain,
  type SignBytesVersion,
} from "./signbytes";
import type { StdFee } from "./fees";

/**
 * The cosmos/evm `eth_secp256k1` public-key type URL. Its wire shape is identical
 * to the Native secp256k1 `PubKey` (`{ key: bytes }`); only the type URL differs.
 */
export const ETHSECP256K1_PUBKEY_TYPE =
  "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey";

/** The minimal account key material the eth signers need. */
export interface EthSigningKey {
  /** `0x`-prefixed 32-byte secp256k1 private key. */
  privateKey: string;
  /** `0x`-prefixed 33-byte compressed secp256k1 public key. */
  publicKey: string;
  /** The ML-DSA-87 keypair (required for {@link signHybridEth}). */
  pqc?: PqcKeypair;
}

/** Shared per-tx signing parameters. */
export interface EthSignParams {
  /** The signing account (`privateKey`, `publicKey`, and `pqc` for hybrid). */
  account: EthSigningKey;
  /** The chain id (e.g. `"qorechain-vladi"`). */
  chainId: string;
  /** The on-chain account number of the signer. */
  accountNumber: number | bigint;
  /** The transaction messages as `{ typeUrl, value }` encode objects. */
  messages: readonly EncodeObject[];
  /** The fee to pay. */
  fee: StdFee;
  /** The signer's current account sequence (nonce). */
  sequence: number | bigint;
  /** Optional memo. Defaults to `""`. */
  memo?: string;
  /** Optional `timeoutHeight` for the tx body. Defaults to `0n`. */
  timeoutHeight?: bigint;
  /**
   * A protobuf {@link EncodeObject}-to-`Any` encoder. Callers should pass a
   * registry-bound encoder (e.g. `(m) => registry.encodeAsAny(m)`) so custom
   * message types resolve. When omitted, only pre-encoded `Any` messages (whose
   * `value` is already a `Uint8Array`) are accepted.
   */
  encodeMessage?: (m: EncodeObject) => Any;
  /**
   * The hybrid sign-bytes form (hybrid signing only). Resolve it with
   * {@link resolveSignBytesVersion} for the target network. When omitted, a
   * chain born on v2 gets `"v2"`; on `qorechain-vladi` / `qorechain-diana`
   * (which switch at their own upgrade heights) omitting it throws.
   */
  signBytesVersion?: SignBytesVersion;
}

/** The result of an eth-native sign: the broadcastable `TxRaw` and artifacts. */
export interface SignedEthTx {
  /** Encoded `TxRaw` bytes, ready to broadcast. */
  txRawBytes: Uint8Array;
  /** The assembled `TxRaw`. */
  txRaw: TxRaw;
  /** The final `bodyBytes` (with the PQC extension for hybrid; B0 for classical). */
  bodyBytes: Uint8Array;
  /** The `authInfoBytes`. */
  authInfoBytes: Uint8Array;
  /** The 64-byte classical `r ‖ s` signature over `keccak256(signDoc)`. */
  classicalSignature: Uint8Array;
}

/** Strip a `0x`/`0X` prefix and parse hex to bytes. */
function fromHex(hex: string): Uint8Array {
  const body = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * The form to use when the caller gave none: only a chain born on v2 has a
 * version that does not depend on its current height.
 */
function defaultSignBytesVersion(chainId: string): SignBytesVersion {
  if (!isLegacySignBytesChain(chainId)) return "v2";
  throw new Error(
    `signHybridEth on ${chainId} needs signBytesVersion: resolve it with ` +
      `resolveSignBytesVersion({ chainId, rest }) — the network switches from v1 to v2 at its own upgrade height`,
  );
}

/** Encode the messages into protobuf `Any` values, resolving via the encoder. */
function encodeMessages(params: EthSignParams): Any[] {
  const enc = params.encodeMessage;
  return params.messages.map((m) => {
    if (enc) return enc(m);
    if (m.value instanceof Uint8Array) {
      return Any.fromPartial({ typeUrl: m.typeUrl, value: m.value });
    }
    throw new Error(
      `message ${m.typeUrl} is not pre-encoded; pass encodeMessage (e.g. registry.encodeAsAny)`,
    );
  });
}

/** Build the `authInfoBytes` for the single eth_secp256k1 signer. */
function buildAuthInfoBytes(params: EthSignParams): Uint8Array {
  const pubAny = Any.fromPartial({
    typeUrl: ETHSECP256K1_PUBKEY_TYPE,
    value: PubKey.encode(
      PubKey.fromPartial({ key: fromHex(params.account.publicKey) }),
    ).finish(),
  });
  const authInfo = AuthInfo.fromPartial({
    signerInfos: [
      SignerInfo.fromPartial({
        publicKey: pubAny,
        modeInfo: ModeInfo.fromPartial({
          single: { mode: SignMode.SIGN_MODE_DIRECT },
        }),
        sequence: BigInt(params.sequence),
      }),
    ],
    fee: Fee.fromPartial({
      amount: [...params.fee.amount],
      gasLimit: BigInt(params.fee.gas),
      granter: params.fee.granter ?? "",
      payer: params.fee.payer ?? "",
    }),
  });
  return AuthInfo.encode(authInfo).finish();
}

/**
 * eth_secp256k1 classical signature over the SignDoc: secp256k1 sign of
 * `keccak256(signBytes)`, serialized as the 64-byte `r ‖ s` (low-s normalized).
 */
function ethSign(signBytes: Uint8Array, privateKeyHex: string): Uint8Array {
  const hash = keccak_256(signBytes);
  const sig = secp256k1.sign(hash, fromHex(privateKeyHex)); // low-s by default
  return sig.toCompactRawBytes(); // 64 bytes: r(32) ‖ s(32)
}

/**
 * Sign a native tx with the eth_secp256k1 CLASSICAL scheme only (no PQC extension).
 *
 * Use for the one-time `MsgRegisterPQCKeyV2`, which is bootstrap-exempt from the
 * hybrid requirement. All other txs from a unified account should use
 * {@link signHybridEth}.
 */
export function signClassicalEth(params: EthSignParams): SignedEthTx {
  const memo = params.memo ?? "";
  const timeoutHeight = params.timeoutHeight ?? 0n;
  const authInfoBytes = buildAuthInfoBytes(params);
  const encodedMessages = encodeMessages(params);

  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({ messages: encodedMessages, memo, timeoutHeight }),
  ).finish();

  const signBytes = SignDoc.encode(
    SignDoc.fromPartial({
      bodyBytes,
      authInfoBytes,
      chainId: params.chainId,
      accountNumber: BigInt(params.accountNumber),
    }),
  ).finish();

  const classicalSignature = ethSign(signBytes, params.account.privateKey);
  const txRaw = TxRaw.fromPartial({
    bodyBytes,
    authInfoBytes,
    signatures: [classicalSignature],
  });
  return {
    txRawBytes: TxRaw.encode(txRaw).finish(),
    txRaw,
    bodyBytes,
    authInfoBytes,
    classicalSignature,
  };
}

/**
 * Sign a native tx with the eth_secp256k1 + ML-DSA-87 HYBRID scheme.
 *
 * The chain verifies the PQC signature over the tx body WITHOUT the PQC extension
 * (`B0`) and `authInfoBytes`, in the hybrid sign-bytes form the network verifies
 * (`params.signBytesVersion`, see ./signbytes).
 * The classical signature then covers the FINAL body (with the extension) via
 * SIGN_MODE_DIRECT (keccak256 hash). This mirrors the SDK's existing hybrid path
 * ({@link ../tx/hybrid-tx.buildHybridTx}); only the classical hash and the pubkey
 * type URL are eth-native here.
 *
 * @throws if `account.pqc` is not provided.
 */
export function signHybridEth(params: EthSignParams): SignedEthTx {
  if (!params.account.pqc) {
    throw new Error("signHybridEth requires account.pqc (ML-DSA-87 keypair)");
  }
  const memo = params.memo ?? "";
  const timeoutHeight = params.timeoutHeight ?? 0n;
  const authInfoBytes = buildAuthInfoBytes(params);
  const encodedMessages = encodeMessages(params);

  // B0 — body WITHOUT the PQC extension.
  const b0 = TxBody.encode(
    TxBody.fromPartial({ messages: encodedMessages, memo, timeoutHeight }),
  ).finish();

  // ML-DSA-87 over (B0, authInfo) in the network's sign-bytes form.
  const version = params.signBytesVersion ?? defaultSignBytesVersion(params.chainId);
  const pqcSignedMessage = hybridSignBytes(version, params.chainId, b0, authInfoBytes);
  const pqcSignature = pqcSign(params.account.pqc.secretKey, pqcSignedMessage);

  // Attach the PQC extension to the FINAL body and encode it.
  const ext = buildHybridSignatureExtension({
    algorithmId: AlgorithmDilithium5,
    signature: pqcSignature,
  });
  const extAny = encodeHybridExtension(ext);
  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: encodedMessages,
      memo,
      timeoutHeight,
      extensionOptions: [extAny],
    }),
  ).finish();

  // Classical SIGN_MODE_DIRECT signature over the FINAL body + authInfo.
  const signBytes = SignDoc.encode(
    SignDoc.fromPartial({
      bodyBytes,
      authInfoBytes,
      chainId: params.chainId,
      accountNumber: BigInt(params.accountNumber),
    }),
  ).finish();
  const classicalSignature = ethSign(signBytes, params.account.privateKey);

  const txRaw = TxRaw.fromPartial({
    bodyBytes,
    authInfoBytes,
    signatures: [classicalSignature],
  });
  return {
    txRawBytes: TxRaw.encode(txRaw).finish(),
    txRaw,
    bodyBytes,
    authInfoBytes,
    classicalSignature,
  };
}
