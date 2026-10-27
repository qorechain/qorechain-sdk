package io.github.qorechain.pqc;

import io.github.qorechain.utils.Hex;
import java.nio.charset.StandardCharsets;

/**
 * PQC key registration integrity (chain v3.2.3).
 *
 * <p>From v3.2.3 the chain refuses a registration that protects nothing, and
 * accepts proof that the registrant holds the key's secret:
 *
 * <ul>
 *   <li>{@code key_type "classical_only"} registers no post-quantum key, and the
 *       account could then never sign a transaction again;
 *   <li>an empty public key;
 *   <li>a degenerate ML-DSA-87 key, whose {@code t1} part (every byte after the
 *       32-byte {@code rho}) is zero: anyone can forge signatures for it;
 *   <li>{@code proof_of_possession} (optional now, to become mandatory): the
 *       key's own ML-DSA signature over
 *       {@code "qorechain-pqc-pop-v1|<chain-id>|<algorithm>|<account>|<hex(public key)>"},
 *       lower-case hex, deterministic, empty context.
 * </ul>
 *
 * <p>Also from v3.2.3 an account that already has a key must send register /
 * migrate with the hybrid signature ({@link PqcDx#migratePqcKeyHybrid}), a
 * rotation or migration to a key the account used before is refused, and none
 * of the key-management messages may travel inside authz {@code MsgExec}.
 *
 * <p>{@code proof_of_possession} is a new field: a node below v3.2.3 refuses the
 * whole transaction when it is set. Set it only once the network has applied
 * v3.2.3 ({@code ChainUpgrades.isApplied(rest, ChainUpgrades.V3_2_3, ...)}).
 */
public final class KeyIntegrity {
    private KeyIntegrity() {}

    /** The key type the chain refuses from v3.2.3. */
    public static final String KEY_TYPE_CLASSICAL_ONLY = "classical_only";

    /** Domain of the proof-of-possession sign-bytes. */
    public static final String PROOF_OF_POSSESSION_DOMAIN = "qorechain-pqc-pop-v1";

    private static final int RHO_LENGTH = 32;

    /**
     * Whether {@code publicKey} is an ML-DSA-87 key nobody needs a secret for:
     * right length, every byte after {@code rho} zero. Keys of another length
     * are not judged.
     */
    public static boolean isDegeneratePublicKey(byte[] publicKey) {
        if (publicKey == null || publicKey.length != Pqc.ML_DSA_87_PUBLIC_KEY_LENGTH) {
            return false;
        }
        for (int i = RHO_LENGTH; i < publicKey.length; i++) {
            if (publicKey[i] != 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * Refuse a registration the chain refuses from v3.2.3. Not network-gated:
     * such a registration protects nothing, or locks the account, on any network.
     *
     * @throws IllegalArgumentException naming the reason
     */
    public static void validateRegisteredKey(String keyType, byte[] publicKey) {
        if (KEY_TYPE_CLASSICAL_ONLY.equals(keyType)) {
            throw new IllegalArgumentException(
                    "key_type \"classical_only\" registers no post-quantum key; the account would be"
                            + " unable to sign any transaction afterwards");
        }
        if (publicKey == null || publicKey.length == 0) {
            throw new IllegalArgumentException("a post-quantum public key is required");
        }
        if (isDegeneratePublicKey(publicKey)) {
            throw new IllegalArgumentException(
                    "the key's t1 part is all zero, so anyone can forge its signatures");
        }
    }

    /**
     * The bytes the key being registered signs to prove its owner holds the
     * secret. They name the chain, the algorithm, the account and the key.
     */
    public static byte[] proofOfPossessionSignBytes(
            String chainId, int algorithmId, String account, byte[] publicKey) {
        if (chainId == null || chainId.isEmpty() || account == null || account.isEmpty()) {
            throw new IllegalArgumentException("proof of possession: chain id and account are required");
        }
        return (PROOF_OF_POSSESSION_DOMAIN + "|" + chainId + "|" + algorithmId + "|" + account + "|"
                        + Hex.encode(publicKey).toLowerCase(java.util.Locale.ROOT))
                .getBytes(StandardCharsets.UTF_8);
    }

    /**
     * Sign the proof of possession with the key being registered (deterministic
     * ML-DSA-87). Set it as {@code PqcDx.EnsureOptions.proofOfPossession} - only
     * on a network that has applied v3.2.3.
     */
    public static byte[] signProofOfPossession(String chainId, String account, PqcKeypair keypair) {
        return Pqc.pqcSign(
                keypair.secretKey,
                proofOfPossessionSignBytes(
                        chainId, PqcAlgorithm.ALGORITHM_DILITHIUM5, account, keypair.publicKey));
    }

    /** Verify a proof of possession locally, as the chain will. */
    public static boolean verifyProofOfPossession(
            String chainId, String account, byte[] publicKey, byte[] proof) {
        try {
            return Pqc.pqcVerify(
                    publicKey,
                    proofOfPossessionSignBytes(chainId, PqcAlgorithm.ALGORITHM_DILITHIUM5, account, publicKey),
                    proof);
        } catch (RuntimeException e) {
            return false;
        }
    }
}
