package io.github.qorechain.pqc;

/** An ML-DSA-87 (Dilithium-5) keypair. Treat {@code secretKey} as a secret. */
public final class PqcKeypair {
    /** 2592-byte ML-DSA-87 public key. */
    public final byte[] publicKey;
    /** 4896-byte ML-DSA-87 secret key. Handle as a secret; never log. */
    public final byte[] secretKey;

    public PqcKeypair(byte[] publicKey, byte[] secretKey) {
        this.publicKey = publicKey;
        this.secretKey = secretKey;
    }
}
