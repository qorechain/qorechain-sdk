package crossvm

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	"github.com/cosmos/gogoproto/proto"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

func TestBuildCallAsyncBudget(t *testing.T) {
	c := New(testSigner(t), Options{})
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
