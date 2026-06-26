package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.accounts.Account;
import io.github.qorechain.accounts.Accounts;
import org.junit.jupiter.api.Test;

/** Known-answer (KAT) vectors for HD account derivation in all three schemes. */
class AccountsTest {

    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";

    @Test
    void evmKatVectors() {
        assertEquals(
                "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
                Accounts.deriveEvmAccount(MNEMONIC, 0).address);
        assertEquals(
                "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
                Accounts.deriveEvmAccount(MNEMONIC, 1).address);
    }

    @Test
    void nativeKatVectors() {
        assertEquals(
                "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu",
                Accounts.deriveNativeAccount(MNEMONIC, 0).address);
        assertEquals(
                "qor1erxf3sa9q2j4vgseu7jq4a258ckmk7cym4dgjq",
                Accounts.deriveNativeAccount(MNEMONIC, 1).address);
    }

    @Test
    void svmKatVector() {
        assertEquals(
                "oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96",
                Accounts.deriveSvmAccount(MNEMONIC, 0).address);
    }

    @Test
    void derivationIsDeterministic() {
        assertEquals(
                Accounts.deriveNativeAccount(MNEMONIC, 0).address,
                Accounts.deriveNativeAccount(MNEMONIC, 0).address);
        assertEquals(
                Accounts.deriveEvmAccount(MNEMONIC, 2).address,
                Accounts.deriveEvmAccount(MNEMONIC, 2).address);
    }

    @Test
    void keyShapesAreCorrect() {
        Account nat = Accounts.deriveNativeAccount(MNEMONIC, 0);
        assertEquals(33, nat.publicKey.length); // compressed secp256k1
        assertEquals(32, nat.privateKey.length);
        Account svm = Accounts.deriveSvmAccount(MNEMONIC, 0);
        assertEquals(32, svm.publicKey.length);
        assertEquals(64, svm.secretKey.length); // 32 seed || 32 pub
    }

    @Test
    void invalidMnemonicThrows() {
        // Valid words but wrong checksum (the fund-loss footgun).
        String bad = "test test test test test test test test test test test test";
        assertFalse(Accounts.validateMnemonic(bad));
        assertThrows(IllegalArgumentException.class, () -> Accounts.deriveNativeAccount(bad, 0));
    }

    @Test
    void generatedMnemonicIsValid() {
        assertTrue(Accounts.validateMnemonic(Accounts.generateMnemonic()));
        assertTrue(Accounts.validateMnemonic(Accounts.generateMnemonic(256)));
        assertEquals(12, Accounts.generateMnemonic(128).split(" ").length);
        assertEquals(24, Accounts.generateMnemonic(256).split(" ").length);
    }
}
