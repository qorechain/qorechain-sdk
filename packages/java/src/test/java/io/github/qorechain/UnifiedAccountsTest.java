package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.accounts.UnifiedAccounts;
import io.github.qorechain.accounts.UnifiedAccounts.AddressTriple;
import io.github.qorechain.accounts.UnifiedAccounts.UnifiedAccount;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.utils.Hashing;
import io.github.qorechain.utils.Hex;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

/**
 * Known-answer tests for unified eth-native accounts, cross-checked against the
 * {@code @qorechain/wallet-adapter} reference (v0.1.5). ONE 20-byte identity is
 * rendered as cosmos/evm/svm, and the deterministic ML-DSA-87 PQC key is portable
 * across the QoreChain SDKs.
 */
class UnifiedAccountsTest {

    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";

    @Test
    void mnemonicIndex0MatchesReference() {
        UnifiedAccount a = UnifiedAccounts.deriveUnifiedAccount(MNEMONIC, 0);
        assertEquals("qor17w0adeg64ky0daxwd2ugyuneellmjgnxhkv37z", a.cosmos);
        assertEquals("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", a.evm);
        assertEquals("HQ1S8pxTw4YN41GPdWYPQVfweQveXAUtfFnZNmvPfrYf", a.svm);
        assertEquals(MNEMONIC, a.mnemonic);
        assertEquals(33, a.publicKey.length);
        assertEquals(20, a.addressBytes.length);

        // Deterministic ML-DSA-87 keypair (FIPS-204), portable across SDKs.
        assertEquals(Pqc.ML_DSA_87_PUBLIC_KEY_LENGTH, a.pqc.publicKey.length);
        assertEquals(Pqc.ML_DSA_87_SECRET_KEY_LENGTH, a.pqc.secretKey.length);
        assertEquals("4a685622f2a99d54", Hex.encode(Arrays.copyOf(a.pqc.publicKey, 8)));
    }

    @Test
    void seed0x01MatchesReference() {
        byte[] seed = new byte[32];
        Arrays.fill(seed, (byte) 1);
        UnifiedAccount a = UnifiedAccounts.unifiedAccountFromSeed(seed);
        assertEquals("qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj", a.cosmos);
        assertEquals("0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", a.evm);
        assertEquals("2n2Cnc7fib6rm4Azo1mbvMuHB3iCb1J254kEQDcrHyPu", a.svm);
        assertEquals(null, a.mnemonic);
        // The seed IS the private key.
        assertArrayEquals(seed, a.privateKey);
        // PQC seed carries the literal "seed:" prefix before hex(privkey).
        assertEquals("2d7f888fecbe5b24", Hex.encode(Arrays.copyOf(a.pqc.publicKey, 8)));
    }

    @Test
    void addressesFrom20AndQoreAddressesAgree() {
        UnifiedAccount a = UnifiedAccounts.deriveUnifiedAccount(MNEMONIC, 0);
        AddressTriple fromBytes = UnifiedAccounts.addressesFrom20(a.addressBytes);
        assertEquals(a.cosmos, fromBytes.cosmos);
        assertEquals(a.evm, fromBytes.evm);
        assertEquals(a.svm, fromBytes.svm);

        // qoreAddresses round-trips from any of the three inputs.
        assertEquals(a.cosmos, UnifiedAccounts.qoreAddresses(null, a.evm, null).cosmos);
        assertEquals(a.evm, UnifiedAccounts.qoreAddresses(a.cosmos, null, null).evm);
        assertEquals(a.svm, UnifiedAccounts.qoreAddresses(null, null, Hex.encode(a.addressBytes)).svm);
    }

    @Test
    void svmIsAddr20RightPaddedTo32() {
        UnifiedAccount a = UnifiedAccounts.deriveUnifiedAccount(MNEMONIC, 0);
        byte[] svmBytes = io.github.qorechain.utils.Base58.decode(a.svm);
        assertEquals(32, svmBytes.length);
        assertArrayEquals(a.addressBytes, Arrays.copyOf(svmBytes, 20));
        for (int i = 20; i < 32; i++) {
            assertEquals(0, svmBytes[i]);
        }
    }

    @Test
    void phantomSignatureAnchorsAccount() {
        byte[] sig = new byte[64];
        for (int i = 0; i < 64; i++) {
            sig[i] = (byte) i;
        }
        UnifiedAccount a = UnifiedAccounts.unifiedAccountFromPhantomSignature(sig);
        // Equivalent to unifiedAccountFromSeed(shake256(sig, 32)).
        UnifiedAccount b = UnifiedAccounts.unifiedAccountFromSeed(Hashing.shake256(sig, 32));
        assertEquals(b.cosmos, a.cosmos);
        assertEquals(b.evm, a.evm);
        assertEquals(b.svm, a.svm);
        assertEquals("qor1kllqspj45exs08eml8v4lgnlyh4g8urzwj27v4", a.cosmos);
    }

    @Test
    void invalidMnemonicRejectedWithoutLeakingPhrase() {
        String bad = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo";
        IllegalArgumentException ex =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> UnifiedAccounts.deriveUnifiedAccount(bad, 0));
        assertTrue(ex.getMessage().toLowerCase().contains("invalid mnemonic"));
        assertTrue(!ex.getMessage().contains("zoo"));
    }

    @Test
    void seedMustBe32Bytes() {
        assertThrows(
                IllegalArgumentException.class,
                () -> UnifiedAccounts.unifiedAccountFromSeed(new byte[16]));
    }
}
