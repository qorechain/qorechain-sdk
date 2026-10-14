package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.qorechain.evm.EvmWindow;
import io.github.qorechain.evm.EvmWindowStatus;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.KeyIntegrity;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.tx.Authenticator;
import io.github.qorechain.tx.TxError;
import io.github.qorechain.utils.Hashing;
import io.github.qorechain.utils.Hex;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import qorechain.pqc.v1.Tx;

/** Client support for chain v3.2.3. */
class V323Test {

    private static final String SENDER = "qor18df074t3k0xq8jf7336hpjjsktw354knr650aq";
    private static final String TARGET = "0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B";

    private static PqcKeypair kp() {
        byte[] seed = new byte[32];
        Arrays.fill(seed, (byte) 1);
        return Pqc.generatePqcKeypair(seed);
    }

    @Test
    void registrationIntegrity() {
        PqcKeypair kp = kp();
        assertThrows(
                IllegalArgumentException.class,
                () -> KeyIntegrity.validateRegisteredKey(KeyIntegrity.KEY_TYPE_CLASSICAL_ONLY, kp.publicKey));
        assertThrows(IllegalArgumentException.class, () -> KeyIntegrity.validateRegisteredKey("hybrid", new byte[0]));
        byte[] degenerate = new byte[2592];
        System.arraycopy(kp.publicKey, 0, degenerate, 0, 32);
        assertTrue(KeyIntegrity.isDegeneratePublicKey(degenerate));
        assertThrows(IllegalArgumentException.class, () -> KeyIntegrity.validateRegisteredKey("hybrid", degenerate));
        assertFalse(KeyIntegrity.isDegeneratePublicKey(kp.publicKey));
        KeyIntegrity.validateRegisteredKey("hybrid", kp.publicKey);
    }

    @Test
    void proofOfPossession() {
        PqcKeypair kp = kp();
        assertEquals(
                "qorechain-pqc-pop-v1|qorechain-diana|1|" + SENDER + "|abcd",
                new String(
                        KeyIntegrity.proofOfPossessionSignBytes("qorechain-diana", 1, SENDER, new byte[] {(byte) 0xab, (byte) 0xcd}),
                        StandardCharsets.UTF_8));
        byte[] a = KeyIntegrity.signProofOfPossession("qorechain-diana", SENDER, kp);
        assertArrayEquals(a, KeyIntegrity.signProofOfPossession("qorechain-diana", SENDER, kp));
        assertEquals(4627, a.length);
        // Same vector as every other SDK.
        assertEquals("5b767a00efb7ad721f5416a4bd7fcdad", Hex.encode(Hashing.shake256(a, 16)));
        assertTrue(KeyIntegrity.verifyProofOfPossession("qorechain-diana", SENDER, kp.publicKey, a));
        assertFalse(KeyIntegrity.verifyProofOfPossession("qorechain-vladi", SENDER, kp.publicKey, a));
    }

    @Test
    void evmWindowScope() throws Exception {
        TypedMessage tm = EvmWindow.openScoped(SENDER, 10, 1, "1", true, List.of(TARGET));
        Tx.MsgOpenEVMWindow back = (Tx.MsgOpenEVMWindow) Messages.unpack(Messages.pack(tm));
        assertTrue(back.getNativeOnly());
        assertEquals(List.of(TARGET), back.getAllowedTargetsList());
        assertTrue(EvmWindow.openMessage(SENDER, 10, 1, "1").getSerializedSize() < back.getSerializedSize());
        assertThrows(IllegalArgumentException.class, () -> EvmWindow.openScoped(SENDER, 10, 1, "1", false, List.of("0x12")));
        assertThrows(
                IllegalArgumentException.class,
                () -> EvmWindow.openScoped(SENDER, 10, 1, "1", false, List.of(TARGET, TARGET.toLowerCase())));
        List<String> many = new ArrayList<>();
        for (int i = 0; i <= EvmWindow.MAX_TARGETS; i++) {
            many.add(String.format("0x%040x", i));
        }
        assertThrows(IllegalArgumentException.class, () -> EvmWindow.openScoped(SENDER, 10, 1, "1", false, many));

        EvmWindowStatus s =
                EvmWindowStatus.of(
                        new ObjectMapper()
                                .readTree("{\"found\":true,\"live\":true,\"native_only\":true,\"allowed_targets\":[\"" + TARGET + "\"]}"));
        assertTrue(s.nativeOnly);
        assertEquals(List.of(TARGET), s.allowedTargets);
    }

    @Test
    void aaDigestMatchesChain() {
        // Computed with the chain's own EVMAuthSignBytes / EVMAuthSignBytesV2.
        byte[] pub = Hex.decode("038844ec286297bf780ce0fbe07df2a74c5e0e841df5f3adc363f0372755b76d74");
        byte[] data = Hex.decode("a9059cbb");
        String acct = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";
        String to = "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b";
        assertEquals(
                "c2614c477a15020777adb1e889748557debc6dece7207ded95d30ee6d7bd778a",
                Hex.encode(Authenticator.evmAuthSignBytes("qorechain-diana", acct, pub, to, "1000", data, 7)));
        assertEquals(
                "19d7518ad25079dff616819b7554d7d39700fb9e4331a6cbc635685122f0c18b",
                Hex.encode(Authenticator.evmAuthSignBytesV2("qorechain-diana", acct, pub, to, "1000", data, 7, 250000)));
        assertThrows(
                IllegalArgumentException.class,
                () -> Authenticator.evmAuthSignBytesV2("qorechain-diana", acct, pub, to, "1000", data, 7, 0));
    }

    @Test
    void v323Codes() {
        assertEquals("pqc_key_weak", TxError.decode(230, "pqc", "", "").kind);
        assertEquals("pqc_proof_of_possession_invalid", TxError.decode(231, "pqc", "", "").kind);
        assertEquals("pqc_key_reused", TxError.decode(232, "pqc", "", "").kind);
        assertEquals("pqc_maintenance_needs_hybrid", TxError.decode(234, "pqc", "", "").kind);
    }
}
