package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.protobuf.ByteString;
import io.github.qorechain.accounts.UnifiedAccounts;
import io.github.qorechain.accounts.UnifiedAccounts.UnifiedAccount;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.tx.HybridTx;
import io.github.qorechain.tx.NativeTx;
import io.github.qorechain.tx.SignEth;
import io.github.qorechain.tx.StdFee;
import io.github.qorechain.utils.Hashing;
import java.math.BigInteger;
import java.util.List;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPublicKeyParameters;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.junit.jupiter.api.Test;

/**
 * Eth-native ({@code eth_secp256k1}) Cosmos-lane signing: the classical signature
 * is secp256k1 over KECCAK-256 of the SignDoc (not sha256), the SignerInfo pubkey
 * {@code Any} carries the eth type URL, and the hybrid B0 excludes the PQC
 * extension.
 */
class SignEthTest {

    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";

    private static final X9ECParameters CURVE = SECNamedCurves.getByName("secp256k1");
    private static final ECDomainParameters DOMAIN =
            new ECDomainParameters(CURVE.getCurve(), CURVE.getG(), CURVE.getN(), CURVE.getH());

    private SignEth.Options baseOptions(UnifiedAccount acct) {
        TypedMessage send =
                NativeTx.bankSend(
                        acct.cosmos,
                        acct.cosmos,
                        List.of(new StdFee.Coin("uqor", "1000")));
        SignEth.Options opts = new SignEth.Options();
        opts.messages = List.of(send);
        opts.secp256k1PrivateKey = acct.privateKey;
        opts.secp256k1PublicKey = acct.publicKey;
        opts.pqcKeypair = acct.pqc;
        opts.fee = StdFee.of("uqor", "5000", "200000");
        opts.memo = "eth-native";
        opts.chainId = "qorechain-diana";
        opts.accountNumber = 7;
        opts.sequence = 3;
        return opts;
    }

    /** Verify a 64-byte r‖s signature as secp256k1 over the given 32-byte hash. */
    private static boolean verify(byte[] compressedPubkey, byte[] hash, byte[] sig64) {
        BigInteger r = new BigInteger(1, java.util.Arrays.copyOfRange(sig64, 0, 32));
        BigInteger s = new BigInteger(1, java.util.Arrays.copyOfRange(sig64, 32, 64));
        ECPublicKeyParameters pub =
                new ECPublicKeyParameters(CURVE.getCurve().decodePoint(compressedPubkey), DOMAIN);
        ECDSASigner verifier = new ECDSASigner();
        verifier.init(false, pub);
        return verifier.verifySignature(hash, r, s);
    }

    private static byte[] signDocBytes(SignEth.Built built, SignEth.Options opts) {
        return cosmos.tx.v1beta1.TxOuterClass.SignDoc.newBuilder()
                .setBodyBytes(ByteString.copyFrom(built.bodyBytes))
                .setAuthInfoBytes(ByteString.copyFrom(built.authInfoBytes))
                .setChainId(opts.chainId)
                .setAccountNumber(opts.accountNumber)
                .build()
                .toByteArray();
    }

    @Test
    void classicalSignatureVerifiesOverKeccakSignDoc() {
        UnifiedAccount acct = UnifiedAccounts.deriveUnifiedAccount(MNEMONIC, 0);
        SignEth.Options opts = baseOptions(acct);
        SignEth.Built built = SignEth.signClassicalEth(opts);

        assertEquals(64, built.classicalSignature.length);
        byte[] signBytes = signDocBytes(built, opts);
        byte[] keccak = Hashing.keccak256(signBytes);
        assertTrue(
                verify(acct.publicKey, keccak, built.classicalSignature),
                "classical sig must verify as secp256k1 over keccak256(SignDoc)");
        // And must NOT verify over sha256(SignDoc) — proving the keccak divergence.
        assertTrue(!verify(acct.publicKey, Hashing.sha256(signBytes), built.classicalSignature));
    }

    @Test
    void authInfoCarriesEthPubkeyType() throws Exception {
        UnifiedAccount acct = UnifiedAccounts.deriveUnifiedAccount(MNEMONIC, 0);
        SignEth.Built built = SignEth.signClassicalEth(baseOptions(acct));
        cosmos.tx.v1beta1.TxOuterClass.AuthInfo authInfo =
                cosmos.tx.v1beta1.TxOuterClass.AuthInfo.parseFrom(built.authInfoBytes);
        com.google.protobuf.Any pubAny = authInfo.getSignerInfos(0).getPublicKey();
        assertEquals(SignEth.ETHSECP256K1_PUBKEY_TYPE, pubAny.getTypeUrl());
        // pubkeyFromAny decodes both the eth and standard secp256k1 forms.
        assertArrayEquals(acct.publicKey, SignEth.pubkeyFromAny(pubAny));
    }

    @Test
    void classicalBodyHasNoExtension() throws Exception {
        UnifiedAccount acct = UnifiedAccounts.deriveUnifiedAccount(MNEMONIC, 0);
        SignEth.Built built = SignEth.signClassicalEth(baseOptions(acct));
        cosmos.tx.v1beta1.TxOuterClass.TxBody body =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.parseFrom(built.bodyBytes);
        assertEquals(0, body.getExtensionOptionsCount());
    }

    @Test
    void hybridB0ExcludesExtensionAndFramesCorrectly() throws Exception {
        UnifiedAccount acct = UnifiedAccounts.deriveUnifiedAccount(MNEMONIC, 0);
        SignEth.Options opts = baseOptions(acct);
        SignEth.Built built = SignEth.signHybridEth(opts);

        // Final broadcast body carries the PQC extension in the critical slot.
        cosmos.tx.v1beta1.TxOuterClass.TxBody finalBody =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.parseFrom(built.bodyBytes);
        assertEquals(1, finalBody.getExtensionOptionsCount());
        assertEquals(Pqc.HYBRID_SIG_TYPE_URL, finalBody.getExtensionOptions(0).getTypeUrl());

        // B0 has no extension (byte-identical to an extension-less body).
        cosmos.tx.v1beta1.TxOuterClass.TxBody.Builder stripped =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.newBuilder().setMemo(opts.memo);
        for (TypedMessage m : opts.messages) {
            stripped.addMessages(Messages.pack(m));
        }
        assertArrayEquals(stripped.build().toByteArray(), built.b0Bytes);

        // PQC signature is over frame(B0, authInfo) and verifies.
        assertArrayEquals(
                HybridTx.frame(built.b0Bytes, built.authInfoBytes), built.pqcSignedMessage);
        assertEquals(Pqc.ML_DSA_87_SIGNATURE_LENGTH, built.pqcSignature.length);
        assertTrue(Pqc.pqcVerify(acct.pqc.publicKey, built.pqcSignedMessage, built.pqcSignature));

        // Classical sig verifies over keccak256 of the FINAL (with-ext) SignDoc.
        byte[] keccak = Hashing.keccak256(signDocBytes(built, opts));
        assertTrue(verify(acct.publicKey, keccak, built.classicalSignature));
    }
}
