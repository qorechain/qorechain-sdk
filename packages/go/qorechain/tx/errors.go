package tx

import "fmt"

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

// moduleCodespaceReasons maps non-root module codespaces (Cosmos + QoreChain) to
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
	// QoreChain custom modules — generic per-module fallbacks.
	"pqc":             {},
	"amm":             {},
	"bridge":          {},
	"rdk":             {},
	"multilayer":      {},
	"svm":             {},
	"lightnode":       {},
	"license":         {},
	"abstractaccount": {},
	"crossvm":         {},
	"rlconsensus":     {},
}

// DecodeTxError maps an ABCI (code, codespace, rawLog) triple to a *QoreTxError.
//
// A zero code returns nil (success). The codespace selects the code table: the
// empty / "sdk" codespace uses the root SDK table; a module codespace uses its
// per-module table, with a generic fallback when the specific code is unmapped.
func DecodeTxError(code uint32, codespace, rawLog string) *QoreTxError {
	if code == 0 {
		return nil
	}
	return &QoreTxError{
		Code:      code,
		Codespace: codespace,
		Reason:    reasonFor(code, codespace),
		RawLog:    rawLog,
	}
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
