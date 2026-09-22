package tx

import (
	"errors"
	"strings"
)

// EVMWindowIssue is the classification of an EVM-lane refusal that concerns the
// post-quantum authorisation window (chain v3.2.0). From that release an EVM
// transaction is admitted only from an account that has BOTH a registered
// post-quantum key AND an open, unexhausted window.
type EVMWindowIssue string

const (
	// EVMWindowIssueNone means the error is not an authorisation-window refusal.
	EVMWindowIssueNone EVMWindowIssue = ""
	// EVMWindowIssueNoWindow is pqc code 26: the account has no open window.
	EVMWindowIssueNoWindow EVMWindowIssue = "no_window"
	// EVMWindowIssueExhausted is pqc code 27: the window ran out of
	// transactions, value or blocks.
	EVMWindowIssueExhausted EVMWindowIssue = "window_exhausted"
	// EVMWindowIssueInvalid is pqc code 28 for a window the chain cannot use
	// (expired or malformed).
	EVMWindowIssueInvalid EVMWindowIssue = "invalid_window"
	// EVMWindowIssueNoPQCKey is pqc code 28 for the OTHER state it carries: the
	// account has no registered post-quantum key. It is its own state because
	// the remedy is different — register a key first; a window cannot be opened
	// (let alone used) without one.
	EVMWindowIssueNoPQCKey EVMWindowIssue = "no_pqc_key"
)

// ABCI codes in the `pqc` codespace that the EVM authorisation window uses.
const (
	PQCCodeNoEVMWindow        uint32 = 26
	PQCCodeEVMWindowExhausted uint32 = 27
	PQCCodeInvalidEVMWindow   uint32 = 28
)

// Remedy is the one-line action that clears the issue. It is the text a wallet
// can show next to the refusal; there is deliberately no automatic recovery,
// because opening a window is an explicit authorisation the user makes.
func (i EVMWindowIssue) Remedy() string {
	switch i {
	case EVMWindowIssueNoWindow:
		return "open an EVM authorisation window first: send MsgOpenEVMWindow on the Cosmos lane (hybrid-signed with the account's post-quantum key), then read the nonce, then sign the EVM transaction"
	case EVMWindowIssueExhausted:
		return "the window ran out of transactions, value or blocks: open a new one with MsgOpenEVMWindow (opening replaces the old window), then re-read the nonce"
	case EVMWindowIssueInvalid:
		return "the window is expired or unusable: open a new one with MsgOpenEVMWindow, then re-read the nonce"
	case EVMWindowIssueNoPQCKey:
		return "the account has no registered post-quantum key: register one (MsgRegisterPQCKeyV2) before opening an EVM authorisation window"
	default:
		return ""
	}
}

// ClassifyEVMWindowFailure classifies a refusal from its ABCI (code, codespace)
// pair plus whatever text came with it. Over the EVM JSON-RPC the refusal does
// not arrive as an ABCI triple at all — it is a broadcast error carrying the
// chain's own message — so pass code 0 and an empty codespace with the text and
// the text alone decides.
func ClassifyEVMWindowFailure(code uint32, codespace, text string) EVMWindowIssue {
	lower := strings.ToLower(text)
	if codespace == "pqc" {
		switch code {
		case PQCCodeNoEVMWindow:
			return EVMWindowIssueNoWindow
		case PQCCodeEVMWindowExhausted:
			return EVMWindowIssueExhausted
		case PQCCodeInvalidEVMWindow:
			// Code 28 carries two states; the text separates them.
			if mentionsMissingPQCKey(lower) {
				return EVMWindowIssueNoPQCKey
			}
			return EVMWindowIssueInvalid
		}
	}
	return classifyEVMWindowText(lower)
}

// ClassifyEVMWindowError classifies any error. A *QoreTxError is classified on
// its codespace/code first (with its raw log as the text); anything else — a
// broadcast error from the EVM JSON-RPC lane, for instance — is classified on
// its message. A non-matching error returns EVMWindowIssueNone.
func ClassifyEVMWindowError(err error) EVMWindowIssue {
	if err == nil {
		return EVMWindowIssueNone
	}
	var txErr *QoreTxError
	if errors.As(err, &txErr) {
		text := txErr.RawLog
		if text == "" {
			text = txErr.Error()
		}
		return ClassifyEVMWindowFailure(txErr.Code, txErr.Codespace, text)
	}
	return classifyEVMWindowText(strings.ToLower(err.Error()))
}

// IsEVMWindowError reports whether err is any of the authorisation-window
// refusals.
func IsEVMWindowError(err error) bool {
	return ClassifyEVMWindowError(err) != EVMWindowIssueNone
}

func mentionsMissingPQCKey(lower string) bool {
	return strings.Contains(lower, "no registered post-quantum key") ||
		strings.Contains(lower, "no registered pqc key")
}

// classifyEVMWindowText matches the chain's own refusal texts, which is what an
// EVM JSON-RPC broadcast error carries instead of a codespace.
func classifyEVMWindowText(lower string) EVMWindowIssue {
	if lower == "" {
		return EVMWindowIssueNone
	}
	if mentionsMissingPQCKey(lower) {
		return EVMWindowIssueNoPQCKey
	}
	if !mentionsEVMWindow(lower) {
		return EVMWindowIssueNone
	}
	switch {
	case strings.Contains(lower, "no open"):
		return EVMWindowIssueNoWindow
	case strings.Contains(lower, "exhausted"):
		return EVMWindowIssueExhausted
	case strings.Contains(lower, "expired"), strings.Contains(lower, "invalid"):
		return EVMWindowIssueInvalid
	default:
		return EVMWindowIssueNone
	}
}

// mentionsEVMWindow accepts both spellings of the chain's phrase ("authorisation"
// in the chain text, "authorization" in case a node localises it) and the bare
// message name.
func mentionsEVMWindow(lower string) bool {
	if strings.Contains(lower, "msgopenevmwindow") {
		return true
	}
	if !strings.Contains(lower, "window") {
		return false
	}
	return strings.Contains(lower, "evm authorisation") ||
		strings.Contains(lower, "evm authorization") ||
		strings.Contains(lower, "evm window")
}
