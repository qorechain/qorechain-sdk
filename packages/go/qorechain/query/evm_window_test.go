package query

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"cosmossdk.io/math"
)

// TestParseEVMWindowStatusAbsent covers the found:false shape the route answers
// for an account with no window — a 200, so polling is safe.
func TestParseEVMWindowStatusAbsent(t *testing.T) {
	status, err := ParseEVMWindowStatus([]byte(`{"found":false}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if status.Found || status.Live {
		t.Fatalf("expected an absent window, got %+v", status)
	}
	if status.Exhausted() {
		t.Fatal("an absent window is not an exhausted window")
	}
	// The value fields must be usable zero Ints, not nil ones.
	for name, v := range map[string]math.Int{
		"max_value":       status.MaxValue,
		"used_value":      status.UsedValue,
		"remaining_value": status.RemainingValue,
	} {
		if v.IsNil() {
			t.Fatalf("%s decoded to a nil Int", name)
		}
		if !v.IsZero() {
			t.Fatalf("%s decoded to %s, want 0", name, v)
		}
	}
}

// TestParseEVMWindowStatusLive parses the live shape measured on the testnet,
// with every number spelled as a JSON string.
func TestParseEVMWindowStatusLive(t *testing.T) {
	body := []byte(`{"found":true,"live":true,"opened_height":"6069608","expiry_height":"6069908",` +
		`"max_txs":"5","used_txs":"1","max_value":"2000000","used_value":"3363",` +
		`"remaining_blocks":"286","remaining_txs":"4","remaining_value":"1996637"}`)
	status, err := ParseEVMWindowStatus(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !status.Found || !status.Live {
		t.Fatalf("expected a live window: %+v", status)
	}
	if status.OpenedHeight != 6069608 || status.ExpiryHeight != 6069908 {
		t.Fatalf("height mismatch: %+v", status)
	}
	if status.MaxTxs != 5 || status.UsedTxs != 1 || status.RemainingTxs != 4 || status.RemainingBlocks != 286 {
		t.Fatalf("counter mismatch: %+v", status)
	}
	if !status.MaxValue.Equal(math.NewInt(2000000)) ||
		!status.UsedValue.Equal(math.NewInt(3363)) ||
		!status.RemainingValue.Equal(math.NewInt(1996637)) {
		t.Fatalf("value mismatch: %+v", status)
	}
	if status.Exhausted() {
		t.Fatal("a live window is not exhausted")
	}
}

// TestParseEVMWindowStatusKeepsBigNumbersExact uses values above 2^53 — the
// point where a float64 decode starts truncating — and one far beyond uint64,
// which the cosmos.Int fields must still carry digit for digit.
func TestParseEVMWindowStatusKeepsBigNumbersExact(t *testing.T) {
	body := []byte(`{"found":true,"live":false,"opened_height":"9007199254740993",` +
		`"expiry_height":"9007199254740995","max_txs":"1000","used_txs":"1000",` +
		`"max_value":"123456789012345678901234567890","used_value":"123456789012345678901234567890",` +
		`"remaining_blocks":"2","remaining_txs":"0","remaining_value":"0"}`)
	status, err := ParseEVMWindowStatus(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if status.OpenedHeight != 9007199254740993 {
		t.Fatalf("opened_height truncated: got %d", status.OpenedHeight)
	}
	if status.ExpiryHeight != 9007199254740995 {
		t.Fatalf("expiry_height truncated: got %d", status.ExpiryHeight)
	}
	if got := status.MaxValue.String(); got != "123456789012345678901234567890" {
		t.Fatalf("max_value truncated: got %s", got)
	}
	if got := status.UsedValue.String(); got != "123456789012345678901234567890" {
		t.Fatalf("used_value truncated: got %s", got)
	}
	if !status.Exhausted() {
		t.Fatal("a found-but-not-live window is exhausted")
	}
}

// TestParseEVMWindowStatusAcceptsBareNumbers proves a node that renders the
// numbers unquoted is still parsed.
func TestParseEVMWindowStatusAcceptsBareNumbers(t *testing.T) {
	status, err := ParseEVMWindowStatus([]byte(`{"found":true,"live":true,"max_txs":5,"max_value":2000000}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if status.MaxTxs != 5 || !status.MaxValue.Equal(math.NewInt(2000000)) {
		t.Fatalf("mismatch: %+v", status)
	}
}

// TestParseEVMWindowStatusRejectsGarbage checks a non-integer amount is an error
// rather than a silently zeroed bound.
func TestParseEVMWindowStatusRejectsGarbage(t *testing.T) {
	if _, err := ParseEVMWindowStatus([]byte(`{"found":true,"max_value":"1.5"}`)); err == nil {
		t.Fatal("expected an error for a fractional max_value")
	}
	if _, err := ParseEVMWindowStatus([]byte(`{"found":true,"max_txs":"many"}`)); err == nil {
		t.Fatal("expected an error for a non-numeric max_txs")
	}
}

// TestRestClientGetEVMWindowStatus checks the route the client asks for and the
// decode of the answer.
func TestRestClientGetEVMWindowStatus(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"found":true,"live":true,"opened_height":"10","expiry_height":"310",` +
			`"max_txs":"5","used_txs":"1","max_value":"2000000","used_value":"3363",` +
			`"remaining_blocks":"286","remaining_txs":"4","remaining_value":"1996637"}`))
	}))
	defer srv.Close()

	c := NewRestClient(srv.URL, srv.Client())
	status, err := c.GetEVMWindowStatus("qor1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5tfman7")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if gotPath != "/qorechain/pqc/v1/evm_window/qor1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5tfman7" {
		t.Fatalf("unexpected path: %s", gotPath)
	}
	if !status.Found || !status.UsedValue.Equal(math.NewInt(3363)) {
		t.Fatalf("unexpected status: %+v", status)
	}
}
