package io.github.qorechain.accounts;

/**
 * A derived QoreChain account: its on-chain address, public key, and secret
 * material. Treat {@code privateKey} / {@code secretKey} as secrets — never log
 * them.
 *
 * <p>For {@code native} and {@code evm} accounts the key scheme is secp256k1
 * ({@code privateKey} = 32-byte scalar, {@code publicKey} = 33-byte compressed).
 * For {@code svm} the scheme is ed25519 ({@code publicKey} = 32 bytes,
 * {@code secretKey} = 64 bytes: 32-byte seed || 32-byte public key).
 */
public final class Account {

    /** Account scheme. */
    public enum Type {
        NATIVE,
        EVM,
        SVM
    }

    public final Type type;
    public final String address;
    public final byte[] publicKey;
    /** secp256k1 private scalar (native/evm). Null for svm. */
    public final byte[] privateKey;
    /** ed25519 64-byte secret key (svm). Null for native/evm. */
    public final byte[] secretKey;

    private Account(Type type, String address, byte[] publicKey, byte[] privateKey, byte[] secretKey) {
        this.type = type;
        this.address = address;
        this.publicKey = publicKey;
        this.privateKey = privateKey;
        this.secretKey = secretKey;
    }

    static Account secp256k1(Type type, String address, byte[] publicKey, byte[] privateKey) {
        return new Account(type, address, publicKey, privateKey, null);
    }

    static Account ed25519(String address, byte[] publicKey, byte[] secretKey) {
        return new Account(Type.SVM, address, publicKey, null, secretKey);
    }
}
