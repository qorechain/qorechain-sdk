package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.SpendingRules;
import io.github.qorechain.messages.TypedMessage;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import qorechain.abstractaccount.v1.Tx.DenomLimit;
import qorechain.abstractaccount.v1.Tx.MsgUpdateSpendingRules;
import qorechain.abstractaccount.v1.Tx.SpendingRule;

/** Spending rules: an enabled rule must bound something; checks run in the composer. */
class SpendingRulesTest {

    private static final String OWNER = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";

    private static TypedMessage msg(SpendingRule... rules) {
        return QorechainMessages.abstractaccount.updateSpendingRules(MsgUpdateSpendingRules.newBuilder()
                .setOwner(OWNER)
                .setAccountAddress(OWNER)
                .addAllRules(List.of(rules))
                .build());
    }

    private static SpendingRule.Builder enabled() {
        return SpendingRule.newBuilder().setEnabled(true);
    }

    private static DenomLimit limit(String denom, String perTx, String daily) {
        return DenomLimit.newBuilder().setDenom(denom).setPerTxLimit(perTx).setDailyLimit(daily).build();
    }

    private static void assertRefused(String fragment, Runnable r) {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class, r::run);
        assertTrue(e.getMessage().contains(fragment), e.getMessage());
    }

    @Test
    void refusesAnEnabledRuleWithNoBoundAtAll() {
        assertRefused("bounds nothing", () -> msg(enabled().build()));
    }

    @Test
    void refusesADenomLimitWithEmptyOrZeroAmounts() {
        String[][] amounts = {{"", ""}, {"0", "0"}, {"00", ""}};
        for (String[] a : amounts) {
            DenomLimit dl = limit("uqor", a[0], a[1]);
            assertRefused("would remove the limit for uqor", () -> msg(enabled().addDenomLimits(dl).build()));
            // Also inside a rule bounded otherwise: the entry replaces the rule-level limits for uqor.
            assertRefused("would remove the limit for uqor",
                    () -> msg(enabled().setDailyLimit(100).addDenomLimits(dl).build()));
        }
    }

    @Test
    void acceptsRealBounds() {
        assertDoesNotThrow(() -> msg(enabled().setDailyLimit(5).build()));
        assertDoesNotThrow(() -> msg(enabled().addDenomLimits(limit("uqor", "", "5")).build()));
        assertDoesNotThrow(() -> msg(enabled().addAllowedDenoms("uqor").build()));
        assertDoesNotThrow(() -> msg(enabled().addAllowedEvmCalls("0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B").build()));
        assertDoesNotThrow(() -> msg(enabled().setDailyLimit(100).addDenomLimits(limit("uqor", "7", "")).build()));
        // A disabled rule bounds nothing by design.
        assertDoesNotThrow(() -> msg(SpendingRule.newBuilder().setEnabled(false).build()));
        TypedMessage m = msg(enabled().setPerTxLimit(1).build());
        assertEquals("/qorechain.abstractaccount.v1.MsgUpdateSpendingRules", m.typeUrl);
    }

    @Test
    void checksAmountsDenomsAndCountsLikeTheChain() {
        assertRefused("non-negative",
                () -> SpendingRules.validate(List.of(SpendingRule.newBuilder().setDailyLimit(-1).build())));
        assertRefused("non-negative",
                () -> SpendingRules.validate(List.of(SpendingRule.newBuilder().setPerTxLimit(-1).build())));
        assertRefused("non-negative decimal",
                () -> SpendingRules.validate(List.of(enabled().addDenomLimits(limit("uqor", "", "-5")).build())));
        assertRefused("non-negative decimal",
                () -> SpendingRules.validate(List.of(enabled().addDenomLimits(limit("uqor", "", "1.5")).build())));
        assertRefused("no denom",
                () -> SpendingRules.validate(List.of(enabled().addDenomLimits(limit(" ", "", "1")).build())));
        assertRefused("contains whitespace",
                () -> SpendingRules.validate(List.of(enabled().addDenomLimits(limit("u qor", "", "1")).build())));
        assertRefused("too long",
                () -> SpendingRules.validate(List.of(enabled().addDenomLimits(limit("u".repeat(257), "", "1")).build())));
        assertRefused("more than one limit",
                () -> SpendingRules.validate(List.of(enabled()
                        .addDenomLimits(limit("uqor", "", "1"))
                        .addDenomLimits(limit("UQOR", "1", ""))
                        .build())));
        List<DenomLimit> many = new ArrayList<>();
        for (int i = 0; i <= SpendingRules.MAX_DENOM_LIMITS; i++) many.add(limit("d" + i, "", "1"));
        assertRefused("at most 64",
                () -> SpendingRules.validate(List.of(enabled().addAllDenomLimits(many).build())));
        List<String> calls = new ArrayList<>();
        for (int i = 0; i <= SpendingRules.MAX_ALLOWED_EVM_CALLS; i++) calls.add("0x" + i);
        assertRefused("at most 64 allowed EVM calls",
                () -> SpendingRules.validate(List.of(enabled().addAllAllowedEvmCalls(calls).build())));
        // The error names the offending rule by index.
        assertRefused("spending rule 1",
                () -> SpendingRules.validate(List.of(enabled().setDailyLimit(1).build(), enabled().build())));
    }
}
