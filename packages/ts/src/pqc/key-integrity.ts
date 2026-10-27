/**
 * PQC key registration integrity (chain v3.2.3).
 *
 * From v3.2.3 the chain refuses a registration that protects nothing, and
 * accepts proof that the registrant holds the key's secret:
 *
 *   - `key_type: "classical_only"` registers no post-quantum key, and the
 *     account could then never sign a transaction again;
 *   - an empty public key;
 *   - a degenerate ML-DSA-87 key, whose `t1` part (every byte after the 32-byte
 *     `rho`) is zero: anyone can forge signatures for it;
 *   - `proof_of_possession` (optional now, to become mandatory): the key's own
 *     ML-DSA signature over
 *     `"qorechain-pqc-pop-v1|<chain-id>|<algorithm>|<account>|<hex(public key)>"`,
 *     lower-case hex, deterministic, empty context - like every SDK signature.
 *
 * Also from v3.2.3: an account that already has a key must send
 * `MsgRegisterPQCKeyV2` / `MsgMigratePQCKey` with the hybrid signature (only
 * the repair of a record holding no usable key may go classically), a rotation
 * or migration to a key the account used before is refused, and none of the
 * key-management messages may travel inside authz `MsgExec`.
 *
 * `proof_of_possession` is a new field: a node below v3.2.3 refuses the whole
 * transaction when it is set. Attach it only once the network has applied
 * v3.2.3 ({@link ../tx/upgrades.isUpgradeApplied} with
 * {@link ../tx/upgrades.CHAIN_UPGRADE_V3_2_3}).
 */

import { mldsa } from "@qorechain/pqc";

/** Size of an ML-DSA-87 public key. */
export const ML_DSA_87_PUBLIC_KEY_LENGTH = 2592;
/** `rho`, the seed of the public matrix, opens every ML-DSA public key. */
const RHO_LENGTH = 32;
/** The key type the chain refuses from v3.2.3. */
export const KEY_TYPE_CLASSICAL_ONLY = "classical_only";
/** Domain of the proof-of-possession sign-bytes. */
export const PROOF_OF_POSSESSION_DOMAIN = "qorechain-pqc-pop-v1";

const enc = new TextEncoder();

function hexLower(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/**
 * True for an ML-DSA-87 public key nobody needs a secret for: right length,
 * every byte after `rho` zero. Keys of another length are not judged.
 */
export function isDegeneratePqcPublicKey(publicKey: Uint8Array): boolean {
  if (publicKey.length !== ML_DSA_87_PUBLIC_KEY_LENGTH) return false;
  for (let i = RHO_LENGTH; i < publicKey.length; i++) if (publicKey[i] !== 0) return false;
  return true;
}

/**
 * Refuse a registration the chain refuses from v3.2.3. Not network-gated: such
 * a registration protects nothing, or locks the account, on any network.
 *
 * @throws naming the reason.
 */
export function validateRegisteredPqcKey(keyType: string | undefined, publicKey: Uint8Array): void {
  if (keyType === KEY_TYPE_CLASSICAL_ONLY) {
    throw new Error(
      'key_type "classical_only" registers no post-quantum key; the account would be unable to sign any transaction afterwards',
    );
  }
  if (!(publicKey instanceof Uint8Array) || publicKey.length === 0) {
    throw new Error("a post-quantum public key is required");
  }
  if (isDegeneratePqcPublicKey(publicKey)) {
    throw new Error("the key's t1 part is all zero, so anyone can forge its signatures");
  }
}

/** Inputs for {@link proofOfPossessionSignBytes}. */
export interface ProofOfPossessionInput {
  /** The chain id, e.g. `qorechain-vladi`. */
  chainId: string;
  /** The account registering the key (`qor1…`, as it appears in the message's `sender`). */
  account: string;
  /** The public key being registered. */
  publicKey: Uint8Array;
  /** The algorithm id; 1 = ML-DSA-87 (Dilithium-5). */
  algorithmId?: number;
}

/**
 * The bytes the key being registered signs to prove its owner holds the
 * secret. They name the chain, the algorithm, the account and the key, so a
 * proof made for one account or chain proves nothing for another.
 */
export function proofOfPossessionSignBytes(input: ProofOfPossessionInput): Uint8Array {
  if (!input.chainId) throw new Error("chainId is required");
  if (!input.account) throw new Error("account is required");
  const algorithmId = input.algorithmId ?? 1;
  return enc.encode(
    `${PROOF_OF_POSSESSION_DOMAIN}|${input.chainId}|${algorithmId}|${input.account}|${hexLower(input.publicKey)}`,
  );
}

/**
 * Sign the proof of possession with the key being registered (deterministic
 * ML-DSA-87, empty context). Pass the result as `proofOfPossession` to the
 * registration builder - only on a network that has applied v3.2.3.
 */
export function signProofOfPossession(
  input: Omit<ProofOfPossessionInput, "publicKey"> & {
    keypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  },
): Uint8Array {
  const { keypair, ...rest } = input;
  return mldsa.sign(keypair.secretKey, proofOfPossessionSignBytes({ ...rest, publicKey: keypair.publicKey }));
}

/** Verify a proof of possession locally, as the chain will. */
export function verifyProofOfPossession(input: ProofOfPossessionInput & { proof: Uint8Array }): boolean {
  try {
    return mldsa.verify(input.publicKey, proofOfPossessionSignBytes(input), input.proof);
  } catch {
    return false;
  }
}
