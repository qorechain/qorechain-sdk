package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.Any;
import com.google.protobuf.Message;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.accounts.UnifiedAccounts;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.tx.Authenticator;
import io.github.qorechain.tx.TxError;
import io.github.qorechain.utils.Hex;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * v3.1.85 authenticator-lane coverage: byte-exact KATs for the three sign-bytes
 * helpers, the two execute-lane composers + Any round-trips, the rotate PermissionSchema
 * query over a mock RPC, module error-code decoding, and rotate-from-mnemonic dual-signing.
 */
class AuthenticatorTest {

    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";

    /** 32 bytes of 0x01 — the KAT authenticator pubkey. */
    private static byte[] katPubkey() {
        byte[] pubkey = new byte[32];
        Arrays.fill(pubkey, (byte) 0x01);
        return pubkey;
    }

    // ---- KATs (byte-exact against the reference wallet-adapter authenticator.js) ----

    @Test
    void evmAuthSignBytesKat() {
        byte[] digest =
                Authenticator.evmAuthSignBytes(
                        "qorechain-diana",
                        "qor1test",
                        katPubkey(),
                        "0xabc",
                        "1000",
                        new byte[] {2, 2, 2},
                        5);
        assertEquals(
                "8661921e6d37dff44e97d4a05d4efbfd3fd8ea631201479c2bbf1cb41ade7025",
                Hex.encode(digest));
    }

    @Test
    void cosmosAuthSignBytesKat() {
        byte[] digest =
                Authenticator.cosmosAuthSignBytes(
                        "qorechain-diana", "qor1test", katPubkey(), "qor1recv", "100uqor", 3);
        assertEquals(
                "5e203ef47b5fe63d0fc9c8909aecb124b32b173f8b96700003ba1d8fa0114f0f",
                Hex.encode(digest));
    }

    @Test
    void rotationSignBytesKat() {
        String s =
                Authenticator.rotationSignBytes(
                        "qorechain-diana",
                        1,
                        "qor1test",
                        new byte[] {(byte) 0xaa, (byte) 0xaa},
                        new byte[] {(byte) 0xbb, (byte) 0xbb});
        assertEquals("qorechain-pqc-rotate-v1|qorechain-diana|1|qor1test|aaaa|bbbb", s);
    }

    // ---- composer type URLs + Any round-trip ----

    @Test
    void executeEvmComposerTypeUrlAndRoundTrip() throws Exception {
        TypedMessage tm =
                Authenticator.executeEvmMsg(
                        "qor1relayer",
                        "qor1account",
                        "ed25519",
                        katPubkey(),
                        new byte[] {9, 9, 9},
                        "0xabc",
                        "1000",
                        new byte[] {2, 2, 2},
                        100000,
                        5);
        assertEquals("/qorechain.abstractaccount.v1.MsgExecuteEVM", tm.typeUrl);

        Any any = Messages.pack(tm);
        assertEquals("/qorechain.abstractaccount.v1.MsgExecuteEVM", any.getTypeUrl());
        Message decoded = Messages.unpack(any);
        assertTrue(decoded instanceof qorechain.abstractaccount.v1.Tx.MsgExecuteEVM);
        qorechain.abstractaccount.v1.Tx.MsgExecuteEVM back =
                (qorechain.abstractaccount.v1.Tx.MsgExecuteEVM) decoded;
        assertEquals("qor1relayer", back.getRelayer());
        assertEquals("qor1account", back.getAccount());
        assertEquals("ed25519", back.getScheme());
        assertEquals("0xabc", back.getTo());
        assertEquals("1000", back.getValue());
        assertEquals(100000L, back.getGasLimit());
        assertEquals(5L, back.getNonce());
        assertArrayEquals(katPubkey(), back.getPubkey().toByteArray());
    }

    @Test
    void executeCosmosComposerTypeUrlAndRoundTrip() throws Exception {
        TypedMessage tm =
                Authenticator.executeCosmosMsg(
                        "qor1relayer",
                        "qor1account",
                        "secp256k1",
                        katPubkey(),
                        new byte[] {7, 7},
                        "qor1recv",
                        "100uqor",
                        3);
        assertEquals("/qorechain.abstractaccount.v1.MsgExecuteCosmos", tm.typeUrl);

        Any any = Messages.pack(tm);
        assertEquals("/qorechain.abstractaccount.v1.MsgExecuteCosmos", any.getTypeUrl());
        Message decoded = Messages.unpack(any);
        assertTrue(decoded instanceof qorechain.abstractaccount.v1.Tx.MsgExecuteCosmos);
        qorechain.abstractaccount.v1.Tx.MsgExecuteCosmos back =
                (qorechain.abstractaccount.v1.Tx.MsgExecuteCosmos) decoded;
        assertEquals("qor1recv", back.getTo());
        assertEquals(1, back.getAmountCount());
        assertEquals("uqor", back.getAmount(0).getDenom());
        assertEquals("100", back.getAmount(0).getAmount());
        assertEquals(3L, back.getNonce());
    }

    @Test
    void parseCoinRejectsMalformed() {
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        Authenticator.executeCosmosMsg(
                                "r", "a", "ed25519", new byte[0], new byte[0], "to", "uqor", 1));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        Authenticator.executeCosmosMsg(
                                "r", "a", "ed25519", new byte[0], new byte[0], "to", "100", 1));
    }

    // ---- PermissionSchema query over a mock consensus RPC (abci_query) ----

    private HttpServer server;
    private final List<String> abciPaths = new ArrayList<>();
    private String baseUrl;
    private Message responseMessage;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/",
                ex -> {
                    byte[] body = ex.getRequestBody().readAllBytes();
                    JsonNode req = MAPPER.readTree(body);
                    abciPaths.add(req.path("params").path(0).asText());
                    String valueB64 =
                            Base64.getEncoder()
                                    .encodeToString(
                                            responseMessage == null
                                                    ? new byte[0]
                                                    : responseMessage.toByteArray());
                    String resp =
                            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"response\":{\"code\":0,"
                                    + "\"value\":\""
                                    + valueB64
                                    + "\"}}}";
                    byte[] bytes = resp.getBytes(StandardCharsets.UTF_8);
                    ex.getResponseHeaders().add("content-type", "application/json");
                    ex.sendResponseHeaders(200, bytes.length);
                    ex.getResponseBody().write(bytes);
                    ex.close();
                });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void permissionSchemaQueryPathAndDecode() {
        io.github.qorechain.query.AbstractAccountQueryClient aa =
                new io.github.qorechain.query.AbstractAccountQueryClient(baseUrl);

        responseMessage =
                qorechain.abstractaccount.v1.QueryOuterClass.QueryPermissionSchemaResponse
                        .newBuilder()
                        .setSchemaVersion("v3.1.85")
                        .addPermissions("send")
                        .addPermissions("evm")
                        .putMsgPermissions(
                                "/qorechain.abstractaccount.v1.MsgExecuteEVM", "evm")
                        .addKeyManagementMsgs(
                                "/qorechain.abstractaccount.v1.MsgRegisterAuthenticator")
                        .build();

        qorechain.abstractaccount.v1.QueryOuterClass.QueryPermissionSchemaResponse got =
                aa.permissionSchema();
        assertEquals("v3.1.85", got.getSchemaVersion());
        assertTrue(got.getPermissionsList().contains("evm"));
        assertEquals(
                "evm",
                got.getMsgPermissionsMap().get("/qorechain.abstractaccount.v1.MsgExecuteEVM"));
        assertTrue(
                got.getKeyManagementMsgsList()
                        .contains("/qorechain.abstractaccount.v1.MsgRegisterAuthenticator"));
        assertEquals(
                List.of("/qorechain.abstractaccount.v1.Query/PermissionSchema"), abciPaths);
    }

    // ---- error-code decoding (abstractaccount 5/6/10/11, pqc 21) ----

    @Test
    void decodeAbstractAccountErrorCodes() {
        assertEquals(
                "spending_limit_exceeded",
                TxError.decode(5, "abstractaccount", "over limit", "H1").kind);
        assertEquals(
                "session_expired", TxError.decode(6, "abstractaccount", "", "H2").kind);
        assertEquals(
                "permission_denied",
                TxError.decode(10, "abstractaccount", "no evm perm", "H3").kind);
        assertEquals(
                "replay_detected",
                TxError.decode(11, "abstractaccount", "bad nonce", "H4").kind);
    }

    @Test
    void decodePqcErrorCode() {
        TxError.QoreTxException ex = TxError.decode(21, "pqc", "bad sig", "H5");
        assertEquals("pqc_signature_invalid", ex.kind);
        assertEquals("pqc", ex.codespace);
        assertEquals(21, ex.code);
    }

    @Test
    void unknownModuleCodeFallsBackToGenericKind() {
        // abstractaccount code with no mapping → generic "<codespace>_<code>" kind.
        assertEquals(
                "abstractaccount_99",
                TxError.decode(99, "abstractaccount", "weird", "H6").kind);
        // sdk codespace is unaffected by the module maps.
        assertEquals("insufficient_funds", TxError.decode(5, "sdk", "", "H7").kind);
    }

    // ---- rotate-from-mnemonic (dual-signed) ----

    @Test
    void rotatePqcKeyMsgFromMnemonicDualSigned() throws Exception {
        String account = UnifiedAccounts.deriveUnifiedAccount(MNEMONIC, 0).cosmos;

        Authenticator.RotationResult r =
                Authenticator.rotatePqcKeyMsgFromMnemonic(account, MNEMONIC, "qorechain-diana");

        assertEquals("/qorechain.pqc.v1.MsgRotatePQCKey", r.msg.typeUrl);

        // Legacy = shake256(mnemonic); canonical = the SDK address-bound derivation.
        assertArrayEquals(
                Authenticator.derivePqcLegacy(MNEMONIC).publicKey, r.oldKeypair.publicKey);
        assertArrayEquals(
                UnifiedAccounts.deriveUnifiedAccount(MNEMONIC, 0).pqc.publicKey,
                r.newKeypair.publicKey);
        // The two derivations differ (rotation is not a no-op).
        assertNotEquals(
                Hex.encode(r.oldKeypair.publicKey), Hex.encode(r.newKeypair.publicKey));

        Any any = Messages.pack(r.msg);
        Message decoded = Messages.unpack(any);
        assertTrue(decoded instanceof qorechain.pqc.v1.Tx.MsgRotatePQCKey);
        qorechain.pqc.v1.Tx.MsgRotatePQCKey m = (qorechain.pqc.v1.Tx.MsgRotatePQCKey) decoded;
        assertEquals(account, m.getSender());

        byte[] signBytes =
                Authenticator.rotationSignBytes(
                                "qorechain-diana",
                                1,
                                account,
                                r.oldKeypair.publicKey,
                                r.newKeypair.publicKey)
                        .getBytes(StandardCharsets.UTF_8);

        // Both signatures verify against their respective public keys.
        assertTrue(
                Pqc.pqcVerify(
                        m.getOldPublicKey().toByteArray(),
                        signBytes,
                        m.getOldSignature().toByteArray()));
        assertTrue(
                Pqc.pqcVerify(
                        m.getNewPublicKey().toByteArray(),
                        signBytes,
                        m.getNewSignature().toByteArray()));
        // A signature does NOT verify under the other key.
        assertFalse(
                Pqc.pqcVerify(
                        m.getNewPublicKey().toByteArray(),
                        signBytes,
                        m.getOldSignature().toByteArray()));
    }
}
