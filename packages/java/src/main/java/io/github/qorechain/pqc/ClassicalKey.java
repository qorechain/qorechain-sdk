package io.github.qorechain.pqc;

import io.github.qorechain.utils.Bech32;
import io.github.qorechain.utils.Hashing;
import java.security.MessageDigest;
import java.util.Arrays;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.bouncycastle.math.ec.ECPoint;

/**
 * The {@code ecdsa_pubkey} rule of PQC key registration (chain v3.2.2).
 *
 * <p>{@code MsgRegisterPQCKey} / {@code MsgRegisterPQCKeyV2} carry an optional
 * classical key. From v3.2.2 the chain accepts it only when it is empty, or a
 * 33-byte compressed secp256k1 key that belongs to the sender, through either
 * address derivation the chain uses:
 *
 * <ul>
 *   <li>eth-native: {@code keccak256(uncompressed[1..])[12..]} ({@code eth_secp256k1} accounts)
 *   <li>cosmos: {@code ripemd160(sha256(compressed))} ({@code secp256k1} accounts)
 * </ul>
 *
 * <p>Anything else costs the registration fee and fails. Checking here turns
 * that into an error before broadcast.
 */
public final class ClassicalKey {
    private ClassicalKey() {}

    /** Size of a compressed secp256k1 public key. */
    public static final int COMPRESSED_SECP256K1_LENGTH = 33;

    /** How a registration's {@code ecdsa_pubkey} relates to its sender. */
    public enum Match {
        /** No classical key is given, which the chain accepts. */
        EMPTY,
        /** {@code keccak256(uncompressed[1..])[12..]} is the sender. */
        ETH,
        /** {@code ripemd160(sha256(compressed))} is the sender. */
        COSMOS
    }

    /**
     * Which derivation ties {@code pubkey} to {@code sender}.
     *
     * @throws IllegalArgumentException with the reason the chain would refuse the key
     */
    public static Match validateForSender(String sender, byte[] pubkey) {
        if (pubkey == null || pubkey.length == 0) {
            return Match.EMPTY;
        }
        if (pubkey.length != COMPRESSED_SECP256K1_LENGTH || (pubkey[0] != 0x02 && pubkey[0] != 0x03)) {
            throw new IllegalArgumentException(
                    "ecdsa_pubkey must be a " + COMPRESSED_SECP256K1_LENGTH
                            + "-byte compressed secp256k1 key, got " + pubkey.length + " bytes");
        }
        byte[] uncompressed;
        try {
            ECPoint point = SECNamedCurves.getByName("secp256k1").getCurve().decodePoint(pubkey);
            uncompressed = point.getEncoded(false);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("ecdsa_pubkey is not a point on secp256k1");
        }
        byte[] account;
        try {
            account = Bech32.decode(sender).data;
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("sender \"" + sender + "\" is not a bech32 address");
        }
        byte[] eth = Hashing.keccak256(Arrays.copyOfRange(uncompressed, 1, uncompressed.length));
        if (MessageDigest.isEqual(Arrays.copyOfRange(eth, 12, 32), account)) {
            return Match.ETH;
        }
        if (MessageDigest.isEqual(Hashing.ripemd160(Hashing.sha256(pubkey)), account)) {
            return Match.COSMOS;
        }
        throw new IllegalArgumentException(
                "ecdsa_pubkey does not belong to " + sender + " under either address derivation");
    }
}
