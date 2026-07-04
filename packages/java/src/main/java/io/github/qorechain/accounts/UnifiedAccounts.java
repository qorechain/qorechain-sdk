package io.github.qorechain.accounts;

import io.github.qorechain.address.Address;
import io.github.qorechain.address.Validators;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.utils.Base58;
import io.github.qorechain.utils.Bech32;
import io.github.qorechain.utils.Hashing;
import io.github.qorechain.utils.Hex;
import java.math.BigInteger;
import java.util.Arrays;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.bouncycastle.asn1.x9.X9ECParameters;

/**
 * Unified eth-native QoreChain accounts.
 *
 * <p>ONE {@code eth_secp256k1} key = ONE 20-byte identity, rendered THREE ways so a
 * wallet never "has funds on one lane but not another". The 20 bytes are the
 * Ethereum derivation {@code keccak256(uncompressedPubkey[1:])[12:]}, so the key
 * is natively spendable on the EVM lane; the native ({@code qor1…}) and SVM
 * (base58) forms are just other encodings of the SAME 20 bytes — the chain reads
 * one x/bank balance for the account, visible under all three encodings.
 *
 * <p>This is ADDITIVE. The legacy coin-118 native derivation
 * ({@link Accounts#deriveNativeAccount}) is unchanged and still supported; unified
 * accounts are a distinct, opt-in identity model built on the eth-native (coin-60)
 * key.
 *
 * <p>The deterministic ML-DSA-87 (Dilithium-5) PQC keypair is bound to
 * {@code shake256("qorechain:pqc:v1|" + cosmos + "|" + secret, 32)} — the secret
 * is the mnemonic for mnemonic-derived accounts and the hex of the 32-byte seed
 * for seed-derived accounts — so it is recoverable from the account and the same
 * secret, and portable across the QoreChain SDKs (byte-identical FIPS-204 keygen).
 */
public final class UnifiedAccounts {

    private UnifiedAccounts() {}

    /** Bech32 human-readable prefix for QoreChain account addresses. */
    private static final String HRP = "qor";

    /** Ethereum HD path prefix (coin-type 60): the 20-byte address is the keccak derivation. */
    private static final String ETH_HD_PATH_PREFIX = "m/44'/60'/0'/0/";

    /** Domain-separation context for the deterministic PQC seed. */
    private static final String PQC_SEED_CONTEXT = "qorechain:pqc:v1|";

    private static final X9ECParameters SECP256K1 = SECNamedCurves.getByName("secp256k1");
    private static final BigInteger CURVE_N = SECP256K1.getN();

    /** The three address encodings of a single 20-byte QoreChain account. */
    public static final class AddressTriple {
        /** The raw 20-byte account address. */
        public final byte[] addressBytes;
        /** Bech32 ({@code qor1…}) native encoding. */
        public final String cosmos;
        /** {@code 0x}-prefixed, EIP-55 mixed-case checksummed hex encoding. */
        public final String evm;
        /** base58 of the 32-byte SVM address ({@code addr20 ‖ 12 zero bytes}). */
        public final String svm;

        AddressTriple(byte[] addressBytes, String cosmos, String evm, String svm) {
            this.addressBytes = addressBytes;
            this.cosmos = cosmos;
            this.evm = evm;
            this.svm = svm;
        }
    }

    /**
     * A fully derived unified eth-native account: one secp256k1 key rendered as all
     * three QoreChain address encodings, plus its deterministic ML-DSA-87 PQC
     * keypair for the hybrid ante.
     *
     * <p>Secret fields ({@code mnemonic}, {@code privateKey}, {@code pqc.secretKey})
     * are returned so the caller can sign; never log them.
     */
    public static final class UnifiedAccount {
        /** The BIP-39 mnemonic this account was derived from, or {@code null} for seed-derived. */
        public final String mnemonic;
        /** 32-byte secp256k1 private key. Handle as a secret. */
        public final byte[] privateKey;
        /** 33-byte compressed secp256k1 public key. */
        public final byte[] publicKey;
        /** The raw 20-byte account address. */
        public final byte[] addressBytes;
        /** Bech32 ({@code qor1…}) native encoding. */
        public final String cosmos;
        /** {@code 0x}-prefixed, EIP-55 mixed-case checksummed hex encoding. */
        public final String evm;
        /** base58 of the 32-byte SVM address ({@code addr20 ‖ 12 zero bytes}). */
        public final String svm;
        /** The ML-DSA-87 (Dilithium-5) keypair for the hybrid signature extension. */
        public final PqcKeypair pqc;

        UnifiedAccount(
                String mnemonic,
                byte[] privateKey,
                byte[] publicKey,
                AddressTriple addrs,
                PqcKeypair pqc) {
            this.mnemonic = mnemonic;
            this.privateKey = privateKey;
            this.publicKey = publicKey;
            this.addressBytes = addrs.addressBytes;
            this.cosmos = addrs.cosmos;
            this.evm = addrs.evm;
            this.svm = addrs.svm;
            this.pqc = pqc;
        }
    }

    /**
     * Derive the three address encodings from a 20-byte account address.
     *
     * <p>The SVM form is the base58 of the 32-byte address {@code addr20 ‖ 12 zero
     * bytes} (right-padded), matching the chain's unified 32-byte SVM address
     * layout.
     *
     * @throws IllegalArgumentException if {@code addr20} is not exactly 20 bytes.
     */
    public static AddressTriple addressesFrom20(byte[] addr20) {
        if (addr20 == null || addr20.length != 20) {
            throw new IllegalArgumentException(
                    "address must be 20 bytes, got " + (addr20 == null ? "null" : addr20.length));
        }
        byte[] svmBytes = new byte[32];
        System.arraycopy(addr20, 0, svmBytes, 0, 20); // right-pad with 12 zero bytes
        String cosmos = Address.bytesToBech32(addr20, HRP);
        String evm = Validators.toChecksumAddress(Hex.encode(addr20));
        String svm = Base58.encode(svmBytes);
        return new AddressTriple(addr20.clone(), cosmos, evm, svm);
    }

    /**
     * Decode any ONE of the three encodings of a unified account into all three.
     *
     * <p>Provide exactly one of {@code cosmos} ({@code qor1…}), {@code evm}
     * ({@code 0x…}), or {@code hex} (20-byte hex, with or without {@code 0x}). The
     * SVM base58 form is not accepted as input here.
     *
     * @throws IllegalArgumentException if none is provided, or the payload is not 20 bytes.
     */
    public static AddressTriple qoreAddresses(String cosmos, String evm, String hex) {
        byte[] addr20;
        if (evm != null && !evm.isEmpty()) {
            addr20 = Hex.decode(evm);
        } else if (hex != null && !hex.isEmpty()) {
            addr20 = Hex.decode(hex);
        } else if (cosmos != null && !cosmos.isEmpty()) {
            addr20 = Bech32.decode(cosmos).data;
        } else {
            throw new IllegalArgumentException("provide one of { cosmos, evm, hex }");
        }
        return addressesFrom20(addr20);
    }

    /**
     * Derive a unified eth-native QoreChain account from a BIP-39 mnemonic.
     *
     * <p>HD path {@code m/44'/60'/0'/0/{index}} (secp256k1). The 20-byte address is
     * {@code keccak256(uncompressedPubkey[1:])[12:]}; the PQC key is
     * deterministically derived from
     * {@code shake256("qorechain:pqc:v1|" + cosmos + "|" + mnemonic, 32)}.
     *
     * @throws IllegalArgumentException if the mnemonic is invalid or {@code index} is negative.
     */
    public static UnifiedAccount deriveUnifiedAccount(String mnemonic, int index) {
        if (!Bip39.validate(mnemonic)) {
            throw new IllegalArgumentException("invalid mnemonic");
        }
        if (index < 0) {
            throw new IllegalArgumentException("index must be non-negative, got " + index);
        }
        byte[] seed = Bip39.toSeed(mnemonic);
        Hd.Secp256k1Key key = Hd.deriveSecp256k1(seed, ETH_HD_PATH_PREFIX + index);
        return build(mnemonic, key.privateKey, key.publicKey, mnemonic);
    }

    /** Convenience overload deriving at index 0. */
    public static UnifiedAccount deriveUnifiedAccount(String mnemonic) {
        return deriveUnifiedAccount(mnemonic, 0);
    }

    /**
     * Build a unified eth-native account directly from a 32-byte seed used AS the
     * secp256k1 private key (no HD derivation).
     *
     * <p>Same address derivation as {@link #deriveUnifiedAccount}; the PQC key is
     * derived from {@code shake256("qorechain:pqc:v1|" + cosmos + "|" + hex(seed32), 32)}.
     *
     * @throws IllegalArgumentException if {@code seed32} is not 32 bytes or is not a
     *     valid secp256k1 scalar.
     */
    public static UnifiedAccount unifiedAccountFromSeed(byte[] seed32) {
        if (seed32 == null || seed32.length != 32) {
            throw new IllegalArgumentException(
                    "seed must be 32 bytes, got " + (seed32 == null ? "null" : seed32.length));
        }
        BigInteger scalar = new BigInteger(1, seed32);
        if (scalar.signum() == 0 || scalar.compareTo(CURVE_N) >= 0) {
            throw new IllegalArgumentException("seed is not a valid secp256k1 private key");
        }
        byte[] compressed = SECP256K1.getG().multiply(scalar).normalize().getEncoded(true);
        // PQC secret for seed-derived accounts carries the literal "seed:" prefix
        // before the lowercase-hex private key (matches the reference adapter).
        return build(null, seed32.clone(), compressed, "seed:" + Hex.encode(seed32));
    }

    /**
     * Derive a unified eth-native account anchored to a foreign-wallet signature
     * (e.g. Phantom's "connect → 3 addresses" flow): the account is
     * {@link #unifiedAccountFromSeed}{@code (shake256(signature, 32))}.
     */
    public static UnifiedAccount unifiedAccountFromPhantomSignature(byte[] signature) {
        return unifiedAccountFromSeed(Hashing.shake256(signature, 32));
    }

    /** Build the address + PQC bundle from a 32-byte secp256k1 private key + PQC secret. */
    private static UnifiedAccount build(
            String mnemonic, byte[] privkey, byte[] compressedPubkey, String pqcSecret) {
        byte[] uncompressed = Hd.decompressPublicKey(compressedPubkey); // 65 bytes: 0x04 || X || Y
        byte[] body = Arrays.copyOfRange(uncompressed, 1, uncompressed.length); // 64 bytes
        byte[] hash = Hashing.keccak256(body);
        byte[] addr20 = Arrays.copyOfRange(hash, hash.length - 20, hash.length);
        AddressTriple addrs = addressesFrom20(addr20);
        byte[] pqcSeed =
                Hashing.shake256(PQC_SEED_CONTEXT + addrs.cosmos + "|" + pqcSecret, 32);
        PqcKeypair pqc = Pqc.generatePqcKeypair(pqcSeed);
        return new UnifiedAccount(mnemonic, privkey, compressedPubkey, addrs, pqc);
    }
}
