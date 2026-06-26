package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.protobuf.ByteString;
import io.github.qorechain.accounts.Account;
import io.github.qorechain.accounts.Accounts;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.tx.HybridTx;
import io.github.qorechain.tx.NativeTx;
import io.github.qorechain.tx.StdFee;
import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The hybrid contract invariant: the ML-DSA-87 signature is computed over the
 * body WITHOUT the PQC extension, framed with authInfo, and the extension lands
 * in the CRITICAL extension-options slot.
 */
class HybridTxTest {

    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";

    private HybridTx.Options baseOptions() {
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);
        byte[] seed = new byte[32];
        Arrays.fill(seed, (byte) 9);
        PqcKeypair pqc = Pqc.generatePqcKeypair(seed);

        TypedMessage send =
                NativeTx.bankSend(
                        acct.address,
                        Accounts.deriveNativeAccount(MNEMONIC, 1).address,
                        List.of(new StdFee.Coin("uqor", "1234567")));

        HybridTx.Options opts = new HybridTx.Options();
        opts.messages = List.of(send);
        opts.secp256k1PrivateKey = acct.privateKey;
        opts.secp256k1PublicKey = acct.publicKey;
        opts.pqcKeypair = pqc;
        opts.fee = StdFee.of("uqor", "5000", "200000");
        opts.memo = "qorechain-sdk-vector";
        opts.chainId = "qorechain-diana";
        opts.accountNumber = 7;
        opts.sequence = 3;
        return opts;
    }

    private static byte[] be32(int n) {
        return HybridTx.be32(n);
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parts) {
            out.writeBytes(p);
        }
        return out.toByteArray();
    }

    @Test
    void pqcSignedMessageExcludesExtension() throws Exception {
        HybridTx.Built built = HybridTx.buildHybridTx(baseOptions());

        // The final broadcast body carries the PQC extension (critical slot).
        cosmos.tx.v1beta1.TxOuterClass.TxBody finalBody =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.parseFrom(built.txRaw.getBodyBytes());
        assertEquals(1, finalBody.getExtensionOptionsCount());
        assertEquals(0, finalBody.getNonCriticalExtensionOptionsCount());

        // The PQC signed message frames B0 (no extension) + A — NOT the final body.
        byte[] b0 = built.b0Bytes;
        byte[] a = built.authInfoBytes;
        byte[] expected = concat(be32(b0.length), b0, be32(a.length), a);
        assertArrayEquals(expected, built.pqcSignedMessage);

        byte[] wrong =
                concat(
                        be32(built.finalBodyBytes.length),
                        built.finalBodyBytes,
                        be32(a.length),
                        a);
        assertFalse(Arrays.equals(wrong, built.pqcSignedMessage));

        // The signature has the right length and verifies over the framed bytes.
        assertEquals(Pqc.ML_DSA_87_SIGNATURE_LENGTH, built.pqcSignature.length);
        byte[] seed = new byte[32];
        Arrays.fill(seed, (byte) 9);
        PqcKeypair pqc = Pqc.generatePqcKeypair(seed);
        assertTrue(Pqc.pqcVerify(pqc.publicKey, built.pqcSignedMessage, built.pqcSignature));
    }

    @Test
    void extensionIsCriticalWithCorrectTypeUrl() throws Exception {
        HybridTx.Built built = HybridTx.buildHybridTx(baseOptions());
        cosmos.tx.v1beta1.TxOuterClass.TxBody body =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.parseFrom(built.txRaw.getBodyBytes());
        com.google.protobuf.Any ext = body.getExtensionOptions(0);
        assertEquals(Pqc.HYBRID_SIG_TYPE_URL, ext.getTypeUrl());
        // The extension value is Go-JSON, not protobuf.
        String json = ext.getValue().toStringUtf8();
        assertTrue(json.startsWith("{\"algorithm_id\":1"));
    }

    @Test
    void classicalSignatureIs64Bytes() {
        HybridTx.Built built = HybridTx.buildHybridTx(baseOptions());
        assertEquals(1, built.txRaw.getSignaturesCount());
        assertEquals(64, built.txRaw.getSignatures(0).size());
    }

    @Test
    void b0IsByteIdenticalToAnExtensionlessBody() throws Exception {
        HybridTx.Options opts = baseOptions();
        HybridTx.Built built = HybridTx.buildHybridTx(opts);
        // Rebuild a body with the same messages/memo but no extension and compare.
        cosmos.tx.v1beta1.TxOuterClass.TxBody.Builder stripped =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.newBuilder().setMemo(opts.memo);
        for (TypedMessage m : opts.messages) {
            stripped.addMessages(Messages.pack(m));
        }
        assertArrayEquals(stripped.build().toByteArray(), built.b0Bytes);
    }
}
