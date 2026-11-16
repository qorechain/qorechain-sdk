package crossvm

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	"github.com/cosmos/gogoproto/proto"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

func TestBuildCallAsyncBudget(t *testing.T) {
	s := testSigner(t)
	s.SkipFeatureCheck = true // offline: this test checks the message only
	c := New(s, Options{})
	built, err := c.BuildCall(CallOptions{TargetVM: VMTypeCosmWasm, TargetContract: "qor1c", Cosmwasm: map[string]any{"ping": struct{}{}},
		Async: true, AsyncGasLimit: 400_000, AsyncMaxFactor: 2_000_000})
	if err != nil {
		t.Fatal(err)
	}
	m := decodeMsgs(t, built)[0]
	if !m.Async || m.AsyncGasLimit != 400_000 || m.AsyncMaxFactor != 2_000_000 {
		t.Fatalf("msg = %+v", m)
	}
	bad := []CallOptions{
		{TargetVM: VMTypeCosmWasm, TargetContract: "qor1c", Payload: []byte{1}, AsyncGasLimit: 400_000},                 // sync
		{TargetVM: VMTypeEVM, TargetContract: "0xabc", Payload: []byte{1}, Async: true, AsyncMaxFactor: 1},              // not CosmWasm
		{TargetVM: VMTypeCosmWasm, TargetContract: "qor1c", Payload: []byte{1}, Async: true, AsyncGasLimit: 100},        // too low
		{TargetVM: VMTypeCosmWasm, TargetContract: "qor1c", Payload: []byte{1}, Async: true, AsyncGasLimit: 10_000_001}, // too high
	}
	for i, o := range bad {
		if _, err := c.BuildCall(o); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}

func TestBuildCallRefusesEmptyGas(t *testing.T) {
	s := testSigner(t)
	s.Fee.Gas = ""
	_, err := New(s, Options{}).BuildCall(CallOptions{TargetVM: VMTypeCosmWasm, TargetContract: "qor1c", Payload: []byte("{}")})
	if !errors.Is(err, tx.ErrFixedGasForWasm) {
		t.Fatalf("err = %v", err)
	}
}

func TestBuildCallAutoGasSimulates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cosmos/tx/v1beta1/simulate" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"gas_info":{"gas_used":"533000"}}`))
	}))
	defer srv.Close()
	s := testSigner(t)
	s.RestURL = srv.URL
	s.HTTPClient = srv.Client()
	s.Fee = tx.Fee{Gas: tx.GasAuto}
	built, err := New(s, Options{}).BuildCall(CallOptions{TargetVM: VMTypeCosmWasm, TargetContract: "qor1c", Payload: []byte("{}")})
	if err != nil {
		t.Fatal(err)
	}
	var ai sdktx.AuthInfo
	if err := proto.Unmarshal(built.AuthInfoBytes, &ai); err != nil {
		t.Fatal(err)
	}
	if ai.Fee.GasLimit != 692_900 { // ceil(533000 * 1.3)
		t.Fatalf("gas limit = %d", ai.Fee.GasLimit)
	}
	// ceil(692900 * 0.15); tx.CalculateFee prices through big.Float, which may
	// round the last unit up.
	if got := ai.Fee.Amount.AmountOf("uqor").Int64(); got < 103_935 || got > 103_936 {
		t.Fatalf("fee = %d", got)
	}
}

func TestBuildCallChecksAsyncSwitches(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		body    string
		skip    bool
		restURL bool
		wantErr string
	}{
		{"switch on", 200, `{"features":[{"name":"crossvm-async-gas-priced","enabled":true,"known":true,"staged":false}],"height":"9"}`, false, true, ""},
		{"absent (mainnet shape)", 200, `{"features":[{"name":"pqc-sign-bytes-v2","enabled":true,"known":true,"staged":false}],"height":"9"}`, false, true,
			"async_gas_limit (field 8) requires chain v3.2.8 (switch crossvm-async-gas-priced is not on at "},
		{"404", 0, "", false, true, "requires chain v3.2.8"},
		{"500", 500, `down`, false, true, "cannot ask"},
		{"no REST URL", 200, "", false, false, "SkipFeatureCheck"},
		{"no REST URL, skipped", 200, "", true, false, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tx.ClearCrossVMAsyncFeatureCache()
			var requests int
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				if c.status == 0 || r.URL.Path != "/qorechain/pqc/v1/protocol_features" {
					http.NotFound(w, r)
					return
				}
				w.WriteHeader(c.status)
				_, _ = w.Write([]byte(c.body))
			}))
			defer srv.Close()
			s := testSigner(t)
			s.SkipFeatureCheck = c.skip
			if c.restURL {
				s.RestURL, s.HTTPClient = srv.URL, srv.Client()
			}
			_, err := New(s, Options{}).BuildCall(CallOptions{TargetVM: VMTypeCosmWasm, TargetContract: "qor1c",
				Payload: []byte("{}"), Async: true, AsyncGasLimit: 400_000})
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("err = %v; want it to contain %q", err, c.wantErr)
			}
		})
	}
}

func TestBuildCallWithoutAsyncFieldsMakesNoRequest(t *testing.T) {
	var requests int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(500)
	}))
	defer srv.Close()
	s := testSigner(t)
	s.RestURL, s.HTTPClient = srv.URL, srv.Client()
	if _, err := New(s, Options{}).BuildCall(CallOptions{TargetVM: VMTypeCosmWasm, TargetContract: "qor1c",
		Payload: []byte("{}"), Async: true}); err != nil {
		t.Fatal(err)
	}
	if requests != 0 {
		t.Fatalf("requests = %d, want 0", requests)
	}
}
