package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.accounts.PqcRecovery;
import io.github.qorechain.accounts.UnifiedAccounts;
import io.github.qorechain.accounts.UnifiedAccounts.SeedPqcOptions;
import io.github.qorechain.accounts.UnifiedAccounts.UnifiedAccount;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.utils.Hashing;
import io.github.qorechain.utils.Hex;
import java.util.Arrays;
import java.util.Locale;
import org.junit.jupiter.api.Test;

/**
 * Known-answer tests for QRC1 recovery codes and the seed-path PQC key, against
 * vectors produced by {@code @qorechain/wallet-adapter} 0.4.0.
 */
class PqcRecoveryTest {

    private static final String ADDRESS = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj";
    private static final String CODE_07 =
            "QRC1-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3X-19XK";
    private static final String PUB_SHA_RECOVERY =
            "cf50dca6c9a0d86eeac9d6a50ee54e567e2126184143be694b8df1f31c8e23ef";
    private static final String PUB_SHA_LEGACY =
            "3710d198ff5d3206601e9dfd7e0e4bac0656de0fee28f5a20b39e05c81e46bd0";

    private static byte[] filled(int b) {
        byte[] out = new byte[32];
        Arrays.fill(out, (byte) b);
        return out;
    }

    private static String pubSha(PqcKeypair kp) {
        assertEquals(Pqc.ML_DSA_87_PUBLIC_KEY_LENGTH, kp.publicKey.length);
        return Hex.encode(Hashing.sha256(kp.publicKey));
    }

    @Test
    void encodesTheReferenceCode() {
        assertEquals(CODE_07, PqcRecovery.pqcRecoveryCodeFromSecret(filled(7)));
        assertTrue(PqcRecovery.isValidRecoveryCode(CODE_07));
    }

    @Test
    void seedPathWithRecoveryCodeMatchesReference() {
        UnifiedAccount a =
                UnifiedAccounts.unifiedAccountFromSeed(filled(1), SeedPqcOptions.withRecoveryCode(CODE_07));
        assertEquals(ADDRESS, a.cosmos);
        assertNull(a.mnemonic);
        assertArrayEquals(filled(1), a.privateKey);
        assertEquals(PUB_SHA_RECOVERY, pubSha(a.pqc));
    }

    @Test
    void seedPathWithPqcSecretGivesTheSameKey() {
        byte[] secret = filled(7);
        UnifiedAccount a =
                UnifiedAccounts.unifiedAccountFromSeed(filled(1), SeedPqcOptions.withPqcSecret(secret));
        assertEquals(PUB_SHA_RECOVERY, pubSha(a.pqc));
        // The caller's array is left as it was.
        assertArrayEquals(filled(7), secret);
    }

    @Test
    void pqcKeyFromRecoveryCodeMatchesReference() {
        assertEquals(PUB_SHA_RECOVERY, pubSha(PqcRecovery.pqcKeyFromRecoveryCode(CODE_07, ADDRESS)));
        // The address is case-insensitive.
        assertEquals(
                PUB_SHA_RECOVERY,
                pubSha(PqcRecovery.pqcKeyFromRecoveryCode(CODE_07, ADDRESS.toUpperCase(Locale.ROOT))));
    }

    @Test
    void legacySeedDerivationKeepsTheOldKey() {
        UnifiedAccount a = UnifiedAccounts.unifiedAccountFromSeed(filled(1), SeedPqcOptions.legacy());
        assertEquals(ADDRESS, a.cosmos);
        assertEquals(PUB_SHA_LEGACY, pubSha(a.pqc));
    }

    @Test
    void normalisesWhatAPersonTyped() {
        // Lower case, spaces instead of dashes, and O / I / L confusables for 0 / 1.
        String typed =
                CODE_07.toLowerCase(Locale.ROOT)
                        .replace('-', ' ')
                        .replace('0', 'o')
                        .replaceFirst("1", "l")
                        .replace("19xk", "i9xk");
        assertTrue(PqcRecovery.isValidRecoveryCode(typed), typed);
        assertEquals(PUB_SHA_RECOVERY, pubSha(PqcRecovery.pqcKeyFromRecoveryCode(typed, ADDRESS)));
        // Without the prefix and with other separators.
        String bare = CODE_07.substring(5).replace('-', '_');
        assertTrue(PqcRecovery.isValidRecoveryCode(bare));
        assertEquals(56, PqcRecovery.normalizeRecoveryCode(CODE_07).length());
    }

    @Test
    void oneChangedCharacterFailsTheChecksum() {
        // Change the first data character: 0 -> 1.
        String bad = "QRC1-1" + CODE_07.substring(6);
        assertFalse(PqcRecovery.isValidRecoveryCode(bad));
        IllegalArgumentException ex =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> PqcRecovery.pqcKeyFromRecoveryCode(bad, ADDRESS));
        assertTrue(ex.getMessage().contains("checksum"), ex.getMessage());
        assertThrows(
                IllegalArgumentException.class,
                () -> UnifiedAccounts.unifiedAccountFromSeed(filled(1), SeedPqcOptions.withRecoveryCode(bad)));
    }

    @Test
    void rejectsBadLengthAndCharacters() {
        assertFalse(PqcRecovery.isValidRecoveryCode(CODE_07.substring(0, CODE_07.length() - 1)));
        assertFalse(PqcRecovery.isValidRecoveryCode(CODE_07.substring(0, 6) + "U" + CODE_07.substring(7)));
        assertFalse(PqcRecovery.isValidRecoveryCode(CODE_07.substring(0, 6) + "*" + CODE_07.substring(7)));
        assertFalse(PqcRecovery.isValidRecoveryCode(null));
        assertFalse(PqcRecovery.isValidRecoveryCode(""));
    }

    @Test
    void pqcKeyFromRecoveryCodeRequiresAQor1Address() {
        assertThrows(
                IllegalArgumentException.class,
                () -> PqcRecovery.pqcKeyFromRecoveryCode(CODE_07, "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1"));
        assertThrows(
                IllegalArgumentException.class,
                () -> PqcRecovery.pqcKeyFromRecoveryCode(CODE_07, "cosmos1rfjz7r3u8t65teavh5utquj3kwvsj983abcdef"));
        // Right shape, wrong bech32 checksum.
        assertThrows(
                IllegalArgumentException.class,
                () -> PqcRecovery.pqcKeyFromRecoveryCode(CODE_07, "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaq"));
        assertThrows(IllegalArgumentException.class, () -> PqcRecovery.pqcKeyFromRecoveryCode(CODE_07, null));
    }

    @Test
    void generatedCodesAreValidAndDistinct() {
        String a = PqcRecovery.generatePqcRecoveryCode();
        String b = PqcRecovery.generatePqcRecoveryCode();
        assertTrue(a.startsWith("QRC1-"));
        assertEquals(5 + 14 * 4 + 13, a.length());
        assertTrue(PqcRecovery.isValidRecoveryCode(a));
        assertTrue(PqcRecovery.isValidRecoveryCode(b));
        assertNotEquals(a, b);
    }

    @Test
    void seedPathWithoutAnOptionThrowsAndListsTheChoices() {
        for (SeedPqcOptions none : new SeedPqcOptions[] {null, new SeedPqcOptions()}) {
            IllegalArgumentException ex =
                    assertThrows(
                            IllegalArgumentException.class,
                            () -> UnifiedAccounts.unifiedAccountFromSeed(filled(1), none));
            String msg = ex.getMessage();
            assertTrue(msg.contains("recoveryCode"), msg);
            assertTrue(msg.contains("pqcSecret"), msg);
            assertTrue(msg.contains("legacySeedDerivation"), msg);
        }
        // legacySeedDerivation(false) is not a choice.
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        UnifiedAccounts.unifiedAccountFromSeed(
                                filled(1), new SeedPqcOptions().legacySeedDerivation(false)));
    }

    @Test
    void seedPathWithTwoOptionsThrows() {
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        UnifiedAccounts.unifiedAccountFromSeed(
                                filled(1), new SeedPqcOptions().recoveryCode(CODE_07).pqcSecret(filled(7))));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        UnifiedAccounts.unifiedAccountFromSeed(
                                filled(1), SeedPqcOptions.legacy().recoveryCode(CODE_07)));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        UnifiedAccounts.unifiedAccountFromSeed(
                                filled(1), SeedPqcOptions.withPqcSecret(filled(7)).legacySeedDerivation(true)));
    }

    @Test
    void pqcSecretMustBe32Bytes() {
        assertThrows(
                IllegalArgumentException.class,
                () -> UnifiedAccounts.unifiedAccountFromSeed(filled(1), SeedPqcOptions.withPqcSecret(new byte[16])));
        assertThrows(IllegalArgumentException.class, () -> PqcRecovery.pqcRecoveryCodeFromSecret(new byte[31]));
    }

    @Test
    void pqcSecretEqualToTheSeedIsRejected() {
        IllegalArgumentException ex =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> UnifiedAccounts.unifiedAccountFromSeed(filled(1), SeedPqcOptions.withPqcSecret(filled(1))));
        assertTrue(ex.getMessage().contains("must not be the seed"), ex.getMessage());
        // A recovery code that carries the seed is the same thing.
        String codeOfSeed = PqcRecovery.pqcRecoveryCodeFromSecret(filled(1));
        assertThrows(
                IllegalArgumentException.class,
                () -> UnifiedAccounts.unifiedAccountFromSeed(filled(1), SeedPqcOptions.withRecoveryCode(codeOfSeed)));
    }
}
