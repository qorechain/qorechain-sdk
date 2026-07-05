/**
 * Wallet DX for the v3.1.85 authenticator lanes.
 *
 * These builders mirror the reference wallet-adapter: they take a linked
 * external wallet (a Phantom ed25519 key, or a MetaMask / EIP-1193 secp256k1
 * key), rebuild the domain-separated authenticator sign-bytes (see
 * {@link ../tx/authenticator}), have the wallet sign the 32-byte digest, and
 * return a relayer-ready `{ typeUrl, value }` message for the EVM or Native
 * lane. A relayer then submits and pays fees; the authenticator's signature IS
 * the authorization — the external key never produces an ML-DSA co-signature.
 *
 * Signature schemes:
 *   - `ed25519` (Phantom): the chain verifies `ed25519.Verify(pubkey, digest,
 *     sig)`, so a Phantom `signMessage(digest)` matches directly.
 *   - `secp256k1` (MetaMask): the key is linked by its 20-byte ETH ADDRESS; the
 *     wallet produces a 65-byte `personal_sign` (EIP-191) signature over the
 *     same digest.
 *
 * Also included: the low-level message composers, and mnemonic-based PQC key
 * rotation (legacy→canonical migration) with both keys dual-signing the
 * rotation bytes.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import { mldsa, shake256 } from "@qorechain/pqc";
import { generatePqcKeypair, type PqcKeypair } from "../accounts/pqc";
import {
  evmAuthSignBytes,
  cosmosAuthSignBytes,
  rotationSignBytes,
} from "../tx/authenticator";

const enc = new TextEncoder();

// ---- byte helpers -------------------------------------------------------

/** Coerce a string or bytes input to bytes (UTF-8 for strings). */
function toBytes(x: Uint8Array | string): Uint8Array {
  return typeof x === "string" ? enc.encode(x) : x;
}

/** Parse a hex string (with or without `0x`) into bytes. */
function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Encode bytes as a `0x`-prefixed lowercase hex string. */
function bytesToHex0x(b: Uint8Array): string {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** Lowercase hex of raw bytes (no `0x` prefix). */
function toHexLower(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** Parse a single-coin amount string like `100uqor` into `[{denom,amount}]`. */
function parseCoins(amount: string): { denom: string; amount: string }[] {
  const m = /^([0-9]+)([a-zA-Z][a-zA-Z0-9/:._-]*)$/.exec(String(amount).trim());
  if (!m) {
    throw new Error(`invalid amount "${amount}" (expected e.g. "100uqor")`);
  }
  return [{ denom: m[2], amount: m[1] }];
}

// ---- message composers --------------------------------------------------

/** Fields for {@link executeEvmMsg}. */
export interface ExecuteEvmMsgInput {
  relayer: string;
  account: string;
  scheme: "ed25519" | "secp256k1";
  pubkey: Uint8Array;
  signature: Uint8Array;
  to?: string;
  value?: string;
  data?: Uint8Array;
  gasLimit: number | bigint;
  nonce: number | bigint;
}

/**
 * Build a `MsgExecuteEVM` (`{ typeUrl, value }`) — the relayer broadcasts this
 * and is the fee payer. `to` is a 0x-hex address, `value` a decimal wei string.
 */
export function executeEvmMsg(input: ExecuteEvmMsgInput): EncodeObject {
  const {
    relayer,
    account,
    scheme,
    pubkey,
    signature,
    to = "",
    value = "0",
    data = new Uint8Array(0),
    gasLimit,
    nonce,
  } = input;
  return {
    typeUrl: "/qorechain.abstractaccount.v1.MsgExecuteEVM",
    value: {
      relayer,
      account,
      scheme,
      pubkey: toBytes(pubkey),
      signature: toBytes(signature),
      to,
      value,
      data: toBytes(data),
      gasLimit: BigInt(gasLimit),
      nonce: BigInt(nonce),
    },
  };
}

/** Fields for {@link executeCosmosMsg}. */
export interface ExecuteCosmosMsgInput {
  relayer: string;
  account: string;
  scheme: "ed25519" | "secp256k1";
  pubkey: Uint8Array;
  signature: Uint8Array;
  to: string;
  /** Single-coin amount string, e.g. `100uqor`. */
  amount: string;
  nonce: number | bigint;
}

/**
 * Build a `MsgExecuteCosmos` (`{ typeUrl, value }`) — the relayer broadcasts
 * this. `amount` is a single-coin string like `100uqor`.
 */
export function executeCosmosMsg(input: ExecuteCosmosMsgInput): EncodeObject {
  const { relayer, account, scheme, pubkey, signature, to, amount, nonce } =
    input;
  return {
    typeUrl: "/qorechain.abstractaccount.v1.MsgExecuteCosmos",
    value: {
      relayer,
      account,
      scheme,
      pubkey: toBytes(pubkey),
      signature: toBytes(signature),
      to,
      amount: parseCoins(amount),
      nonce: BigInt(nonce),
    },
  };
}

/** Fields for {@link revokeAuthenticatorMsg}. */
export interface RevokeAuthenticatorMsgInput {
  owner: string;
  account?: string;
  scheme: "ed25519" | "secp256k1";
  pubkey: Uint8Array;
}

/**
 * Build a `MsgRevokeAuthenticator` (`{ typeUrl, value }`) — owner-signed;
 * instantly disables a linked key. `account` defaults to `owner`.
 */
export function revokeAuthenticatorMsg(
  input: RevokeAuthenticatorMsgInput,
): EncodeObject {
  const { owner, account = owner, scheme, pubkey } = input;
  return {
    typeUrl: "/qorechain.abstractaccount.v1.MsgRevokeAuthenticator",
    value: {
      owner,
      accountAddress: account,
      scheme,
      pubkey: toBytes(pubkey),
    },
  };
}

/** Fields for {@link registerEthAuthenticatorMsg}. */
export interface RegisterEthAuthenticatorMsgInput {
  owner: string;
  account?: string;
  /** 0x-hex 20-byte ETH address that becomes the authenticator pubkey. */
  ethAddress: string;
  permissions?: string[];
  expiryUnix: number | bigint;
  label?: string;
}

/**
 * Build a `MsgRegisterAuthenticator` (`{ typeUrl, value }`) that links a
 * MetaMask / EVM key (by its 0x address, scheme `secp256k1`) to the owner's
 * account. Owner-signed. `account` defaults to `owner`.
 */
export function registerEthAuthenticatorMsg(
  input: RegisterEthAuthenticatorMsgInput,
): EncodeObject {
  const {
    owner,
    account = owner,
    ethAddress,
    permissions = ["evm"],
    expiryUnix,
    label = "metamask",
  } = input;
  return {
    typeUrl: "/qorechain.abstractaccount.v1.MsgRegisterAuthenticator",
    value: {
      owner,
      accountAddress: account,
      scheme: "secp256k1",
      pubkey: hexToBytes(ethAddress),
      permissions,
      expiryUnix: BigInt(expiryUnix),
      label,
    },
  };
}

/** Fields for {@link rotatePqcKeyMsg}. */
export interface RotatePqcKeyMsgInput {
  sender: string;
  oldPublicKey: Uint8Array;
  newPublicKey: Uint8Array;
  oldSignature: Uint8Array;
  newSignature: Uint8Array;
}

/**
 * Build a `MsgRotatePQCKey` (`{ typeUrl, value }`) — sender-signed (hybrid, with
 * the OLD key); dual-signed payload.
 */
export function rotatePqcKeyMsg(input: RotatePqcKeyMsgInput): EncodeObject {
  const { sender, oldPublicKey, newPublicKey, oldSignature, newSignature } =
    input;
  return {
    typeUrl: "/qorechain.pqc.v1.MsgRotatePQCKey",
    value: {
      sender,
      oldPublicKey: toBytes(oldPublicKey),
      newPublicKey: toBytes(newPublicKey),
      oldSignature: toBytes(oldSignature),
      newSignature: toBytes(newSignature),
    },
  };
}

// ---- Phantom (ed25519) envelope builders --------------------------------

/**
 * The minimal Phantom-style ed25519 wallet shape the builders need: a public
 * key (as `.toBytes()` or raw bytes) and `signMessage` returning `{ signature }`
 * or raw bytes.
 */
export interface AuthenticatorWallet {
  publicKey: { toBytes(): Uint8Array } | Uint8Array;
  signMessage(
    message: Uint8Array,
  ): Promise<{ signature: Uint8Array } | Uint8Array>;
}

/** Normalize a wallet public key (object with `toBytes` or raw bytes) to bytes. */
function walletPubkey(wallet: AuthenticatorWallet): Uint8Array {
  const pk = wallet.publicKey;
  return pk instanceof Uint8Array ? pk : pk.toBytes();
}

/** Normalize a `signMessage` result (`.signature` or raw bytes) to bytes. */
function normalizeSignature(
  res: { signature: Uint8Array } | Uint8Array,
): Uint8Array {
  return res instanceof Uint8Array ? res : res.signature;
}

/** Fields for {@link buildPhantomExecuteEvm}. */
export interface BuildPhantomExecuteEvmOptions {
  wallet: AuthenticatorWallet;
  relayer: string;
  chainId: string;
  account: string;
  to?: string;
  value?: string;
  data?: Uint8Array;
  gasLimit?: number | bigint;
  /** The account's CURRENT EVM nonce (relayer ≠ owner → do NOT +1). */
  nonce: number | bigint;
}

/**
 * Sign the EVM auth digest with a Phantom-style ed25519 wallet and return a
 * `MsgExecuteEVM` ready for the relayer to broadcast.
 */
export async function buildPhantomExecuteEvm(
  opts: BuildPhantomExecuteEvmOptions,
): Promise<EncodeObject> {
  const {
    wallet,
    relayer,
    chainId,
    account,
    to = "",
    value = "0",
    data = new Uint8Array(0),
    gasLimit = 100000,
    nonce,
  } = opts;
  const pubkey = walletPubkey(wallet);
  const digest = evmAuthSignBytes({ chainId, account, pubkey, to, value, data, nonce });
  const signature = normalizeSignature(await wallet.signMessage(digest));
  return executeEvmMsg({
    relayer,
    account,
    scheme: "ed25519",
    pubkey,
    signature,
    to,
    value,
    data,
    gasLimit,
    nonce,
  });
}

/** Fields for {@link buildPhantomExecuteCosmos}. */
export interface BuildPhantomExecuteCosmosOptions {
  wallet: AuthenticatorWallet;
  relayer: string;
  chainId: string;
  account: string;
  to: string;
  /** Single-coin amount string, e.g. `100uqor`. */
  amount: string;
  /** The per-authenticator sequence for `(account, pubkey)`. */
  nonce: number | bigint;
}

/**
 * Sign the Native (Cosmos) auth digest with a Phantom-style ed25519 wallet and
 * return a `MsgExecuteCosmos` ready for the relayer to broadcast.
 */
export async function buildPhantomExecuteCosmos(
  opts: BuildPhantomExecuteCosmosOptions,
): Promise<EncodeObject> {
  const { wallet, relayer, chainId, account, to, amount, nonce } = opts;
  const pubkey = walletPubkey(wallet);
  const digest = cosmosAuthSignBytes({ chainId, account, pubkey, to, amount, nonce });
  const signature = normalizeSignature(await wallet.signMessage(digest));
  return executeCosmosMsg({
    relayer,
    account,
    scheme: "ed25519",
    pubkey,
    signature,
    to,
    amount,
    nonce,
  });
}

// ---- MetaMask (EIP-191 / secp256k1) envelope builders -------------------

/** The minimal EIP-1193 provider shape the MetaMask builders need. */
export interface Eip1193Provider {
  request(args: { method: string; params: unknown[] }): Promise<string>;
}

/** `personal_sign` (EIP-191) over the 32-byte digest via an EIP-1193 provider. */
async function ethPersonalSign(
  provider: Eip1193Provider,
  address: string,
  digest: Uint8Array,
): Promise<Uint8Array> {
  const sigHex = await provider.request({
    method: "personal_sign",
    params: [bytesToHex0x(digest), address],
  });
  return hexToBytes(sigHex); // 65 bytes r‖s‖v (v = 27/28)
}

/** Fields for {@link buildMetaMaskExecuteEvm}. */
export interface BuildMetaMaskExecuteEvmOptions {
  provider: Eip1193Provider;
  /** 0x-hex 20-byte ETH address (the authenticator pubkey). */
  address: string;
  relayer: string;
  chainId: string;
  account: string;
  to?: string;
  value?: string;
  data?: Uint8Array;
  gasLimit?: number | bigint;
  /** The account's CURRENT EVM nonce (relayer ≠ owner → do NOT +1). */
  nonce: number | bigint;
}

/**
 * Sign the EVM auth digest via MetaMask (EIP-191 `personal_sign`) and return a
 * `MsgExecuteEVM` ready for the relayer. The key is linked by its 20-byte ETH
 * address (scheme `secp256k1`).
 */
export async function buildMetaMaskExecuteEvm(
  opts: BuildMetaMaskExecuteEvmOptions,
): Promise<EncodeObject> {
  const {
    provider,
    address,
    relayer,
    chainId,
    account,
    to = "",
    value = "0",
    data = new Uint8Array(0),
    gasLimit = 100000,
    nonce,
  } = opts;
  const pubkey = hexToBytes(address);
  const digest = evmAuthSignBytes({ chainId, account, pubkey, to, value, data, nonce });
  const signature = await ethPersonalSign(provider, address, digest);
  return executeEvmMsg({
    relayer,
    account,
    scheme: "secp256k1",
    pubkey,
    signature,
    to,
    value,
    data,
    gasLimit,
    nonce,
  });
}

/** Fields for {@link buildMetaMaskExecuteCosmos}. */
export interface BuildMetaMaskExecuteCosmosOptions {
  provider: Eip1193Provider;
  /** 0x-hex 20-byte ETH address (the authenticator pubkey). */
  address: string;
  relayer: string;
  chainId: string;
  account: string;
  to: string;
  /** Single-coin amount string, e.g. `100uqor`. */
  amount: string;
  /** The per-authenticator sequence for `(account, address)`. */
  nonce: number | bigint;
}

/**
 * Sign the Native (Cosmos) auth digest via MetaMask (EIP-191 `personal_sign`)
 * and return a `MsgExecuteCosmos` ready for the relayer.
 */
export async function buildMetaMaskExecuteCosmos(
  opts: BuildMetaMaskExecuteCosmosOptions,
): Promise<EncodeObject> {
  const { provider, address, relayer, chainId, account, to, amount, nonce } =
    opts;
  const pubkey = hexToBytes(address);
  const digest = cosmosAuthSignBytes({ chainId, account, pubkey, to, amount, nonce });
  const signature = await ethPersonalSign(provider, address, digest);
  return executeCosmosMsg({
    relayer,
    account,
    scheme: "secp256k1",
    pubkey,
    signature,
    to,
    amount,
    nonce,
  });
}

// ---- PQC key rotation (legacy → canonical migration) --------------------

/**
 * The CANONICAL address-bound PQC derivation (SDK / wallet-adapter):
 * `shake256("qorechain:pqc:v1|" + account + "|" + mnemonic, 32)` → ML-DSA-87
 * keygen. This matches {@link ../accounts/unified.deriveUnifiedAccount}.
 */
export const CANONICAL_DERIVATION = "adapter";
/**
 * The LEGACY chain-bridge / faucet-api PQC derivation:
 * `shake256(utf8(mnemonic), 32)` → ML-DSA-87 keygen. Not address-bound.
 */
export const LEGACY_DERIVATION = "bridge";

/** Derive the LEGACY (chain-bridge) ML-DSA-87 keypair for a mnemonic. */
export function derivePqcLegacy(mnemonic: string): PqcKeypair {
  return generatePqcKeypair(shake256(enc.encode(mnemonic), 32));
}

/** Derive the CANONICAL (address-bound) ML-DSA-87 keypair for a mnemonic. */
function derivePqcCanonical(account: string, mnemonic: string): PqcKeypair {
  return generatePqcKeypair(
    shake256(enc.encode(`qorechain:pqc:v1|${account}|${mnemonic}`), 32),
  );
}

/** Resolve a derivation name to its ML-DSA-87 keypair. */
function derivePqcByScheme(
  scheme: string,
  account: string,
  mnemonic: string,
): PqcKeypair {
  if (scheme === LEGACY_DERIVATION || scheme === "mnemonic-only") {
    return derivePqcLegacy(mnemonic);
  }
  if (scheme === CANONICAL_DERIVATION || scheme === "") {
    return derivePqcCanonical(account, mnemonic);
  }
  throw new Error(`unknown derivation "${scheme}" (use adapter|bridge)`);
}

/** Options for {@link rotatePqcKeyMsgFromMnemonic}. */
export interface RotatePqcKeyMsgFromMnemonicOptions {
  account: string;
  mnemonic: string;
  chainId: string;
  /** PQC algorithm id (ML-DSA-87 = 1). */
  algorithmId?: number;
  /** Source derivation (defaults to the legacy chain-bridge derivation). */
  oldDerivation?: string;
  /** Target derivation (defaults to the canonical address-bound derivation). */
  newDerivation?: string;
}

/** Result of {@link rotatePqcKeyMsgFromMnemonic}. */
export interface RotatePqcKeyMsgFromMnemonicResult {
  /** The `{ typeUrl, value }` `MsgRotatePQCKey` to broadcast. */
  msg: EncodeObject;
  /** The OLD keypair (still the registered key until the rotation lands). */
  oldKeypair: PqcKeypair;
  /** The NEW keypair (becomes the registered key after rotation). */
  newKeypair: PqcKeypair;
}

/**
 * Build a `MsgRotatePQCKey` that rotates an account's ML-DSA-87 key (SAME
 * algorithm) from one derivation to another — canonically migrating a LEGACY
 * chain-bridge key (`shake256(mnemonic)`) to the canonical address-bound key
 * (`shake256("qorechain:pqc:v1|addr|mnemonic")`). Both keys dual-sign the
 * domain-separated rotation bytes.
 *
 * The returned message must be broadcast BY the account, cosigned (hybrid) with
 * the OLD key (it is still the registered key until the rotation lands).
 */
export function rotatePqcKeyMsgFromMnemonic(
  opts: RotatePqcKeyMsgFromMnemonicOptions,
): RotatePqcKeyMsgFromMnemonicResult {
  const {
    account,
    mnemonic,
    chainId,
    algorithmId = 1,
    oldDerivation = LEGACY_DERIVATION,
    newDerivation = CANONICAL_DERIVATION,
  } = opts;
  const oldKp = derivePqcByScheme(oldDerivation, account, mnemonic);
  const newKp = derivePqcByScheme(newDerivation, account, mnemonic);
  if (toHexLower(oldKp.publicKey) === toHexLower(newKp.publicKey)) {
    throw new Error(
      "old and new derivations produce the same key — rotation would be a no-op",
    );
  }
  const sb = enc.encode(
    rotationSignBytes(chainId, algorithmId, account, oldKp.publicKey, newKp.publicKey),
  );
  const msg = rotatePqcKeyMsg({
    sender: account,
    oldPublicKey: oldKp.publicKey,
    newPublicKey: newKp.publicKey,
    oldSignature: mldsa.sign(oldKp.secretKey, sb),
    newSignature: mldsa.sign(newKp.secretKey, sb),
  });
  return { msg, oldKeypair: oldKp, newKeypair: newKp };
}
