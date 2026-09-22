package query

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"cosmossdk.io/math"
)

// EVMWindowStatus is the decoded answer of
// GET {rest}/qorechain/pqc/v1/evm_window/{address} — the EVM authorisation
// window of one account (chain v3.2.0).
//
// The route answers 200 with Found=false when the account has no window, so it
// is safe to poll. A stored window may still be expired or exhausted: Live
// reports whether it admits at least one more zero-value transaction at the
// current height.
//
// All numbers arrive as JSON strings. The three value fields are cosmos.Int
// amounts in uqor and are kept as math.Int (arbitrary precision) — never
// float64, which silently truncates above 2^53. When a field is absent (the
// Found=false shape) the value fields decode to zero rather than a nil Int.
type EVMWindowStatus struct {
	// Found reports whether a window is stored for the account.
	Found bool
	// Live reports whether the stored window still admits a transaction now.
	Live bool
	// OpenedHeight is the height the window was opened at.
	OpenedHeight uint64
	// ExpiryHeight is the height the window stops admitting transactions at.
	ExpiryHeight uint64
	// MaxTxs is the transaction count the window was opened with.
	MaxTxs uint64
	// UsedTxs is how many transactions it has admitted.
	UsedTxs uint64
	// MaxValue is the uqor bound the window was opened with (value + maximum
	// fee of every admitted transaction).
	MaxValue math.Int
	// UsedValue is the uqor already consumed against MaxValue.
	UsedValue math.Int
	// RemainingBlocks, RemainingTxs and RemainingValue say which bound is
	// closest to running out, so a refused caller can tell why.
	RemainingBlocks uint64
	RemainingTxs    uint64
	RemainingValue  math.Int
}

// Exhausted reports whether a found window has run out of transactions, value
// or blocks. It is false when no window is stored at all — that is
// "no window", a different state with a different remedy (open one).
func (s *EVMWindowStatus) Exhausted() bool {
	if s == nil || !s.Found {
		return false
	}
	return !s.Live
}

// EVMWindowPath is the REST route for one account's EVM authorisation window.
func EVMWindowPath(address string) string {
	return "/qorechain/pqc/v1/evm_window/" + url.PathEscape(address)
}

// GetEVMWindow returns the raw EVM authorisation window body for an address.
func (c *RestClient) GetEVMWindow(address string) (json.RawMessage, error) {
	return c.Get(EVMWindowPath(address), nil)
}

// GetEVMWindowStatus returns the decoded EVM authorisation window for an
// address. A missing window is not an error: it answers Found=false.
func (c *RestClient) GetEVMWindowStatus(address string) (*EVMWindowStatus, error) {
	raw, err := c.GetEVMWindow(address)
	if err != nil {
		return nil, err
	}
	return ParseEVMWindowStatus(raw)
}

// evmWindowBody mirrors the wire shape with every field left undecoded, so each
// one can be read from either its string or its bare-number spelling.
type evmWindowBody struct {
	Found           json.RawMessage `json:"found"`
	Live            json.RawMessage `json:"live"`
	OpenedHeight    json.RawMessage `json:"opened_height"`
	ExpiryHeight    json.RawMessage `json:"expiry_height"`
	MaxTxs          json.RawMessage `json:"max_txs"`
	UsedTxs         json.RawMessage `json:"used_txs"`
	MaxValue        json.RawMessage `json:"max_value"`
	UsedValue       json.RawMessage `json:"used_value"`
	RemainingBlocks json.RawMessage `json:"remaining_blocks"`
	RemainingTxs    json.RawMessage `json:"remaining_txs"`
	RemainingValue  json.RawMessage `json:"remaining_value"`
}

// ParseEVMWindowStatus decodes an evm_window REST body. It accepts both shapes
// the route answers: the {"found":false} shape and the full live shape, with
// the numbers spelled as JSON strings (as the chain sends them) or as bare
// numbers.
func ParseEVMWindowStatus(raw []byte) (*EVMWindowStatus, error) {
	var body evmWindowBody
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, fmt.Errorf("evm_window: decoding response: %w", err)
	}
	out := &EVMWindowStatus{}
	var err error
	if out.Found, err = windowBool(body.Found, "found"); err != nil {
		return nil, err
	}
	if out.Live, err = windowBool(body.Live, "live"); err != nil {
		return nil, err
	}
	for _, f := range []struct {
		raw  json.RawMessage
		name string
		dst  *uint64
	}{
		{body.OpenedHeight, "opened_height", &out.OpenedHeight},
		{body.ExpiryHeight, "expiry_height", &out.ExpiryHeight},
		{body.MaxTxs, "max_txs", &out.MaxTxs},
		{body.UsedTxs, "used_txs", &out.UsedTxs},
		{body.RemainingBlocks, "remaining_blocks", &out.RemainingBlocks},
		{body.RemainingTxs, "remaining_txs", &out.RemainingTxs},
	} {
		if *f.dst, err = windowUint(f.raw, f.name); err != nil {
			return nil, err
		}
	}
	for _, f := range []struct {
		raw  json.RawMessage
		name string
		dst  *math.Int
	}{
		{body.MaxValue, "max_value", &out.MaxValue},
		{body.UsedValue, "used_value", &out.UsedValue},
		{body.RemainingValue, "remaining_value", &out.RemainingValue},
	} {
		if *f.dst, err = windowInt(f.raw, f.name); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// windowScalar unquotes a JSON string or returns a bare number token verbatim.
// An absent or null field yields "".
func windowScalar(raw json.RawMessage, field string) (string, error) {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return "", nil
	}
	if strings.HasPrefix(s, `"`) {
		var str string
		if err := json.Unmarshal(raw, &str); err != nil {
			return "", fmt.Errorf("evm_window: field %s: %w", field, err)
		}
		return strings.TrimSpace(str), nil
	}
	return s, nil
}

func windowBool(raw json.RawMessage, field string) (bool, error) {
	s, err := windowScalar(raw, field)
	if err != nil {
		return false, err
	}
	switch s {
	case "", "false":
		return false, nil
	case "true":
		return true, nil
	default:
		return false, fmt.Errorf("evm_window: field %s is not a boolean: %q", field, s)
	}
}

func windowUint(raw json.RawMessage, field string) (uint64, error) {
	s, err := windowScalar(raw, field)
	if err != nil {
		return 0, err
	}
	if s == "" {
		return 0, nil
	}
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("evm_window: field %s is not an integer: %q", field, s)
	}
	return n, nil
}

func windowInt(raw json.RawMessage, field string) (math.Int, error) {
	s, err := windowScalar(raw, field)
	if err != nil {
		return math.Int{}, err
	}
	if s == "" {
		return math.ZeroInt(), nil
	}
	v, ok := math.NewIntFromString(s)
	if !ok {
		return math.Int{}, fmt.Errorf("evm_window: field %s is not an integer amount of uqor: %q", field, s)
	}
	return v, nil
}
