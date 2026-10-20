/**
 * Native transaction builder and broadcaster for QoreChain.
 *
 * {@link TxClient} wraps cosmjs's `SigningStargateClient` to simulate, sign, and
 * broadcast native (QoreChain Native) transactions, with a `bankSend` convenience for
 * the common transfer case. It is constructed in two ways:
 *
 *  - {@link TxClient.connect} — the production path: connect to the network's
 *    consensus RPC with an offline signer (see {@link directSignerFromPrivateKey})
 *    and an optional custom message {@link Registry}.
 *  - `new TxClient({ signingClient, senderAddress })` — the testable path: inject
 *    any object satisfying {@link SigningClientLike}, so unit tests never touch
 *    the network.
 *
 * By default {@link TxClient.connect} uses {@link qorechainRegistry} — cosmjs's
 * standard bank/staking/gov/etc. types plus every QoreChain custom-module
 * message — so any message built via the `msg.*` composers can be carried
 * without extra setup. Callers may still register additional protobuf types
 * (e.g. from a private module) by passing `registryTypes`, or supply a fully
 * custom `registry` to override the default entirely.
 */

import {
  SigningStargateClient,
  AminoTypes,
  createDefaultAminoConverters,
  type AminoConverters,
  type SigningStargateClientOptions,
  type DeliverTxResponse,
} from "@cosmjs/stargate";
import {
  Registry,
  isOfflineDirectSigner,
  type EncodeObject,
  type OfflineDirectSigner,
  type OfflineSigner,
  type GeneratedType,
} from "@cosmjs/proto-signing";
import { SimulateRequest, SimulateResponse } from "cosmjs-types/cosmos/tx/v1beta1/service";
import { qorechainRegistry } from "../messages/registry";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import type { Coin } from "../query/rest";
import type { StdFee } from "./fees";
import { lookupDeliverCodespace, type BroadcastMode, type BroadcastResult } from "./broadcast";
import { txErrorFrom } from "../errors";
import { GasPrice, calculateFee } from "./gas";
import { buildHybridTx, signAndBroadcastHybrid, type HybridBroadcaster } from "./hybrid-tx";
import type { SignBytesVersionOption } from "./signbytes";
import type { PqcKeypair } from "../accounts/pqc";
import type { FetchLike } from "../query/http";

/** The `/cosmos.bank.v1beta1.MsgSend` type URL. */
export const MSG_SEND_TYPE_URL = "/cosmos.bank.v1beta1.MsgSend";

/** Default gas-used safety multiplier applied to a simulation result. */
export const DEFAULT_GAS_MULTIPLIER = 1.4;

/**
 * Default gas price for the auto-fee path (matches `tx/fees`).
 *
 * The chain enforces a genesis min-gas-price (BaseFee) of `0.1uqor` per unit
 * of gas on both networks; the default sits above the floor for headroom.
 */
export const DEFAULT_GAS_PRICE = "0.15uqor";

/**
 * A fee that is either an explicit {@link StdFee} or the literal `"auto"`, which
 * triggers simulation-based gas estimation and fee computation.
 */
export type FeeInput = StdFee | "auto";

/** Auto-fee tuning, used when a fee of `"auto"` is supplied. */
export interface AutoFeeOptions {
  /** Multiplier applied to the simulated gas. Defaults to {@link DEFAULT_GAS_MULTIPLIER}. */
  gasMultiplier?: number;
  /**
   * Gas price (base denom per gas unit) used to price the fee. A
   * {@link GasPrice} or a parseable string. Defaults to {@link DEFAULT_GAS_PRICE}.
   */
  gasPrice?: GasPrice | string;
}

/**
 * Build the {@link AminoTypes} used for Amino-mode signing.
 *
 * Seeds cosmjs's `createDefaultAminoConverters()` (standard Native modules:
 * bank, staking, gov, distribution, IBC, etc.) and merges any `extra`
 * converters on top — e.g. for QoreChain custom modules to support Ledger.
 *
 * QoreChain custom messages sign via DIRECT mode today (Keplr/Leap support it);
 * full Amino converters for those modules are a follow-up. Use the `extra`
 * argument as the extension point.
 */
export function buildAminoTypes(extra?: AminoConverters): AminoTypes {
  return new AminoTypes({
    ...createDefaultAminoConverters(),
    ...(extra ?? {}),
  });
}

/**
 * The subset of `SigningStargateClient` that {@link TxClient} depends on.
 * Declaring it explicitly lets unit tests inject a lightweight fake.
 */
export interface SigningClientLike {
  simulate(
    signerAddress: string,
    messages: readonly EncodeObject[],
    memo: string | undefined,
  ): Promise<number>;
  signAndBroadcast(
    signerAddress: string,
    messages: readonly EncodeObject[],
    fee: StdFee,
    memo?: string,
  ): Promise<DeliverTxResponse>;
  signAndBroadcastSync(
    signerAddress: string,
    messages: readonly EncodeObject[],
    fee: StdFee,
    memo?: string,
  ): Promise<string>;
  disconnect?(): void;
  // Used by hybrid signing ({@link TxConnectOptions.pqcKeypair}); cosmjs's
  // SigningStargateClient provides all four.
  getChainId?(): Promise<string>;
  getSequence?(address: string): Promise<{ accountNumber: number | bigint; sequence: number | bigint }>;
  broadcastTx?: HybridBroadcaster["broadcastTx"];
  broadcastTxSync?: HybridBroadcaster["broadcastTxSync"];
}

/**
 * Hybrid (classical + ML-DSA-87) signing for a {@link TxClient}. Every
 * transaction is then signed the way the chain requires of an account with a
 * registered PQC key; a transaction that only registers the key is still
 * signed classically (the chain's bootstrap path).
 */
export interface HybridSigningOptions {
  /** The account's ML-DSA-87 keypair: the key registered on chain. */
  pqcKeypair: PqcKeypair;
  /** The classical DIRECT signer that signs the SignDoc. */
  signer: OfflineDirectSigner;
  /** The registry that encodes the body (the client's own). */
  registry: Registry;
  /**
   * The network's REST URL. Used to pick the sign-bytes form
   * (`signBytesVersion: "auto"`, required on qorechain-vladi / qorechain-diana),
   * to simulate the hybrid transaction for `fee: "auto"`, and to read a failed
   * transaction's codespace.
   */
  rest?: string;
  /** Injectable `fetch` for `rest`. */
  fetch?: FetchLike;
  /** Force a sign-bytes form instead of asking the network. */
  signBytesVersion?: SignBytesVersionOption;
}

/** Standard base64 of raw bytes (browser and Node). */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * Gas a hybrid transaction spends in the block beyond what its simulation
 * reports: the ML-DSA-87 verification is not charged in simulation. Measured on
 * the chain (a hybrid MsgSend simulates at about 129k and uses about 164k).
 */
export const HYBRID_VERIFY_GAS = 40_000;

/** Messages the chain accepts with a classical signature only: PQC key registration. */
const PQC_REGISTRATION_TYPE_URLS = new Set([
  "/qorechain.pqc.v1.MsgRegisterPQCKey",
  "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
]);

/** Options for constructing a {@link TxClient} directly (testing/advanced). */
export interface TxClientOptions {
  /** The underlying signing client (real or fake). */
  signingClient: SigningClientLike;
  /** The bech32 address transactions are signed and sent from. */
  senderAddress: string;
  /** Sign hybrid (see {@link HybridSigningOptions}). Omit for classical only. */
  hybrid?: HybridSigningOptions;
}

/** Options for {@link TxClient.connect}. */
export interface TxConnectOptions {
  /** Consensus RPC endpoint (e.g. `endpoints.rpc`). */
  rpcEndpoint: string;
  /**
   * An offline signer. Either a DIRECT signer (see
   * {@link directSignerFromPrivateKey}) or an Amino signer — including the
   * `OfflineSigner` returned by a browser wallet's `getOfflineSignerAuto`
   * (Keplr/Leap), which picks DIRECT or Amino automatically. Custom QoreChain
   * messages sign via DIRECT mode; Amino mode covers standard Native messages
   * (see `aminoTypes`).
   */
  signer: OfflineSigner;
  /**
   * Extra protobuf message types to register, as `[typeUrl, GeneratedType]`
   * pairs. Added on top of the default {@link qorechainRegistry} (standard
   * Native types + all QoreChain custom-module messages). Use this for messages
   * the SDK does not ship, e.g. from a private module. Ignored if `registry`
   * is supplied.
   */
  registryTypes?: ReadonlyArray<[string, GeneratedType]>;
  /**
   * A fully custom message registry to use instead of the default
   * {@link qorechainRegistry}. When set, `registryTypes` is ignored.
   */
  registry?: Registry;
  /**
   * Amino converters for Amino-mode signing (Ledger and some hardware/mobile
   * wallets sign Amino). Defaults to cosmjs's `createDefaultAminoConverters()`,
   * which covers the standard Native modules (bank, staking, gov, distribution,
   * etc.). When set, this replaces the defaults entirely — to add converters on
   * top of the defaults use {@link extraAminoConverters} instead.
   *
   * Full Amino converters for QoreChain's custom modules are a follow-up; for
   * now those messages sign via DIRECT mode (supported by Keplr/Leap).
   */
  aminoTypes?: AminoTypes;
  /**
   * Extra Amino converters merged on top of the default converters. Use this to
   * register converters for custom modules (e.g. for Ledger support) without
   * losing the standard Native converters. Ignored if `aminoTypes` is supplied.
   */
  extraAminoConverters?: AminoConverters;
  /** Additional cosmjs `SigningStargateClientOptions` (gas price, etc.). */
  clientOptions?: SigningStargateClientOptions;
  /**
   * The account's registered ML-DSA-87 keypair. When set, every transaction
   * is signed hybrid (classical + post-quantum), as QoreChain requires of an
   * account with a PQC key; a transaction that only registers the key stays
   * classical. Needs a DIRECT `signer`. Register the key first with
   * `ensurePqcRegistered(tx, { pqcKeypair, rest })`.
   */
  pqcKeypair?: PqcKeypair;
  /**
   * The network's REST URL, for hybrid signing: picks the sign-bytes form,
   * simulates `fee: "auto"` and reads failed transactions' codespace.
   * Required with `pqcKeypair` on qorechain-vladi / qorechain-diana unless
   * `signBytesVersion` is forced.
   */
  rest?: string;
  /** Injectable `fetch` for `rest`. */
  fetch?: FetchLike;
  /** Force a hybrid sign-bytes form (`"v1"` / `"v2"`) instead of asking `rest`. */
  signBytesVersion?: SignBytesVersionOption;
}

/** Options accepted when signing and broadcasting. */
export interface SignAndBroadcastOptions {
  /** Broadcast mode. Defaults to `"commit"`. */
  mode?: BroadcastMode;
  /**
   * Auto-fee tuning, used only when `fee` is `"auto"`. Multiplier and gas price
   * applied to the simulated gas to compute the fee.
   */
  autoFee?: AutoFeeOptions;
}

/** Options for {@link TxClient.simulate}. */
export interface SimulateOptions {
  /** Optional tx memo to include in the simulation. */
  memo?: string;
}

/** Options for {@link TxClient.bankSend}. */
export interface BankSendOptions extends SignAndBroadcastOptions {
  /**
   * The fee to pay: an explicit {@link StdFee} or `"auto"` to simulate and
   * compute it. Defaults to `"auto"` when omitted.
   */
  fee?: FeeInput;
  /** Optional memo. */
  memo?: string;
}

/**
 * Deep-copy a value: arrays, plain and class-instance objects (prototype kept,
 * so e.g. `Long` keeps its methods), `Uint8Array`, `Date`, `Map` and `Set`. Primitives
 * (including `bigint`) are returned as is.
 */
function cloneDeep<T>(value: T): T {
  if (value instanceof Uint8Array) return value.slice() as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => cloneDeep(v)) as T;
  if (value instanceof Map) {
    return new Map([...value].map(([k, v]) => [k, cloneDeep(v)])) as T;
  }
  if (value instanceof Set) return new Set([...value].map((v) => cloneDeep(v))) as T;
  if (value !== null && typeof value === "object") {
    const out = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      out[key] = cloneDeep((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

/** A private copy of a message list (each `{ typeUrl, value }` deep-copied). */
function cloneMessages(messages: readonly EncodeObject[]): EncodeObject[] {
  return messages.map((m) => ({ typeUrl: m.typeUrl, value: cloneDeep(m.value) }));
}

/**
 * A native-transaction client: simulate, sign, broadcast, and send tokens.
 */
export class TxClient {
  private readonly client: SigningClientLike;
  private readonly hybrid?: HybridSigningOptions;
  /** The signing/sending bech32 address. */
  readonly senderAddress: string;

  constructor(opts: TxClientOptions) {
    this.client = opts.signingClient;
    this.senderAddress = opts.senderAddress;
    this.hybrid = opts.hybrid;
  }

  /** The ML-DSA-87 keypair this client signs with, when it signs hybrid. */
  get pqcKeypair(): PqcKeypair | undefined {
    return this.hybrid?.pqcKeypair;
  }

  /** Whether `messages` go out hybrid-signed (everything but a bare key registration). */
  private signsHybrid(messages: readonly EncodeObject[]): boolean {
    if (!this.hybrid) return false;
    return !(messages.length > 0 && messages.every((m) => PQC_REGISTRATION_TYPE_URLS.has(m.typeUrl)));
  }

  /** Chain id, account number and sequence for building a hybrid tx. */
  private async accountContext(): Promise<{ chainId: string; accountNumber: bigint; sequence: bigint }> {
    if (!this.client.getChainId || !this.client.getSequence) {
      throw new Error("hybrid signing needs a signing client that reports the chain id and the account sequence");
    }
    const [chainId, { accountNumber, sequence }] = await Promise.all([
      this.client.getChainId(),
      this.client.getSequence(this.senderAddress),
    ]);
    return { chainId, accountNumber: BigInt(accountNumber), sequence: BigInt(sequence) };
  }

  /**
   * Simulate a hybrid transaction as it will be sent: the extension's 4627-byte
   * signature and its verification cost gas that a signature-less simulation
   * does not see.
   */
  private async simulateHybrid(messages: readonly EncodeObject[], memo: string | undefined): Promise<number> {
    const h = this.hybrid!;
    const ctx = await this.accountContext();
    const built = await buildHybridTx({
      registry: h.registry,
      signer: h.signer,
      pqcKeypair: h.pqcKeypair,
      messages,
      // Simulation runs without a gas limit or a fee check.
      fee: { amount: [], gas: "0" },
      memo,
      ...ctx,
      rest: h.rest,
      fetch: h.fetch,
      signBytesVersion: h.signBytesVersion,
    });
    return (await this.simulateTxBytes(built.txRawBytes)) + HYBRID_VERIFY_GAS;
  }

  /**
   * Simulate signed tx bytes. Over the client's own connection first: the
   * node's REST gateway renders the result as JSON and fails for messages
   * whose response type it cannot resolve (e.g. MsgOpenEVMWindowResponse).
   */
  private async simulateTxBytes(txBytes: Uint8Array): Promise<number> {
    const query = (
      this.client as {
        forceGetQueryClient?: () => { queryAbci(path: string, data: Uint8Array): Promise<{ value: Uint8Array }> };
      }
    ).forceGetQueryClient?.();
    if (query) {
      const res = await query.queryAbci(
        "/cosmos.tx.v1beta1.Service/Simulate",
        SimulateRequest.encode(SimulateRequest.fromPartial({ txBytes })).finish(),
      );
      return Number(SimulateResponse.decode(res.value).gasInfo?.gasUsed ?? 0n);
    }
    const h = this.hybrid!;
    if (!h.rest) throw new Error('hybrid fee "auto" needs `rest` or a client with a query connection');
    const f = h.fetch ?? (globalThis.fetch as FetchLike);
    const url = `${h.rest.replace(/\/+$/, "")}/cosmos/tx/v1beta1/simulate`;
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_bytes: toBase64(txBytes) }),
    });
    const body = (await res.json()) as { gas_info?: { gas_used?: string }; message?: string };
    if (!res.ok || body.gas_info?.gas_used === undefined) {
      throw new Error(`simulation failed: ${body.message ?? `HTTP ${res.status} from ${url}`}`);
    }
    return Number(body.gas_info.gas_used);
  }

  /**
   * Connect to a network's consensus RPC and build a {@link TxClient}.
   *
   * Resolves the signer's first account as the sender address and merges any
   * `registryTypes` into cosmjs's default message registry.
   */
  static async connect(opts: TxConnectOptions): Promise<TxClient> {
    const registry =
      opts.registry ?? qorechainRegistry(opts.registryTypes ?? []);
    const aminoTypes =
      opts.aminoTypes ?? buildAminoTypes(opts.extraAminoConverters);
    const client = await SigningStargateClient.connectWithSigner(
      opts.rpcEndpoint,
      opts.signer,
      { registry, aminoTypes, ...opts.clientOptions },
    );
    const accounts = await opts.signer.getAccounts();
    if (accounts.length === 0) {
      throw new Error("signer exposes no accounts");
    }
    let hybrid: HybridSigningOptions | undefined;
    if (opts.pqcKeypair) {
      if (!isOfflineDirectSigner(opts.signer)) {
        throw new Error("hybrid signing (pqcKeypair) needs a DIRECT signer: the post-quantum signature covers the protobuf body");
      }
      hybrid = {
        pqcKeypair: opts.pqcKeypair,
        signer: opts.signer,
        registry,
        rest: opts.rest,
        fetch: opts.fetch,
        signBytesVersion: opts.signBytesVersion,
      };
    }
    return new TxClient({
      signingClient: client,
      senderAddress: accounts[0].address,
      hybrid,
    });
  }

  /**
   * Simulate the given messages and return the estimated gas units.
   *
   * Use the result (with a safety multiplier) as the `gas` for `estimateFee`,
   * or let {@link estimateGas}/the `"auto"` fee path apply the multiplier.
   */
  simulate(
    messages: readonly EncodeObject[],
    opts: SimulateOptions = {},
  ): Promise<number> {
    if (this.signsHybrid(messages)) return this.simulateHybrid(messages, opts.memo);
    return this.client.simulate(this.senderAddress, messages, opts.memo);
  }

  /**
   * Estimate the gas limit for `messages` by simulating and applying a safety
   * multiplier (default {@link DEFAULT_GAS_MULTIPLIER}). Returns the gas units,
   * rounded up.
   */
  async estimateGas(
    messages: readonly EncodeObject[],
    memo?: string,
    gasMultiplier: number = DEFAULT_GAS_MULTIPLIER,
  ): Promise<number> {
    const gasUsed = await this.simulate(messages, { memo });
    return Math.ceil(gasUsed * gasMultiplier);
  }

  /**
   * Compute a {@link StdFee} for a gas limit at a gas price. Thin re-export of
   * {@link calculateFee} for callers who already have a gas estimate.
   */
  calculateFee(gas: number | string, gasPrice: GasPrice | string): StdFee {
    return calculateFee(gas, gasPrice);
  }

  /**
   * Resolve a {@link FeeInput} to a concrete {@link StdFee}. For `"auto"`,
   * simulates `messages`, multiplies the gas by `gasMultiplier`, and prices it
   * with `gasPrice` via {@link calculateFee}.
   */
  async resolveFee(
    messages: readonly EncodeObject[],
    fee: FeeInput,
    memo: string | undefined,
    autoFee: AutoFeeOptions = {},
  ): Promise<StdFee> {
    if (fee !== "auto") return fee;
    const gas = await this.estimateGas(
      messages,
      memo,
      autoFee.gasMultiplier ?? DEFAULT_GAS_MULTIPLIER,
    );
    return calculateFee(gas, autoFee.gasPrice ?? DEFAULT_GAS_PRICE);
  }

  /**
   * Sign and broadcast the given messages.
   *
   * `fee` may be an explicit {@link StdFee} or the literal `"auto"`, which
   * simulates the tx to estimate gas and computes the fee from a gas
   * multiplier (default 1.4) and gas price (default `0.15uqor`); tune both via
   * `opts.autoFee`.
   *
   * Broadcast mode maps onto cosmjs transports:
   * - `commit` (default): polls until the tx lands in a block; returns the full
   *   result and throws a {@link QoreTxError} on a non-zero delivery code.
   * - `sync` / `async`: returns after mempool submission with just the tx hash.
   */
  async signAndBroadcast(
    messages: readonly EncodeObject[],
    fee: FeeInput,
    memo = "",
    opts: SignAndBroadcastOptions = {},
  ): Promise<BroadcastResult> {
    const mode: BroadcastMode = opts.mode ?? "commit";
    // One private copy, taken before the first await, feeds BOTH the "auto"
    // fee simulation and the signing — so the caller mutating its message
    // objects (or fee) mid-call cannot make the signed tx differ from the
    // simulated one, or from what it passed in.
    const msgs = cloneMessages(messages);
    const feeInput: FeeInput = fee === "auto" ? fee : cloneDeep(fee);
    const resolvedFee = await this.resolveFee(msgs, feeInput, memo, opts.autoFee);

    if (this.signsHybrid(msgs)) {
      const h = this.hybrid!;
      return signAndBroadcastHybrid({
        registry: h.registry,
        signer: h.signer,
        pqcKeypair: h.pqcKeypair,
        messages: msgs,
        fee: resolvedFee,
        memo,
        ...(await this.accountContext()),
        rest: h.rest,
        fetch: h.fetch,
        signBytesVersion: h.signBytesVersion,
        transport: this.client as HybridBroadcaster,
        mode,
      });
    }

    if (mode === "commit") {
      const res = await this.client.signAndBroadcast(
        this.senderAddress,
        msgs,
        resolvedFee,
        memo,
      );
      if (res.code !== 0) {
        throw txErrorFrom({
          code: res.code,
          codespace:
            (res as { codespace?: string }).codespace ??
            (await lookupDeliverCodespace(res.transactionHash, { client: this.client })),
          rawLog: res.rawLog,
          txHash: res.transactionHash,
        });
      }
      return {
        transactionHash: res.transactionHash,
        code: res.code,
        height: res.height,
        gasUsed: res.gasUsed,
        gasWanted: res.gasWanted,
        rawLog: res.rawLog,
        // Carried through so callers can read typed attributes / decode the
        // per-message responses (e.g. MsgCrossVMCallResponse) without a
        // second round-trip.
        events: res.events,
        msgResponses: res.msgResponses,
      };
    }

    // sync / async: both return after CheckTx without polling for a block.
    const hash = await this.client.signAndBroadcastSync(
      this.senderAddress,
      msgs,
      resolvedFee,
      memo,
    );
    return { transactionHash: hash, code: 0 };
  }

  /**
   * Send `amount` to `toAddress` via a bank `MsgSend`, then broadcast.
   *
   * Constructs `/cosmos.bank.v1beta1.MsgSend` from this client's sender address.
   * The fee defaults to `"auto"` (simulation-based) when not supplied.
   */
  bankSend(
    toAddress: string,
    amount: Coin[],
    opts: BankSendOptions = {},
  ): Promise<BroadcastResult> {
    const msg: EncodeObject = {
      typeUrl: MSG_SEND_TYPE_URL,
      value: MsgSend.fromPartial({
        fromAddress: this.senderAddress,
        toAddress,
        amount,
      }),
    };
    return this.signAndBroadcast([msg], opts.fee ?? "auto", opts.memo ?? "", {
      mode: opts.mode,
      autoFee: opts.autoFee,
    });
  }

  /** Disconnect the underlying client's transport, if it supports it. */
  disconnect(): void {
    this.client.disconnect?.();
  }
}
