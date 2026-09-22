package io.github.qorechain.evm;

import io.github.qorechain.tx.TxError;
import java.util.Locale;

/**
 * Classification of an EVM-lane refusal that concerns the post-quantum
 * authorisation window (chain v3.2.0), in the {@code pqc} codespace: 26 no
 * window, 27 exhausted, 28 invalid window <em>or</em> no registered
 * post-quantum key.
 *
 * <p>Over the EVM JSON-RPC lane the refusal does not arrive as an ABCI triple at
 * all — it is a broadcast error carrying the chain's own text — so the
 * classifier matches on the text too.
 */
public enum EvmWindowIssue {
    /** Not an authorisation-window refusal. */
    NONE(""),
    /** {@code pqc} 26: the account has no open window. */
    NO_WINDOW(
            "open an EVM authorisation window first: send MsgOpenEVMWindow on the Cosmos lane"
                    + " (hybrid-signed with the account's post-quantum key), then read the nonce,"
                    + " then sign the EVM transaction"),
    /** {@code pqc} 27: the window ran out of transactions, value or blocks. */
    EXHAUSTED(
            "the window ran out of transactions, value or blocks: open a new one with"
                    + " MsgOpenEVMWindow (opening replaces the old window), then re-read the nonce"),
    /** {@code pqc} 28: the window is expired or otherwise unusable. */
    INVALID(
            "the window is expired or unusable: open a new one with MsgOpenEVMWindow, then"
                    + " re-read the nonce"),
    /**
     * The other state {@code pqc} 28 carries: the account has no registered
     * post-quantum key. It is its own state because the remedy differs — a key
     * must be registered before a window can be opened, let alone used.
     */
    NO_PQC_KEY(
            "the account has no registered post-quantum key: register one"
                    + " (MsgRegisterPQCKeyV2) before opening an EVM authorisation window");

    /** ABCI codes in the {@code pqc} codespace used by the window. */
    public static final int CODE_NO_WINDOW = 26;

    public static final int CODE_EXHAUSTED = 27;
    public static final int CODE_INVALID = 28;

    private final String remedy;

    EvmWindowIssue(String remedy) {
        this.remedy = remedy;
    }

    /**
     * The one-line action that clears the issue — the text a wallet can show next
     * to the refusal. There is deliberately no automatic recovery: opening a
     * window is an explicit authorisation the user makes.
     */
    public String remedy() {
        return remedy;
    }

    /**
     * Classify a refusal from its ABCI {@code (code, codespace)} pair plus
     * whatever text came with it. For a JSON-RPC broadcast error pass code 0 and
     * a null codespace: the text alone then decides.
     */
    public static EvmWindowIssue classify(int code, String codespace, String text) {
        String lower = text == null ? "" : text.toLowerCase(Locale.ROOT);
        if ("pqc".equals(codespace)) {
            switch (code) {
                case CODE_NO_WINDOW:
                    return NO_WINDOW;
                case CODE_EXHAUSTED:
                    return EXHAUSTED;
                case CODE_INVALID:
                    // Code 28 carries two states; the text separates them.
                    return mentionsMissingKey(lower) ? NO_PQC_KEY : INVALID;
                default:
                    break;
            }
        }
        return classifyText(lower);
    }

    /**
     * Classify any throwable. A {@link TxError.QoreTxException} is classified on
     * its codespace/code first (with its raw log as the text); anything else — a
     * broadcast error from the EVM JSON-RPC lane, for instance — on its message,
     * walking the cause chain. A non-matching error returns {@link #NONE}.
     */
    public static EvmWindowIssue classify(Throwable err) {
        for (Throwable t = err; t != null; t = t.getCause()) {
            if (t instanceof TxError.QoreTxException) {
                TxError.QoreTxException tx = (TxError.QoreTxException) t;
                String text = (tx.rawLog == null || tx.rawLog.isEmpty()) ? tx.getMessage() : tx.rawLog;
                EvmWindowIssue issue = classify(tx.code, tx.codespace, text);
                if (issue != NONE) {
                    return issue;
                }
                continue;
            }
            String message = t.getMessage();
            if (message != null) {
                EvmWindowIssue issue = classifyText(message.toLowerCase(Locale.ROOT));
                if (issue != NONE) {
                    return issue;
                }
            }
        }
        return NONE;
    }

    /** Whether the error is any of the authorisation-window refusals. */
    public static boolean isWindowError(Throwable err) {
        return classify(err) != NONE;
    }

    private static boolean mentionsMissingKey(String lower) {
        return lower.contains("no registered post-quantum key") || lower.contains("no registered pqc key");
    }

    /** Matches the chain's own refusal texts, which is what a JSON-RPC error carries. */
    private static EvmWindowIssue classifyText(String lower) {
        if (lower.isEmpty()) {
            return NONE;
        }
        if (mentionsMissingKey(lower)) {
            return NO_PQC_KEY;
        }
        if (!mentionsWindow(lower)) {
            return NONE;
        }
        if (lower.contains("no open")) {
            return NO_WINDOW;
        }
        if (lower.contains("exhausted")) {
            return EXHAUSTED;
        }
        if (lower.contains("expired") || lower.contains("invalid")) {
            return INVALID;
        }
        return NONE;
    }

    private static boolean mentionsWindow(String lower) {
        if (lower.contains("msgopenevmwindow")) {
            return true;
        }
        if (!lower.contains("window")) {
            return false;
        }
        return lower.contains("evm authorisation")
                || lower.contains("evm authorization")
                || lower.contains("evm window");
    }
}
