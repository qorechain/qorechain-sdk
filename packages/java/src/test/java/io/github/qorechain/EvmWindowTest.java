package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.protobuf.Any;
import io.github.qorechain.evm.EvmWindow;
import io.github.qorechain.evm.EvmWindowIssue;
import io.github.qorechain.evm.EvmWindowStatus;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.tx.TxError;
import java.math.BigInteger;
import org.junit.jupiter.api.Test;

/**
 * The EVM authorisation window (chain v3.2.0): composer round-trip, the
 * ValidateBasic bounds, both query shapes and the error classifier.
 */
class EvmWindowTest {

    private static final String SENDER = "qor1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5tfman7";

    private static final String CHAIN_NO_WINDOW_TEXT =
            "account "
                    + SENDER
                    + " has no open EVM authorisation window; open one with MsgOpenEVMWindow,"
                    + " signed on the Cosmos lane with the account's post-quantum key";

    private static final String CHAIN_NO_KEY_TEXT =
            "account " + SENDER + " has no registered post-quantum key";

    // ---- composers ----

    @Test
    void openWindowRoundTripsThroughTheRegistry() throws Exception {
        TypedMessage tm = EvmWindow.open(SENDER, 300, 5, "2000000");
        assertEquals("/qorechain.pqc.v1.MsgOpenEVMWindow", tm.typeUrl);

        Any any = Messages.pack(tm);
        assertEquals("/qorechain.pqc.v1.MsgOpenEVMWindow", any.getTypeUrl());
        assertEquals(tm.message.toByteString(), any.getValue());

        qorechain.pqc.v1.Tx.MsgOpenEVMWindow decoded =
                (qorechain.pqc.v1.Tx.MsgOpenEVMWindow) Messages.unpack(any);
        assertEquals(SENDER, decoded.getSender());
        assertEquals(300L, decoded.getBlocks());
        assertEquals(5L, decoded.getMaxTxs());
        assertEquals("2000000", decoded.getMaxValue());
    }

    @Test
    void closeWindowRoundTripsThroughTheRegistry() throws Exception {
        TypedMessage tm = EvmWindow.close(SENDER);
        assertEquals("/qorechain.pqc.v1.MsgCloseEVMWindow", tm.typeUrl);

        Any any = Messages.pack(tm);
        assertEquals(tm.message.toByteString(), any.getValue());
        qorechain.pqc.v1.Tx.MsgCloseEVMWindow decoded =
                (qorechain.pqc.v1.Tx.MsgCloseEVMWindow) Messages.unpack(any);
        assertEquals(SENDER, decoded.getSender());
    }

    // ---- validation ----

    @Test
    void boundsAreRefusedWithAMessageNamingTheBound() {
        assertTrue(refusal(0, 5, "1000").contains("blocks must be between 1 and 17280"));
        assertTrue(refusal(17281, 5, "1000").contains("blocks must be between 1 and 17280"));
        assertTrue(refusal(300, 0, "1000").contains("max_txs must be between 1 and 1000"));
        assertTrue(refusal(300, 1001, "1000").contains("max_txs must be between 1 and 1000"));
        assertTrue(refusal(300, 5, "0").contains("max_value must be greater than 0 uqor"));
        assertTrue(refusal(300, 5, "-1").contains("max_value must be greater than 0 uqor"));
        assertTrue(refusal(300, 5, "").contains("max_value is required"));
        assertTrue(refusal(300, 5, "1.5").contains("not an integer amount of uqor"));
    }

    @Test
    void boundsThemselvesAreAccepted() {
        assertEquals(1L, EvmWindow.openMessage(SENDER, 1, 1, "1").getBlocks());
        qorechain.pqc.v1.Tx.MsgOpenEVMWindow max =
                EvmWindow.openMessage(SENDER, EvmWindow.MAX_BLOCKS, EvmWindow.MAX_TXS, "1");
        assertEquals(17280L, max.getBlocks());
        assertEquals(1000L, max.getMaxTxs());
    }

    @Test
    void senderIsRequiredAndMustBeAQorAddress() {
        assertTrue(
                assertThrows(IllegalArgumentException.class, () -> EvmWindow.open("", 300, 5, "1000"))
                        .getMessage()
                        .contains("sender is required"));
        assertTrue(
                assertThrows(
                                IllegalArgumentException.class,
                                () -> EvmWindow.open("qor1nope", 300, 5, "1000"))
                        .getMessage()
                        .contains("not a valid qor bech32 address"));
        assertTrue(
                assertThrows(IllegalArgumentException.class, () -> EvmWindow.close("cosmos1xyz"))
                        .getMessage()
                        .contains("not a valid qor bech32 address"));
    }

    private static String refusal(long blocks, long maxTxs, String maxValue) {
        return assertThrows(
                        IllegalArgumentException.class,
                        () -> EvmWindow.open(SENDER, blocks, maxTxs, maxValue))
                .getMessage();
    }

    // ---- query ----

    @Test
    void parsesTheAbsentShape() {
        EvmWindowStatus s = EvmWindowStatus.parse("{\"found\":false}");
        assertFalse(s.found);
        assertFalse(s.live);
        assertFalse(s.exhausted(), "an absent window is not an exhausted window");
        assertEquals(BigInteger.ZERO, s.maxValue);
        assertEquals(BigInteger.ZERO, s.usedValue);
        assertEquals(BigInteger.ZERO, s.remainingValue);
        assertEquals(0L, s.remainingTxs);
    }

    @Test
    void parsesTheLiveShape() {
        EvmWindowStatus s =
                EvmWindowStatus.parse(
                        "{\"found\":true,\"live\":true,\"opened_height\":\"6069608\","
                                + "\"expiry_height\":\"6069908\",\"max_txs\":\"5\",\"used_txs\":\"1\","
                                + "\"max_value\":\"2000000\",\"used_value\":\"3363\","
                                + "\"remaining_blocks\":\"286\",\"remaining_txs\":\"4\","
                                + "\"remaining_value\":\"1996637\"}");
        assertTrue(s.found);
        assertTrue(s.live);
        assertEquals(6069608L, s.openedHeight);
        assertEquals(6069908L, s.expiryHeight);
        assertEquals(5L, s.maxTxs);
        assertEquals(1L, s.usedTxs);
        assertEquals(new BigInteger("2000000"), s.maxValue);
        assertEquals(new BigInteger("3363"), s.usedValue);
        assertEquals(286L, s.remainingBlocks);
        assertEquals(4L, s.remainingTxs);
        assertEquals(new BigInteger("1996637"), s.remainingValue);
        assertFalse(s.exhausted());
    }

    @Test
    void keepsBigNumbersExact() {
        // 2^53 + 1 and a value far beyond any 64-bit type: a float64 decode would
        // truncate both.
        EvmWindowStatus s =
                EvmWindowStatus.parse(
                        "{\"found\":true,\"live\":false,\"opened_height\":\"9007199254740993\","
                                + "\"expiry_height\":\"9007199254740995\",\"max_txs\":\"1000\","
                                + "\"used_txs\":\"1000\",\"max_value\":\"123456789012345678901234567890\","
                                + "\"used_value\":\"123456789012345678901234567890\","
                                + "\"remaining_blocks\":\"2\",\"remaining_txs\":\"0\","
                                + "\"remaining_value\":\"0\"}");
        assertEquals(9007199254740993L, s.openedHeight);
        assertEquals(9007199254740995L, s.expiryHeight);
        assertEquals(new BigInteger("123456789012345678901234567890"), s.maxValue);
        assertEquals(new BigInteger("123456789012345678901234567890"), s.usedValue);
        assertTrue(s.exhausted(), "a found-but-not-live window is exhausted");
    }

    @Test
    void acceptsBareNumbersAndRefusesGarbage() {
        EvmWindowStatus s =
                EvmWindowStatus.parse("{\"found\":true,\"live\":true,\"max_txs\":5,\"max_value\":2000000}");
        assertEquals(5L, s.maxTxs);
        assertEquals(new BigInteger("2000000"), s.maxValue);

        assertThrows(
                IllegalArgumentException.class,
                () -> EvmWindowStatus.parse("{\"found\":true,\"max_value\":\"1.5\"}"));
        assertThrows(
                IllegalArgumentException.class,
                () -> EvmWindowStatus.parse("{\"found\":true,\"max_txs\":\"many\"}"));
    }

    @Test
    void adaptsTheProtobufAnswer() {
        EvmWindowStatus s =
                EvmWindowStatus.of(
                        qorechain.pqc.v1.QueryOuterClass.QueryEVMWindowResponse.newBuilder()
                                .setFound(true)
                                .setLive(true)
                                .setMaxTxs(5)
                                .setMaxValue("2000000")
                                .setRemainingValue("1996637")
                                .build());
        assertTrue(s.found);
        assertEquals(new BigInteger("1996637"), s.remainingValue);
        // An unset cosmos.Int string is zero, not a parse failure.
        assertEquals(BigInteger.ZERO, s.usedValue);
    }

    @Test
    void restPathIsTheDocumentedRoute() {
        assertEquals("/qorechain/pqc/v1/evm_window/" + SENDER, EvmWindow.restPath(SENDER));
    }

    // ---- error classification ----

    @Test
    void classifiesTheThreePqcCodes() {
        assertEquals(
                EvmWindowIssue.NO_WINDOW, EvmWindowIssue.classify(26, "pqc", CHAIN_NO_WINDOW_TEXT));
        assertEquals(EvmWindowIssue.NO_WINDOW, EvmWindowIssue.classify(26, "pqc", ""));
        assertEquals(
                EvmWindowIssue.EXHAUSTED,
                EvmWindowIssue.classify(27, "pqc", "EVM authorisation window exhausted"));
        assertEquals(
                EvmWindowIssue.INVALID,
                EvmWindowIssue.classify(28, "pqc", "invalid EVM authorisation window"));
        assertEquals(EvmWindowIssue.NO_PQC_KEY, EvmWindowIssue.classify(28, "pqc", CHAIN_NO_KEY_TEXT));
        // Not a window issue.
        assertEquals(
                EvmWindowIssue.NONE,
                EvmWindowIssue.classify(21, "pqc", "hybrid PQC signature verification failed"));
        assertEquals(
                EvmWindowIssue.NONE,
                EvmWindowIssue.classify(26, "sdk", "unpacking protobuf message failed"));
    }

    @Test
    void classifiesTheChainTextsOverJsonRpc() {
        assertEquals(
                EvmWindowIssue.NO_WINDOW,
                EvmWindowIssue.classify(new RuntimeException(CHAIN_NO_WINDOW_TEXT)));
        assertEquals(
                EvmWindowIssue.NO_PQC_KEY, EvmWindowIssue.classify(new RuntimeException(CHAIN_NO_KEY_TEXT)));
        assertEquals(
                EvmWindowIssue.NO_WINDOW,
                EvmWindowIssue.classify(
                        new RuntimeException("broadcast failed", new RuntimeException(CHAIN_NO_WINDOW_TEXT))));
        assertEquals(
                EvmWindowIssue.EXHAUSTED,
                EvmWindowIssue.classify(new RuntimeException("EVM authorisation window exhausted")));
        assertEquals(
                EvmWindowIssue.INVALID,
                EvmWindowIssue.classify(
                        new RuntimeException("EVM authorisation window expired at height 6069908")));
        assertEquals(
                EvmWindowIssue.NO_WINDOW,
                EvmWindowIssue.classify(
                        new RuntimeException("account qor1abc has no open EVM authorization window")));
    }

    @Test
    void doesNotMatchUnrelatedErrors() {
        assertEquals(
                EvmWindowIssue.NONE,
                EvmWindowIssue.classify(new RuntimeException("insufficient funds: 10uqor < 20uqor")));
        assertEquals(
                EvmWindowIssue.NONE,
                EvmWindowIssue.classify(new RuntimeException("nonce too low: next nonce 3, tx nonce 2")));
        assertEquals(EvmWindowIssue.NONE, EvmWindowIssue.classify((Throwable) null));
        assertFalse(EvmWindowIssue.isWindowError(new RuntimeException("out of gas")));
    }

    @Test
    void classifiesADecodedAbciFailure() {
        TxError.QoreTxException err = TxError.decode(26, "pqc", CHAIN_NO_WINDOW_TEXT, "ABC123");
        assertEquals("evm_window_missing", err.kind);
        assertEquals(EvmWindowIssue.NO_WINDOW, EvmWindowIssue.classify(err));
        assertTrue(EvmWindowIssue.isWindowError(err));

        assertEquals(
                EvmWindowIssue.NO_PQC_KEY,
                EvmWindowIssue.classify(TxError.decode(28, "pqc", CHAIN_NO_KEY_TEXT, "")));
        assertEquals(
                EvmWindowIssue.EXHAUSTED, EvmWindowIssue.classify(TxError.decode(27, "pqc", "", "")));
        assertEquals(
                EvmWindowIssue.NONE,
                EvmWindowIssue.classify(TxError.decode(5, "sdk", "insufficient funds", "")));
    }

    @Test
    void everyIssueNamesItsOwnRemedy() {
        for (EvmWindowIssue issue :
                new EvmWindowIssue[] {
                    EvmWindowIssue.NO_WINDOW,
                    EvmWindowIssue.EXHAUSTED,
                    EvmWindowIssue.INVALID,
                    EvmWindowIssue.NO_PQC_KEY
                }) {
            assertFalse(issue.remedy().isEmpty(), issue + " has no remedy");
        }
        assertEquals("", EvmWindowIssue.NONE.remedy());
        assertNotEquals(EvmWindowIssue.NO_WINDOW.remedy(), EvmWindowIssue.NO_PQC_KEY.remedy());
    }
}
