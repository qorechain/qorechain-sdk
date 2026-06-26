package io.github.qorechain.accounts;

import io.github.qorechain.address.Address;
import io.github.qorechain.address.Validators;
import io.github.qorechain.utils.Base58;
import io.github.qorechain.utils.Hashing;
import java.util.Arrays;

/**
 * Mnemonic generation/validation and HD derivation of QoreChain accounts in all
 * three supported schemes:
 *
 * <ol>
 *   <li>native — secp256k1, BIP-44 {@code m/44'/118'/0'/0/{index}},
 *       address = bech32({@code qor}, ripemd160(sha256(compressedPubkey))).
 *   <li>evm — secp256k1, BIP-44 {@code m/44'/60'/0'/0/{index}},
 *       address = {@code 0x} + last 20 bytes of keccak256(uncompressedPubkey[1:]),
 *       EIP-55 checksummed.
 *   <li>svm — ed25519, SLIP-0010 {@code m/44'/501'/{index}'/0'} (all hardened),
 *       address = base58(32-byte ed25519 public key).
 * </ol>
 *
 * <p>Every derive function validates the mnemonic first (via {@link Bip39}) and
 * throws on an invalid phrase — the guard against a typo'd phrase silently
 * deriving a wrong account.
 */
public final class Accounts {

    private Accounts() {}

    private static final String NATIVE_PREFIX = "qor";
    private static final int COIN_TYPE_NATIVE = 118;
    private static final int COIN_TYPE_EVM = 60;
    private static final int COIN_TYPE_SVM = 501;

    /** Generate a fresh 12-word mnemonic (128 bits of entropy). */
    public static String generateMnemonic() {
        return Bip39.generate(128);
    }

    /** Generate a fresh mnemonic with the given entropy strength (128 or 256 bits). */
    public static String generateMnemonic(int strengthBits) {
        return Bip39.generate(strengthBits);
    }

    /** Validate a mnemonic against the English wordlist and its checksum. Never throws. */
    public static boolean validateMnemonic(String mnemonic) {
        return Bip39.validate(mnemonic);
    }

    private static void checkIndex(int index) {
        if (index < 0) {
            throw new IllegalArgumentException("accountIndex must be non-negative, got " + index);
        }
    }

    /**
     * Derive a native QoreChain account (Cosmos-style secp256k1) from a mnemonic.
     * Path {@code m/44'/118'/0'/0/{index}}.
     */
    public static Account deriveNativeAccount(String mnemonic, int index) {
        checkIndex(index);
        byte[] seed = Bip39.toSeed(mnemonic);
        Hd.Secp256k1Key key =
                Hd.deriveSecp256k1(seed, "m/44'/" + COIN_TYPE_NATIVE + "'/0'/0/" + index);
        byte[] digest = Hashing.ripemd160(Hashing.sha256(key.publicKey)); // 20 bytes
        String address = Address.bytesToBech32(digest, NATIVE_PREFIX);
        return Account.secp256k1(Account.Type.NATIVE, address, key.publicKey, key.privateKey);
    }

    /**
     * Derive an EVM account from a mnemonic. Path {@code m/44'/60'/0'/0/{index}}.
     */
    public static Account deriveEvmAccount(String mnemonic, int index) {
        checkIndex(index);
        byte[] seed = Bip39.toSeed(mnemonic);
        Hd.Secp256k1Key key = Hd.deriveSecp256k1(seed, "m/44'/" + COIN_TYPE_EVM + "'/0'/0/" + index);
        byte[] uncompressed = Hd.decompressPublicKey(key.publicKey); // 65 bytes (0x04 || X || Y)
        byte[] body = Arrays.copyOfRange(uncompressed, 1, uncompressed.length); // 64 bytes
        byte[] hash = Hashing.keccak256(body);
        byte[] addressBytes = Arrays.copyOfRange(hash, hash.length - 20, hash.length);
        String address =
                Validators.toChecksumAddress(io.github.qorechain.utils.Hex.encode(addressBytes));
        return Account.secp256k1(Account.Type.EVM, address, key.publicKey, key.privateKey);
    }

    /**
     * Derive an SVM (Solana-style ed25519) account from a mnemonic. Path
     * {@code m/44'/501'/{index}'/0'} (all hardened). The secret key is the 64-byte
     * Solana format (32-byte seed || 32-byte public key).
     */
    public static Account deriveSvmAccount(String mnemonic, int index) {
        checkIndex(index);
        byte[] seed = Bip39.toSeed(mnemonic);
        Hd.Ed25519Key key = Hd.deriveEd25519(seed, "m/44'/" + COIN_TYPE_SVM + "'/" + index + "'/0'");
        byte[] secretKey = new byte[64];
        System.arraycopy(key.privateKey, 0, secretKey, 0, 32);
        System.arraycopy(key.publicKey, 0, secretKey, 32, 32);
        String address = Base58.encode(key.publicKey);
        return Account.ed25519(address, key.publicKey, secretKey);
    }
}
