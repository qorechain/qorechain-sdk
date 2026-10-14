package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.qorechain.evm.EvmDelegation;
import io.github.qorechain.evm.EvmDelegationConsent;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.ClassicalKey;
import io.github.qorechain.query.ChainUpgrades;
import io.github.qorechain.tx.TxError;
import io.github.qorechain.utils.Bech32;
import io.github.qorechain.utils.Hashing;
import io.github.qorechain.utils.Hex;
import java.math.BigInteger;
import java.util.Arrays;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.junit.jupiter.api.Test;
import qorechain.pqc.v1.Tx;

/** Client support for chain v3.2.2: delegation consent, the ecdsa_pubkey rule, upgrade detection. */
class V322Test {

    private static final String SENDER = "qor18df074t3k0xq8jf7336hpjjsktw354knr650aq";
    private static final String DELEGATE = "0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void authorizeRoundTripsLowerCased() throws Exception {
        TypedMessage tm = EvmDelegation.authorize(SENDER, DELEGATE, 600);
        assertEquals("/qorechain.pqc.v1.MsgAuthorizeEVMDelegation", tm.typeUrl);
        Tx.MsgAuthorizeEVMDelegation back =
                (Tx.MsgAuthorizeEVMDelegation) Messages.unpack(Messages.pack(tm));
        assertEquals(SENDER, back.getSender());
        assertEquals(DELEGATE.toLowerCase(), back.getDelegate());
        assertEquals(600, back.getBlocks());
        EvmDelegation.authorize(SENDER, EvmDelegation.CLEAR, 1);
        assertEquals("/qorechain.pqc.v1.MsgClearEVMDelegation", EvmDelegation.clear(SENDER).typeUrl);
    }

    @Test
    void authorizeEnforcesBounds() {
        assertThrows(IllegalArgumentException.class, () -> EvmDelegation.authorize(SENDER, DELEGATE, 0));
        assertThrows(
                IllegalArgumentException.class,
                () -> EvmDelegation.authorize(SENDER, DELEGATE, EvmDelegation.MAX_CONSENT_BLOCKS + 1));
        assertThrows(IllegalArgumentException.class, () -> EvmDelegation.authorize(SENDER, "63c0c19a", 5));
        assertThrows(IllegalArgumentException.class, () -> EvmDelegation.clear("nope"));
    }

    @Test
    void consentParseAndTupleNonce() throws Exception {
        EvmDelegationConsent c =
                EvmDelegationConsent.of(
                        MAPPER.readTree(
                                "{\"found\":true,\"live\":true,\"delegate\":\"0x63c0c19a282a1b52b07dd5a65b58948a07dae32b\","
                                        + "\"granted_height\":\"6905100\",\"expiry_height\":\"6905700\","
                                        + "\"current_delegate\":\"\",\"nonce\":\"7\"}"));
        assertTrue(c.found && c.live);
        assertEquals(6905700L, c.expiryHeight);
        assertEquals(7L, c.tupleNonce(true));
        assertEquals(8L, c.tupleNonce(false));
    }

    @Test
    void classifyDelegationRefusals() {
        assertEquals(
                EvmDelegation.Refusal.NO_CONSENT,
                EvmDelegation.classify(0, "", "no post-quantum consent for this EIP-7702 delegation: authority 0xabc"));
        assertEquals(EvmDelegation.Refusal.INVALID, EvmDelegation.classify(61, "pqc", ""));
        assertNull(EvmDelegation.classify(26, "pqc", ""));
    }

    @Test
    void classicalKeyRule() {
        // Accepted on diana at h 7,911,828 with the v3.2.2 rule on (eth-native).
        assertEquals(
                ClassicalKey.Match.ETH,
                ClassicalKey.validateForSender(
                        "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k",
                        Hex.decode("038844ec286297bf780ce0fbe07df2a74c5e0e841df5f3adc363f0372755b76d74")));

        byte[] priv = new byte[32];
        Arrays.fill(priv, (byte) 0x11);
        var g = SECNamedCurves.getByName("secp256k1").getG().multiply(new BigInteger(1, priv)).normalize();
        byte[] pub = g.getEncoded(true);
        String addr = Bech32.encode("qor", Hashing.ripemd160(Hashing.sha256(pub)));
        assertEquals(ClassicalKey.Match.COSMOS, ClassicalKey.validateForSender(addr, pub));
        assertEquals(ClassicalKey.Match.EMPTY, ClassicalKey.validateForSender(SENDER, new byte[0]));
        IllegalArgumentException foreign =
                assertThrows(IllegalArgumentException.class, () -> ClassicalKey.validateForSender(SENDER, pub));
        assertTrue(foreign.getMessage().contains("does not belong"));
        IllegalArgumentException longKey =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> ClassicalKey.validateForSender(SENDER, g.getEncoded(false)));
        assertTrue(longKey.getMessage().contains("33-byte"));
    }

    @Test
    void appliedHeightParsing() throws Exception {
        assertEquals(6905034L, ChainUpgrades.parseAppliedHeight(MAPPER.readTree("{\"height\":\"6905034\"}")));
        // Mainnet's answer before the plan: a truthy string that means "no".
        assertEquals(0L, ChainUpgrades.parseAppliedHeight(MAPPER.readTree("{\"height\":\"0\"}")));
        assertThrows(
                IllegalArgumentException.class,
                () -> ChainUpgrades.parseAppliedHeight(MAPPER.readTree("{\"height\":\"x\"}")));
    }

    @Test
    void decodeTxErrorV322() {
        String log = "sender qor1abc has sent 600 transactions in the last 30 blocks, at the configured limit of 600 per minute";
        assertEquals(TxError.RATE_LIMITED, TxError.decode(3, "ai", log, "").kind);
        assertEquals(TxError.RATE_LIMITED, TxError.decode(3, "", log, "").kind);
        assertNotEquals(TxError.RATE_LIMITED, TxError.decode(3, "ai", "transaction rejected by AI engine", "").kind);
        assertNotEquals(TxError.RATE_LIMITED, TxError.decode(2, "ai", log, "").kind);
        assertEquals("evm_delegation_no_consent", TxError.decode(60, "pqc", "", "").kind);
        assertEquals("evm_delegation_invalid", TxError.decode(61, "pqc", "", "").kind);
    }

    @Test
    void decodePqcKeyRequirement() {
        assertEquals(TxError.PQC_KEY_REQUIRED, TxError.decode(8, "pqc", "account has no PQC key and classical fallback is disabled", "").kind);
        assertEquals(TxError.PQC_KEY_REQUIRED, TxError.decode(8, "pqc", "", "").kind);
        assertEquals(TxError.PQC_KEY_REQUIRED, TxError.decode(20, "pqc", "account qor1abc has no registered PQC key, so its hybrid extension cannot be verified; register the key first (hybrid mode: required)", "").kind);
        assertEquals(TxError.PQC_KEY_REQUIRED, TxError.decode(20, "pqc", "account qor1abc must include a PQC hybrid signature extension (hybrid mode: required)", "").kind);
        assertEquals(TxError.HYBRID_SIGNATURE_REQUIRED, TxError.decode(20, "pqc", "account qor1abc has a registered PQC key and must include the hybrid signature extension (hybrid mode: required)", "").kind);
        assertNotEquals(TxError.PQC_KEY_REQUIRED, TxError.decode(20, "pqc", "", "").kind);
    }
}
