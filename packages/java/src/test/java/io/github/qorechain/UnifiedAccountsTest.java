package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.accounts.UnifiedAccounts;
import io.github.qorechain.accounts.UnifiedAccounts.AddressTriple;
import io.github.qorechain.accounts.UnifiedAccounts.UnifiedAccount;
import io.github.qorechain.pqc.Pqc;
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

    /**
     * Deriving the spend key from a wallet signature was removed in v0.8.0: the
     * signature is a bearer secret any page can request, so it cannot be a key.
     * The call must fail loudly and point at the authenticator lanes.
     */
    @Test
    void signatureDerivedAccountIsRemovedAndThrows() {
        byte[] sig = new byte[64];
        for (int i = 0; i < 64; i++) {
            sig[i] = (byte) i;
        }
        UnsupportedOperationException ex =
                assertThrows(
                        UnsupportedOperationException.class,
                        () -> UnifiedAccounts.unifiedAccountFromPhantomSignature(sig));
        String msg = ex.getMessage();
        assertTrue(msg.contains("removed in v0.8.0"), msg);
        // Points the caller at the replacement lanes.
        assertTrue(msg.contains("MsgRegisterAuthenticator"), msg);
        assertTrue(msg.contains("MsgExecuteCosmos"), msg);
        assertTrue(msg.contains("MsgExecuteEVM"), msg);
        // Tells the holder of an old account what to do about it.
        assertTrue(msg.contains("must be treated as exposed"), msg);
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
