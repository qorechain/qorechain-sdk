package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.qorechain.tx.GasPrice;
import io.github.qorechain.tx.StdFee;
import io.github.qorechain.tx.TxError;
import org.junit.jupiter.api.Test;

/** Gas-price fee math (integer-exact) and ABCI error decoding. */
class TxHelpersTest {

    @Test
    void calculateFeeCeilingExact() {
        StdFee fee = GasPrice.calculateFee(200000, "0.025uqor");
        assertEquals("uqor", fee.amount.get(0).denom);
        assertEquals("5000", fee.amount.get(0).amount); // 200000 * 0.025 = 5000
        assertEquals("200000", fee.gas);

        // Ceiling: 200001 * 0.025 = 5000.025 -> 5001
        assertEquals("5001", GasPrice.calculateFee(200001, "0.025uqor").amount.get(0).amount);
    }

    @Test
    void gasMultiplier() {
        assertEquals(280000L, GasPrice.applyMultiplier(200000, 1.4));
    }

    @Test
    void decodeKnownSdkError() {
        TxError.QoreTxException e = TxError.decode(5, "sdk", "not enough", "ABC123");
        assertEquals("insufficient_funds", e.kind);
        assertEquals(5, e.code);
        assertEquals("sdk", e.codespace);
        org.junit.jupiter.api.Assertions.assertTrue(e.getMessage().contains("insufficient funds"));
        org.junit.jupiter.api.Assertions.assertTrue(e.getMessage().contains("ABC123"));
    }

    @Test
    void decodeUnknownCodespace() {
        TxError.QoreTxException e = TxError.decode(7, "pqc", "bad key", "H");
        assertEquals("pqc_7", e.kind);
        org.junit.jupiter.api.Assertions.assertTrue(e.getMessage().contains("module \"pqc\""));
    }
}
