/**
 * Native transaction builder and broadcaster for QoreChain.
 *
 * {@link TxClient} wraps cosmjs's `SigningStargateClient` to simulate, sign, and
 * broadcast native (Cosmos SDK) transactions, with a `bankSend` convenience for
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
  type EncodeObject,
  type OfflineSigner,
  type GeneratedType,
} from "@cosmjs/proto-signing";
import { qorechainRegistry } from "../messages/registry";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import type { Coin } from "../query/rest";
import type { StdFee } from "./fees";
import type { BroadcastMode, BroadcastResult } from "./broadcast";
import { txErrorFrom } from "../errors";
import { GasPrice, calculateFee } from "./gas";

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
 * Seeds cosmjs's `createDefaultAminoConverters()` (standard Cosmos modules:
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
}

/** Options for constructing a {@link TxClient} directly (testing/advanced). */
export interface TxClientOptions {
  /** The underlying signing client (real or fake). */
  signingClient: SigningClientLike;
  /** The bech32 address transactions are signed and sent from. */
  senderAddress: string;
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
   * messages sign via DIRECT mode; Amino mode covers standard Cosmos messages
   * (see `aminoTypes`).
   */
  signer: OfflineSigner;
  /**
   * Extra protobuf message types to register, as `[typeUrl, GeneratedType]`
   * pairs. Added on top of the default {@link qorechainRegistry} (standard
   * Cosmos types + all QoreChain custom-module messages). Use this for messages
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
   * which covers the standard Cosmos modules (bank, staking, gov, distribution,
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
   * losing the standard Cosmos converters. Ignored if `aminoTypes` is supplied.
   */
  extraAminoConverters?: AminoConverters;
  /** Additional cosmjs `SigningStargateClientOptions` (gas price, etc.). */
  clientOptions?: SigningStargateClientOptions;
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
 * A native-transaction client: simulate, sign, broadcast, and send tokens.
 */
export class TxClient {
  private readonly client: SigningClientLike;
  /** The signing/sending bech32 address. */
  readonly senderAddress: string;

  constructor(opts: TxClientOptions) {
    this.client = opts.signingClient;
    this.senderAddress = opts.senderAddress;
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
    return new TxClient({
      signingClient: client,
      senderAddress: accounts[0].address,
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
    const resolvedFee = await this.resolveFee(messages, fee, memo, opts.autoFee);

    if (mode === "commit") {
      const res = await this.client.signAndBroadcast(
        this.senderAddress,
        messages,
        resolvedFee,
        memo,
      );
      if (res.code !== 0) {
        throw txErrorFrom({
          code: res.code,
          codespace: (res as { codespace?: string }).codespace,
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
      };
    }

    // sync / async: both return after CheckTx without polling for a block.
    const hash = await this.client.signAndBroadcastSync(
      this.senderAddress,
      messages,
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
