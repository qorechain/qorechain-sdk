package tx

import (
	"fmt"
	"strings"
)

// QoreTxError is a decoded transaction error: a non-zero ABCI result code from
// CheckTx or DeliverTx, mapped (where possible) to a human-readable reason.
type QoreTxError struct {
	// Code is the non-zero ABCI result code.
	Code uint32
	// Codespace is the module that produced the error (e.g. "sdk", "bank",
	// "amm"). Empty codespace means the root SDK codespace.
	Codespace string
	// Reason is the mapped human-readable description, or "unknown error" if the
	// (codespace, code) pair is not recognized.
	Reason string
	// RawLog is the chain's raw_log string for the failed tx (may be empty).
	RawLog string
	// TxHash is the failed tx hash, when known.
	TxHash string
}

func (e *QoreTxError) Error() string {
	cs := e.Codespace
	if cs == "" {
		cs = "sdk"
	}
	msg := fmt.Sprintf("tx failed: code %d (%s/%s)", e.Code, cs, e.Reason)
	if e.TxHash != "" {
		msg += " tx " + e.TxHash
	}
	if e.RawLog != "" {
		msg += ": " + e.RawLog
	}
	return msg
}

// sdkErrorReasons maps the well-known root ("sdk") codespace ABCI codes to their
// canonical descriptions (cosmossdk.io/errors registrations).
var sdkErrorReasons = map[uint32]string{
	1:  "internal error",
	2:  "tx parse error",
	3:  "invalid sequence",
	4:  "unauthorized",
	5:  "insufficient funds",
	6:  "unknown request",
	7:  "invalid address",
	8:  "invalid pubkey",
	9:  "unknown address",
	10: "invalid coins",
	11: "out of gas",
	12: "memo too large",
	13: "insufficient fee",
	14: "maximum number of signatures exceeded",
	15: "no signatures supplied",
	16: "failed to marshal JSON bytes",
	17: "failed to unmarshal JSON bytes",
	18: "invalid request",
	19: "tx already in mempool",
	20: "mempool is full",
	21: "tx too large",
	22: "key not found",
	23: "invalid account password",
	24: "invalid signature",
	25: "no concrete type registered",
	26: "unpacking protobuf message failed",
	27: "invalid gas adjustment",
	28: "invalid height",
	29: "invalid version",
	30: "invalid chain id",
	31: "invalid type",
	32: "tx timeout height",
	33: "unknown extension options",
	35: "invalid gas limit",
}

// moduleCodespaceReasons maps non-root module codespaces (Native + QoreChain) to
// their per-module code descriptions. Only codes the SDK surfaces commonly are
// enumerated; unmapped codes fall back to "unknown <codespace> error".
var moduleCodespaceReasons = map[string]map[uint32]string{
	"bank": {
		2: "no inputs to send transaction",
		3: "no outputs to send transaction",
		4: "sum inputs != sum outputs",
		5: "send transactions are disabled",
	},
	"staking": {
		2:  "validator does not exist",
		3:  "validator already exist for this operator address",
		13: "too many shares to undelegate",
		15: "insufficient delegation shares",
	},
	"distribution": {
		2: "no delegation distribution info",
		3: "no validator distribution info",
		6: "set withdraw address disabled",
	},
	"gov": {
		2: "unknown proposal",
		3: "inactive proposal",
		4: "already active proposal",
		5: "invalid proposal content",
	},
	"authz": {
		2: "authorization not found",
		3: "invalid expiration time",
	},
	"feegrant": {
		2: "fee limit exceeded",
		3: "fee allowance already exists",
		4: "fee allowance expired",
	},
	// QoreChain custom modules - enumerated codes plus generic per-module fallbacks.
	"pqc": {
		// 21: hybrid (classical + ML-DSA) signature verification failed.
		21: "hybrid verify failed",
		// 26-28: the EVM authorisation window (chain v3.2.0). Code 28 carries
		// two states - an unusable window and an account with no registered
		// post-quantum key; ClassifyEVMWindowError separates them on the text.
		26: "no open EVM authorisation window",
		27: "EVM authorisation window exhausted",
		28: "invalid EVM authorisation window, or no registered post-quantum key",
		// 60-61: EIP-7702 delegation consent (chain v3.2.2).
		60: "no post-quantum consent for this EIP-7702 delegation",
		61: "invalid EIP-7702 delegation request",
		// 230-234: registration integrity and key maintenance (chain v3.2.3).
		230: "PQC public key gives no post-quantum protection",
		231: "PQC proof of possession does not verify",
		232: "PQC key was used by this account before",
		233: "no active PQC signature algorithm would remain",
		234: "PQC key maintenance from a keyed account needs the hybrid signature",
		// 250-254: the KEM key registry (chain v3.2.5).
		250: "the KEM key registry is not enabled on this chain yet",
		251: "invalid KEM public key",
		252: "no KEM key published for this account",
		253: "this KEM key is already published for this account",
		254: "publishing a KEM key needs a registered post-quantum signature key",
	},
	"amm":        {},
	"bridge":     {},
	"rdk":        {},
	"multilayer": {},
	"svm":        {},
	"lightnode":  {},
	"license":    {},
	"abstractaccount": {
		// v3.1.85 authenticator-lane failures (MsgExecuteEVM / MsgExecuteCosmos).
		5: "spending limit exceeded",
		6: "session key expired",
		// 8: a rule refused when saved; from chain v3.2.5 this includes a rule
		// that bounds nothing and an EVM token denom whose address does not parse.
		8:  "invalid spending rule",
		9:  "abstract account module is disabled",
		10: "permission denied",
		// 11: the nonce is not the linked key's authenticator sequence (a
		// per-key counter, not the account's EVM nonce).
		11: "authenticator replay",
	},
	"crossvm":     {},
	"rlconsensus": {},
	// stakingtier (chain v3.2.4).
	"stakingtier": {
		2:  "invalid staking-tier parameters",
		3:  "staking tiers are not active on this network yet",
		4:  "staking tiers are switched off by governance",
		5:  "this lock term is not offered (see the module parameters)",
		6:  "invalid lock amount (below the minimum, or not positive)",
		7:  "not enough unlocked delegation to this validator to lock that amount",
		8:  "lock not found",
		9:  "the lock belongs to another delegator",
		10: "the lock has already expired; nothing to unlock early",
		11: "too many open locks for this delegator",
		12: "no bonus to claim",
		13: "this stake is locked; undelegating or redelegating it waits for the lock to end",
	},
}

// RegisteredError is one of the chain's registered error descriptions.
type RegisteredError struct {
	Codespace   string
	Code        uint32
	Description string
}

// RegisteredErrors are the chain's registered error descriptions, for refusals
// that arrive as text only: a failed simulation (EstimateGas / EstimateFee)
// reports the module's message but no code. Kept to the codespaces this package
// decodes; the same table as the TypeScript SDK.
var RegisteredErrors = []RegisteredError{
	{"sdk", 4, "unauthorized"},
	{"sdk", 5, "insufficient funds"},
	{"sdk", 11, "out of gas"},
	{"sdk", 13, "insufficient fee"},
	{"sdk", 19, "tx already in mempool"},
	{"sdk", 32, "incorrect account sequence"},
	{"pqc", 2, "PQC signature verification failed"},
	{"pqc", 6, "PQC account not found"},
	{"pqc", 7, "PQC account already registered"},
	{"pqc", 8, "classical fallback not allowed"},
	{"pqc", 20, "hybrid PQC signature required"},
	{"pqc", 21, "hybrid PQC signature verification failed"},
	{"pqc", 26, "no open EVM authorisation window"},
	{"pqc", 27, "EVM authorisation window exhausted"},
	{"pqc", 28, "invalid EVM authorisation window"},
	{"pqc", 45, "ecdsa_pubkey is not the signer's compressed secp256k1 key"},
	{"pqc", 60, "no post-quantum consent for this EIP-7702 delegation"},
	{"pqc", 61, "invalid EIP-7702 delegation request"},
	{"pqc", 231, "PQC proof of possession does not verify"},
	{"pqc", 250, "the KEM key registry is not enabled on this chain yet"},
	{"pqc", 251, "invalid KEM public key"},
	{"pqc", 252, "no KEM key published for this account"},
	{"pqc", 253, "this KEM key is already published for this account"},
	{"pqc", 254, "publishing a KEM key needs a registered post-quantum signature key"},
	{"abstractaccount", 2, "abstract account not found"},
	{"abstractaccount", 5, "spending limit exceeded"},
	{"abstractaccount", 6, "session key expired"},
	{"abstractaccount", 8, "invalid spending rule"},
	{"abstractaccount", 9, "abstract account module is disabled"},
	{"abstractaccount", 10, "authenticator not permitted for this action"},
	{"abstractaccount", 11, "authenticator signature replay binding mismatch"},
	{"stakingtier", 3, "staking tiers are not active on this chain yet"},
	{"stakingtier", 4, "staking tiers are disabled by governance"},
	{"stakingtier", 5, "lock term is not offered"},
	{"stakingtier", 6, "invalid lock amount"},
	{"stakingtier", 7, "not enough unlocked delegation"},
	{"stakingtier", 8, "lock not found"},
	{"stakingtier", 9, "lock belongs to another delegator"},
	{"stakingtier", 10, "lock has already expired"},
	{"stakingtier", 11, "too many open locks"},
	{"stakingtier", 12, "no bonus to claim"},
	{"stakingtier", 13, "stake is locked"},
}

// ErrorFromText returns the registered error a text-only refusal names: the
// longest description in RegisteredErrors that text contains (so "hybrid PQC
// signature verification failed" is pqc 21, not pqc 2). ok is false when it
// names none.
func ErrorFromText(text string) (e RegisteredError, ok bool) {
	for _, r := range RegisteredErrors {
		if strings.Contains(text, r.Description) && (!ok || len(r.Description) > len(e.Description)) {
			e, ok = r, true
		}
	}
	return e, ok
}

// DecodeTxError maps an ABCI (code, codespace, rawLog) triple to a *QoreTxError.
//
// A zero code returns nil (success), unless rawLog names a registered refusal:
// code 0 is success and returns nil. The codespace selects the code table: the empty / "sdk" codespace uses
// the root SDK table; a module codespace uses its per-module table, with a
// generic fallback when the specific code is unmapped.
func DecodeTxError(code uint32, codespace, rawLog string) *QoreTxError {
	if code == 0 {
		// Code 0 is success, whatever the log says. A refusal without a code
		// (a failed simulation) is named with DecodeRefusalText instead.
		return nil
	}
	reason := reasonFor(code, codespace)
	if r := pqcKeyRequirement(codespace, code, rawLog); r != "" {
		reason = r
	} else if isRateLimitLog(codespace, code, rawLog) {
		reason = RateLimitedReason
	}
	return &QoreTxError{
		Code:      code,
		Codespace: codespace,
		Reason:    reason,
		RawLog:    rawLog,
	}
}

// RateLimitedReason is the Reason of a refusal from the per-sender
// transaction rate limit. Wait and retry.
const RateLimitedReason = "rate limited"

// Reasons for pqc 8 / pqc 20, which cover two different remedies.
const (
	// PQCKeyRequiredReason: the account has no registered PQC key; register
	// one (MsgRegisterPQCKeyV2) before sending.
	PQCKeyRequiredReason = "PQC key required: register the account's PQC key first"
	// HybridSignatureRequiredReason: the account has a PQC key and sent no
	// hybrid extension; sign the transaction hybrid.
	HybridSignatureRequiredReason = "hybrid signature required: the account has a PQC key"
)

// pqcKeyRequirement tells pqc 8 / pqc 20 apart. pqc 8 is always an account
// without a PQC key (classical fallback disabled). pqc 20 is either a keyless
// account or a keyed account that sent no hybrid extension; only the text tells
// them apart. "" when it is neither.
func pqcKeyRequirement(codespace string, code uint32, rawLog string) string {
	if codespace != "pqc" || (code != 8 && code != 20) {
		return ""
	}
	lower := strings.ToLower(rawLog)
	if strings.Contains(lower, "has a registered pqc key and must include") {
		return HybridSignatureRequiredReason
	}
	if code == 8 || strings.Contains(lower, "has no registered pqc key") || strings.Contains(lower, "has no pqc key") ||
		strings.Contains(lower, "must include a pqc hybrid signature extension") {
		return PQCKeyRequiredReason
	}
	return ""
}

// isRateLimitLog recognises the per-sender rate limit (both lanes' ante
// handler): codespace "ai", code 3, text "sender <addr> has sent <n>
// transactions in the last 30 blocks, at the configured limit of <limit> per
// minute". Code 3 also carries other AI-engine rejections, so the text decides;
// a transport that drops the codespace (EVM JSON-RPC) is matched on the text.
func isRateLimitLog(codespace string, code uint32, rawLog string) bool {
	lower := strings.ToLower(rawLog)
	if !strings.Contains(lower, "transactions in the last") || !strings.Contains(lower, "per minute") {
		return false
	}
	return codespace == "" || (codespace == "ai" && code == 3)
}

func reasonFor(code uint32, codespace string) string {
	if codespace == "" || codespace == "sdk" {
		if reason, ok := sdkErrorReasons[code]; ok {
			return reason
		}
		return "unknown error"
	}
	if table, ok := moduleCodespaceReasons[codespace]; ok {
		if reason, ok := table[code]; ok {
			return reason
		}
		return fmt.Sprintf("unknown %s error", codespace)
	}
	return fmt.Sprintf("unknown %s error", codespace)
}

// DecodeRefusalText names a refusal that arrives as text only, such as a failed
// simulation (the chain reports the module's message but no code): it matches
// RegisteredErrors (longest match wins) and decodes that codespace and code.
// It returns nil when the text names no registered error.
func DecodeRefusalText(text string) *QoreTxError {
	named, ok := ErrorFromText(text)
	if !ok {
		return nil
	}
	return DecodeTxError(named.Code, named.Codespace, text)
}
