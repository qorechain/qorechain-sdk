/**
 * The `ecdsa_pubkey` rule of PQC key registration (chain v3.2.2).
 *
 * `MsgRegisterPQCKey` / `MsgRegisterPQCKeyV2` carry an optional classical key.
 * From v3.2.2 the chain accepts it only when it is empty, or a 33-byte
 * compressed secp256k1 key that belongs to the sender, through either address
 * derivation the chain uses:
 *
 *   - eth-native:  keccak256(uncompressed[1:])[12:]   (eth_secp256k1 accounts)
 *   - cosmos:      ripemd160(sha256(compressed))       (secp256k1 accounts)
 *
 * Anything else costs the registration fee and fails. Checking here turns that
 * into an error before broadcast.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import { bech32 } from "bech32";

/** Size of a compressed secp256k1 public key. */
export const COMPRESSED_SECP256K1_LENGTH = 33;

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/**
 * Which derivation ties `pubkey` to `sender`: `"empty"` when no key is given,
 * `"eth"` or `"cosmos"` when it belongs to the sender.
 *
 * @throws with the reason when the chain would refuse the key.
 */
export function validateClassicalKeyForSender(
  sender: string,
  pubkey: Uint8Array | undefined | null,
): "empty" | "eth" | "cosmos" {
  if (pubkey === undefined || pubkey === null || pubkey.length === 0) return "empty";
  if (!(pubkey instanceof Uint8Array)) {
    throw new Error("ecdsa_pubkey must be a Uint8Array; decode hex or base64 before building the message");
  }
  if (pubkey.length !== COMPRESSED_SECP256K1_LENGTH || (pubkey[0] !== 0x02 && pubkey[0] !== 0x03)) {
    throw new Error(
      `ecdsa_pubkey must be a ${COMPRESSED_SECP256K1_LENGTH}-byte compressed secp256k1 key, got ${pubkey.length} bytes`,
    );
  }
  let point;
  try {
    point = secp256k1.ProjectivePoint.fromHex(pubkey);
  } catch {
    throw new Error("ecdsa_pubkey is not a point on secp256k1");
  }
  let account: Uint8Array;
  try {
    account = Uint8Array.from(bech32.fromWords(bech32.decode(sender).words));
  } catch {
    throw new Error(`sender ${JSON.stringify(sender)} is not a bech32 address`);
  }
  const eth = keccak_256(point.toRawBytes(false).subarray(1)).subarray(12);
  if (equal(eth, account)) return "eth";
  if (equal(ripemd160(sha256(pubkey)), account)) return "cosmos";
  throw new Error(`ecdsa_pubkey does not belong to ${sender} under either address derivation`);
}
