package io.github.qorechain.pqc;

/**
 * PQC algorithm identifiers, mirroring the chain's cryptographic-agility
 * framework. These numeric IDs are the on-the-wire values the chain expects in
 * {@code MsgRegisterPQCKeyV2.algorithm_id} and the {@code PQCHybridSignature}
 * TX extension, so they MUST stay in sync with the core enum.
 */
public final class PqcAlgorithm {

    private PqcAlgorithm() {}

    /** Unset / invalid algorithm. */
    public static final int ALGORITHM_UNSPECIFIED = 0;
    /** Dilithium-5 = ML-DSA-87, NIST FIPS 204 signatures. */
    public static final int ALGORITHM_DILITHIUM5 = 1;
    /** ML-KEM-1024, NIST FIPS 203 key encapsulation. */
    public static final int ALGORITHM_MLKEM1024 = 2;

    /** Human-readable name for an algorithm ID. */
    public static String algorithmName(int id) {
        switch (id) {
            case ALGORITHM_UNSPECIFIED:
                return "unspecified";
            case ALGORITHM_DILITHIUM5:
                return "dilithium5";
            case ALGORITHM_MLKEM1024:
                return "mlkem1024";
            default:
                return "algorithm_" + id;
        }
    }

    /** True if the algorithm is a digital-signature scheme. */
    public static boolean isSignatureAlgorithm(int id) {
        return id == ALGORITHM_DILITHIUM5;
    }
}
