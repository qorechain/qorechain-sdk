/**
 * The eth-native tx lane: a signer that drives a unified eth-native account
 * through the QoreChain Native tx path (`bankSend` / generic sends), plus the account
 * parser the read side needs to accept an `eth_secp256k1` on-chain pubkey.
 *
 * A unified account ({@link ../accounts/unified.deriveUnifiedAccount}) signs with
 * the eth_secp256k1 scheme (keccak256 hash + {@link ETHSECP256K1_PUBKEY_TYPE}
 * pubkey), which cosmjs's standard `OfflineDirectSigner` does not produce. Rather
 * than force it into cosmjs, {@link EthNativeSigner} builds the `TxRaw` natively
 * via {@link signHybridEth} / {@link signClassicalEth} and hands the bytes to a
 * minimal broadcast transport (which a connected cosmjs `StargateClient`
 * satisfies).
 *
 * On the read side, an account whose `pub_key` is an `eth_secp256k1` `Any` must
 * still be decoded for its `account_number` / `sequence`; {@link parseEthPubkeyAny}
 * and {@link accountAuthInfo} handle that (the pubkey value is wire-identical to
 * the Native secp256k1 `PubKey`, only the type URL differs).
 */

import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys";
import { BaseAccount } from "cosmjs-types/cosmos/auth/v1beta1/auth";
import { Any } from "cosmjs-types/google/protobuf/any";
import { Registry, type EncodeObject } from "@cosmjs/proto-signing";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";

import { qorechainRegistry } from "../messages/registry";
import type { Coin } from "../query/rest";
import type { StdFee } from "./fees";
import type { UnifiedAccount } from "../accounts/unified";
import {
  signClassicalEth,
  signHybridEth,
  ETHSECP256K1_PUBKEY_TYPE,
  type EthSigningKey,
  type SignedEthTx,
} from "./sign-eth";

export { ETHSECP256K1_PUBKEY_TYPE } from "./sign-eth";

/** A minimal transport for broadcasting raw tx bytes. A cosmjs `StargateClient`
 * (or `SigningStargateClient`) satisfies this via `broadcastTx`. */
export interface EthBroadcaster {
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
}

/** The `{ accountNumber, sequence }` pair a signer needs for a SignDoc. */
export interface AccountSequence {
  accountNumber: number | bigint;
  sequence: number | bigint;
}

/** Options for {@link EthNativeSigner}. */
export interface EthNativeSignerOptions {
  /**
   * The message registry used to encode messages into the tx body. Defaults to
   * {@link qorechainRegistry} (standard Native + all QoreChain custom messages).
   */
  registry?: Registry;
  /**
   * The signing posture: `"hybrid"` (default) attaches the ML-DSA-87 extension
   * required by mainnet; `"classical"` omits it (only for the bootstrap
   * `MsgRegisterPQCKeyV2`).
   */
  signMode?: "hybrid" | "classical";
}

/** Params for building/broadcasting a tx with {@link EthNativeSigner}. */
export interface EthTxParams extends AccountSequence {
  chainId: string;
  messages: readonly EncodeObject[];
  fee: StdFee;
  memo?: string;
  timeoutHeight?: bigint;
}

/**
 * Sign QoreChain native txs from a unified eth-native account.
 *
 * The account's `eth_secp256k1` key signs via keccak256 + the ethsecp256k1 pubkey
 * type URL. Use {@link sign} to produce a broadcastable `TxRaw`, or
 * {@link bankSend} / {@link signAndBroadcast} with a transport to submit it.
 */
export class EthNativeSigner {
  /** The signing account's `qor1…` (native) address. */
  readonly address: string;
  private readonly key: EthSigningKey;
  private readonly registry: Registry;
  private readonly signMode: "hybrid" | "classical";

  constructor(account: UnifiedAccount, opts: EthNativeSignerOptions = {}) {
    this.address = account.cosmos;
    this.key = {
      privateKey: account.privateKey,
      publicKey: account.publicKey,
      pqc: account.pqc,
    };
    this.registry = opts.registry ?? qorechainRegistry();
    this.signMode = opts.signMode ?? "hybrid";
  }

  /** Encode a message to `Any` via the bound registry. */
  private encode = (m: EncodeObject): Any => this.registry.encodeAsAny(m);

  /** Build and sign a `TxRaw` for the given messages. Does not broadcast. */
  sign(params: EthTxParams): SignedEthTx {
    const signParams = {
      account: this.key,
      chainId: params.chainId,
      accountNumber: params.accountNumber,
      messages: params.messages,
      fee: params.fee,
      sequence: params.sequence,
      memo: params.memo,
      timeoutHeight: params.timeoutHeight,
      encodeMessage: this.encode,
    };
    return this.signMode === "classical"
      ? signClassicalEth(signParams)
      : signHybridEth(signParams);
  }

  /** Sign and broadcast the given messages via `transport`. */
  async signAndBroadcast(
    transport: EthBroadcaster,
    params: EthTxParams,
  ): Promise<{
    transactionHash: string;
    code: number;
    height?: number;
    gasUsed?: bigint;
    gasWanted?: bigint;
    rawLog?: string;
  }> {
    const { txRawBytes } = this.sign(params);
    const res = await transport.broadcastTx(txRawBytes);
    if (res.code !== 0) {
      throw new Error(
        `eth-native tx failed with code ${res.code}: ${res.rawLog ?? "(no log)"} (hash ${res.transactionHash})`,
      );
    }
    return res;
  }

  /** Send `amount` to `toAddress` via a bank `MsgSend`, signed eth-native. */
  bankSend(
    transport: EthBroadcaster,
    toAddress: string,
    amount: Coin[],
    params: Omit<EthTxParams, "messages">,
  ): Promise<{ transactionHash: string; code: number }> {
    const msg: EncodeObject = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: MsgSend.fromPartial({
        fromAddress: this.address,
        toAddress,
        amount,
      }),
    };
    return this.signAndBroadcast(transport, { ...params, messages: [msg] });
  }
}

/**
 * Decode a signer's public key `Any`, accepting BOTH the Native secp256k1 pubkey
 * type and the `eth_secp256k1` type ({@link ETHSECP256K1_PUBKEY_TYPE}). The two
 * carry the same wire shape (`{ key: compressedPubkey }`); only the type URL
 * differs. Returns the 33-byte compressed public key.
 *
 * @throws if the `Any` is not one of the accepted secp256k1 pubkey types.
 */
export function parseEthPubkeyAny(pubkey: Any): Uint8Array {
  if (
    pubkey.typeUrl !== ETHSECP256K1_PUBKEY_TYPE &&
    pubkey.typeUrl !== "/cosmos.crypto.secp256k1.PubKey"
  ) {
    throw new Error(`unsupported pubkey type: ${pubkey.typeUrl}`);
  }
  return PubKey.decode(pubkey.value).key;
}

/** The auth info read off a `BaseAccount`, with the account's pubkey (if set). */
export interface ParsedAccountAuth {
  accountNumber: bigint;
  sequence: bigint;
  /** The 33-byte compressed pubkey, when the account has one on chain. */
  publicKey?: Uint8Array;
  /** The pubkey type URL as stored on chain, when present. */
  pubkeyType?: string;
}

/**
 * Parse a protobuf `BaseAccount`'s `account_number` / `sequence` (and pubkey when
 * present), accepting an `eth_secp256k1` pubkey `Any`.
 *
 * Use this to read the sequence for building a SignDoc when an account was
 * created eth-native (its on-chain pubkey uses {@link ETHSECP256K1_PUBKEY_TYPE},
 * which cosmjs's default account parser rejects).
 */
export function accountAuthInfo(account: BaseAccount): ParsedAccountAuth {
  const out: ParsedAccountAuth = {
    accountNumber: BigInt(account.accountNumber),
    sequence: BigInt(account.sequence),
  };
  if (account.pubKey) {
    out.pubkeyType = account.pubKey.typeUrl;
    out.publicKey = parseEthPubkeyAny(account.pubKey);
  }
  return out;
}
