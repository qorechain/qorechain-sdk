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
 * (base58) forms are just other encodings of the SAME 20 bytes - the chain reads
 * one x/bank balance for the account, visible under all three encodings.
 *
 * <p>This is ADDITIVE. The legacy coin-118 native derivation
 * ({@link Accounts#deriveNativeAccount}) is unchanged and still supported; unified
 * accounts are a distinct, opt-in identity model built on the eth-native (coin-60)
 * key.
 *
 * <p>The deterministic ML-DSA-87 (Dilithium-5) PQC keypair of a mnemonic-derived
 * account is bound to {@code shake256("qorechain:pqc:v1|" + cosmos + "|" + mnemonic, 32)},
 * so it is recoverable from the account and the same mnemonic, and portable across
 * the QoreChain SDKs (byte-identical FIPS-204 keygen). A seed-derived account takes
 * its PQC key from a second, independent secret (a recovery code or 32 secret
 * bytes, see {@link SeedPqcOptions} and {@link PqcRecovery}), because the seed is
 * the classical private key.
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
     * Where the PQC key of a seed-derived account comes from (see
     * {@link #unifiedAccountFromSeed(byte[], SeedPqcOptions)}).
     *
     * <p>Set exactly one of {@link #recoveryCode}, {@link #pqcSecret} or
     * {@link #legacySeedDerivation}. The seed is the secp256k1 private key, so the
     * PQC key needs a second, independent secret: a {@code QRC1-...} recovery code
     * (see {@link PqcRecovery#generatePqcRecoveryCode}) or 32 raw bytes of separate
     * secret entropy.
     *
     * <pre>{@code
     * UnifiedAccounts.unifiedAccountFromSeed(seed32, SeedPqcOptions.withRecoveryCode(code));
     * UnifiedAccounts.unifiedAccountFromSeed(seed32, new SeedPqcOptions().pqcSecret(secret32));
     * }</pre>
     */
    public static final class SeedPqcOptions {
        private String recoveryCode;
        private byte[] pqcSecret;
        private boolean legacySeedDerivation;

        /** An empty options object; set exactly one source before use. */
        public SeedPqcOptions() {}

        /** Derive the PQC key from a {@code QRC1-...} recovery code. */
        public SeedPqcOptions recoveryCode(String code) {
            this.recoveryCode = code;
            return this;
        }

        /**
         * Derive the PQC key from 32 raw bytes of independent secret entropy (the
         * same key the recovery code for those bytes gives). The array is copied;
         * the caller keeps ownership of it.
         */
        public SeedPqcOptions pqcSecret(byte[] secret32) {
            this.pqcSecret = secret32 == null ? null : secret32.clone();
            return this;
        }

        /**
         * Keep the pre-0.13.0 derivation, where the PQC key is computed from the seed
         * itself. Use this only to recover the PQC key of an account created before
         * 0.13.0, so you can rotate it (MsgRotatePQCKey) to a key from a recovery
         * code; never for new accounts.
         */
        public SeedPqcOptions legacySeedDerivation(boolean legacy) {
            this.legacySeedDerivation = legacy;
            return this;
        }

        /** Shorthand for {@code new SeedPqcOptions().recoveryCode(code)}. */
        public static SeedPqcOptions withRecoveryCode(String code) {
            return new SeedPqcOptions().recoveryCode(code);
        }

        /** Shorthand for {@code new SeedPqcOptions().pqcSecret(secret32)}. */
        public static SeedPqcOptions withPqcSecret(byte[] secret32) {
            return new SeedPqcOptions().pqcSecret(secret32);
        }

        /** Shorthand for {@code new SeedPqcOptions().legacySeedDerivation(true)}. */
        public static SeedPqcOptions legacy() {
            return new SeedPqcOptions().legacySeedDerivation(true);
        }
    }

    /** The error for a seed-path call that does not say where the PQC key comes from. */
    private static final String SEED_PQC_CHOICES =
            " Pass exactly one of: recoveryCode (a QRC1 recovery code, see"
                    + " PqcRecovery.generatePqcRecoveryCode), pqcSecret (32 bytes of independent"
                    + " secret entropy), or legacySeedDerivation(true) (only to recover the PQC key"
                    + " of an account created before 0.13.0, so you can rotate it with"
                    + " MsgRotatePQCKey; never for new accounts).";

    /**
     * Build a unified eth-native account directly from a 32-byte seed used AS the
     * secp256k1 private key (no HD derivation).
     *
     * <p>Same address derivation as {@link #deriveUnifiedAccount}. The seed is the
     * classical private key, so the PQC key needs a second, independent secret,
     * chosen with {@code opts} (exactly one):
     *
     * <ul>
     *   <li>{@code recoveryCode}: a {@code QRC1-...} recovery code; the PQC key is
     *       {@link PqcRecovery#pqcKeyFromRecoveryCode}{@code (code, cosmos)}.
     *   <li>{@code pqcSecret}: 32 raw bytes; the PQC key is the one the recovery
     *       code for those bytes gives (same derivation).
     *   <li>{@code legacySeedDerivation}: the pre-0.13.0 derivation
     *       {@code shake256("qorechain:pqc:v1|" + cosmos + "|seed:" + hex(seed32), 32)}.
     *       Only to recover the PQC key of an account created before 0.13.0, so you
     *       can rotate it (MsgRotatePQCKey) to a key from a recovery code; never for
     *       new accounts.
     * </ul>
     *
     * <p><b>SAFETY - the seed IS the private key.</b> {@code seed32} MUST be real
     * secret entropy: a CSPRNG draw, or a seed derived from a secret only the owner
     * holds. It must NEVER be a wallet signature, a hash of one, or any other value a
     * third party can ask a wallet, a server, or the user's browser to produce -
     * anyone who can obtain that value reconstructs this account and can spend from
     * it. To let an external wallet key act for an account, register it with
     * {@code MsgRegisterAuthenticator} and spend via {@code MsgExecuteCosmos} /
     * {@code MsgExecuteEVM} instead of turning it into a seed.
     *
     * @throws IllegalArgumentException if {@code seed32} is not 32 bytes or is not a
     *     valid secp256k1 scalar, if {@code opts} sets no PQC source or more than
     *     one, if the recovery code or {@code pqcSecret} is malformed, or if the PQC
     *     secret is byte-identical to {@code seed32}.
     */
    public static UnifiedAccount unifiedAccountFromSeed(byte[] seed32, SeedPqcOptions opts) {
        if (seed32 == null || seed32.length != 32) {
            throw new IllegalArgumentException(
                    "seed must be 32 bytes, got " + (seed32 == null ? "null" : seed32.length));
        }
        int chosen = 0;
        if (opts != null) {
            chosen += opts.recoveryCode != null ? 1 : 0;
            chosen += opts.pqcSecret != null ? 1 : 0;
            chosen += opts.legacySeedDerivation ? 1 : 0;
        }
        if (chosen == 0) {
            throw new IllegalArgumentException(
                    "unifiedAccountFromSeed needs a second secret for the PQC key, because the"
                            + " seed is the classical private key." + SEED_PQC_CHOICES);
        }
        if (chosen > 1) {
            throw new IllegalArgumentException(
                    "unifiedAccountFromSeed: more than one PQC key source was given." + SEED_PQC_CHOICES);
        }
        BigInteger scalar = new BigInteger(1, seed32);
        if (scalar.signum() == 0 || scalar.compareTo(CURVE_N) >= 0) {
            throw new IllegalArgumentException("seed is not a valid secp256k1 private key");
        }
        byte[] compressed = SECP256K1.getG().multiply(scalar).normalize().getEncoded(true);
        AddressTriple addrs = addressesFor(compressed);
        PqcKeypair pqc;
        if (opts.legacySeedDerivation) {
            // Pre-0.13.0: the PQC secret is the literal "seed:" prefix before the
            // lowercase-hex private key (matches the reference adapter).
            pqc = legacyPqc(addrs.cosmos, "seed:" + Hex.encode(seed32));
        } else {
            byte[] secret =
                    opts.recoveryCode != null
                            ? PqcRecovery.decodeRecoveryCode(opts.recoveryCode)
                            : opts.pqcSecret.clone();
            try {
                PqcRecovery.requireSecret(secret, "pqcSecret");
                if (java.security.MessageDigest.isEqual(secret, seed32)) {
                    throw new IllegalArgumentException(
                            "unifiedAccountFromSeed: the PQC secret must not be the seed itself;"
                                    + " that would make the PQC key derivable from the classical"
                                    + " private key. Use an independent secret, such as a new"
                                    + " recovery code from PqcRecovery.generatePqcRecoveryCode.");
                }
                pqc = PqcRecovery.keyFromSecret(secret, addrs.cosmos);
            } finally {
                Arrays.fill(secret, (byte) 0);
            }
        }
        return new UnifiedAccount(null, seed32.clone(), compressed, addrs, pqc);
    }

    /**
     * REMOVED in v0.8.0 - always throws {@link UnsupportedOperationException}.
     *
     * <p>This derived the account's spend key from a wallet signature. A wallet
     * signature is a bearer secret: any page can ask the wallet for it, so whoever
     * obtains it controls the account. There is no safe way to keep the behaviour,
     * so the call now fails loudly instead of silently producing an exposed account.
     *
     * <p>Use the authenticator lanes instead: register the external key with
     * {@code MsgRegisterAuthenticator} and spend via {@code MsgExecuteCosmos} /
     * {@code MsgExecuteEVM} (see {@link io.github.qorechain.tx.Authenticator}). The
     * external key authorizes actions under on-chain, revocable terms; it never
     * becomes the account's spend key.
     *
     * @param signature ignored.
     * @throws UnsupportedOperationException always.
     */
    public static UnifiedAccount unifiedAccountFromPhantomSignature(byte[] signature) {
        throw new UnsupportedOperationException(REMOVED_SIGNATURE_DERIVATION);
    }

    /** The removal notice thrown by {@link #unifiedAccountFromPhantomSignature}. */
    private static final String REMOVED_SIGNATURE_DERIVATION =
            "unifiedAccountFromPhantomSignature was removed in v0.8.0: deriving a spend key"
                    + " from a wallet signature is unsafe - the signature is a bearer secret"
                    + " that any page can request from the wallet, so whoever obtains it"
                    + " controls the account. Use the authenticator lanes instead: register"
                    + " the external key with MsgRegisterAuthenticator and spend via"
                    + " MsgExecuteCosmos / MsgExecuteEVM. Any account previously derived this"
                    + " way must be treated as exposed - move its funds.";

    /** Build the address + PQC bundle from a 32-byte secp256k1 private key + PQC secret. */
    private static UnifiedAccount build(
            String mnemonic, byte[] privkey, byte[] compressedPubkey, String pqcSecret) {
        AddressTriple addrs = addressesFor(compressedPubkey);
        PqcKeypair pqc = legacyPqc(addrs.cosmos, pqcSecret);
        return new UnifiedAccount(mnemonic, privkey, compressedPubkey, addrs, pqc);
    }

    /** The three address encodings of a compressed secp256k1 public key (keccak derivation). */
    private static AddressTriple addressesFor(byte[] compressedPubkey) {
        byte[] uncompressed = Hd.decompressPublicKey(compressedPubkey); // 65 bytes: 0x04 || X || Y
        byte[] body = Arrays.copyOfRange(uncompressed, 1, uncompressed.length); // 64 bytes
        byte[] hash = Hashing.keccak256(body);
        byte[] addr20 = Arrays.copyOfRange(hash, hash.length - 20, hash.length);
        return addressesFrom20(addr20);
    }

    /** {@code ML-DSA-87 keygen(shake256("qorechain:pqc:v1|" + cosmos + "|" + secret, 32))}. */
    private static PqcKeypair legacyPqc(String cosmos, String pqcSecret) {
        byte[] pqcSeed = Hashing.shake256(PQC_SEED_CONTEXT + cosmos + "|" + pqcSecret, 32);
        try {
            return Pqc.generatePqcKeypair(pqcSeed);
        } finally {
            Arrays.fill(pqcSeed, (byte) 0);
        }
    }
}
