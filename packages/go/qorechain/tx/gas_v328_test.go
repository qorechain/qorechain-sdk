package tx

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	sdk "github.com/cosmos/cosmos-sdk/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"

	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
)

func TestRequiresSimulatedGas(t *testing.T) {
	if !RequiresSimulatedGas([]sdk.Msg{&banktypes.MsgSend{}, &crossvmv1.MsgCrossVMCall{}}) {
		t.Error("MsgCrossVMCall not flagged")
	}
	if RequiresSimulatedGas([]sdk.Msg{&banktypes.MsgSend{}}) {
		t.Error("bank send flagged")
	}
	for _, u := range []string{"/cosmwasm.wasm.v1.MsgExecuteContract", "cosmwasm.wasm.v1.MsgMigrateContract", "/cosmwasm.wasm.v1.MsgInstantiateContract2"} {
		if !RequiresSimulatedGasTypeURL(u) {
			t.Errorf("%s not flagged", u)
		}
	}
}

func TestWasmGasWanted(t *testing.T) {
	if got := WasmGasWanted(100_000, 0); got != 130_000 {
		t.Errorf("default = %d", got)
	}
	if got := WasmGasWanted(100_000, 1.02); got != 130_000 {
		t.Errorf("below floor = %d", got)
	}
	if got := WasmGasWanted(100_000, 1.5); got != 150_000 {
		t.Errorf("above floor = %d", got)
	}
}

func TestCosmosGasCapRefusedBeforeSigning(t *testing.T) {
	acc := mustAccount(t)
	msgs := []sdk.Msg{&banktypes.MsgSend{FromAddress: acc.Address, ToAddress: acc.Address, Amount: coins("uqor", "1")}}
	_, err := SendMessages(SendMessagesParams{Account: acc, Messages: msgs, ChainID: "c",
		Fee: Fee{Amount: []Coin{{Denom: "uqor", Amount: "1"}}, Gas: "50000001"}})
	if err == nil || !strings.Contains(err.Error(), "50000000") {
		t.Fatalf("err = %v", err)
	}
	if _, err := SendMessages(SendMessagesParams{Account: acc, Messages: msgs, ChainID: "c",
		Fee: Fee{Amount: []Coin{{Denom: "uqor", Amount: "1"}}, Gas: "50000000"}}); err != nil {
		t.Fatalf("cap itself refused: %v", err)
	}
}

func TestBroadcastHybridAutoGasWasmFloor(t *testing.T) {
	query.ClearUpgradeCache()
	n := &gasNode{height: "3906833", simulated: "100000"}
	srv := n.server(t)
	defer srv.Close()
	kp := newKeypair(t)
	build := hybridParams(t, kp, "qorechain-vladi", signbytes.V2)
	build.Messages = []sdk.Msg{&crossvmv1.MsgCrossVMCall{Sender: build.Account.Address, TargetVM: "cosmwasm", TargetContract: "qor1c", Payload: []byte("{}")}}
	build.Fee = Fee{Gas: GasAuto}
	out, err := BroadcastHybridAndWait(BroadcastHybridParams{Build: build, RestURL: srv.URL,
		Wait: WaitOptions{Timeout: 2 * time.Second, Poll: 10 * time.Millisecond}})
	if err != nil {
		t.Fatal(err)
	}
	if out.Gas == nil || out.Gas.GasWanted != 130_000 || out.Gas.Exact {
		t.Fatalf("gas = %+v", out.Gas)
	}
	if got := n.lastGas.Load(); got != uint64(130_000) {
		t.Fatalf("broadcast gas = %v", got)
	}
}

func feemarketServer(t *testing.T, minGasPrice string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != query.FeemarketParamsPath {
			http.NotFound(w, r)
			return
		}
		fmt.Fprintf(w, `{"params":{"min_gas_price":%q}}`, minGasPrice)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestFetchMinGasPriceUqor(t *testing.T) {
	cases := map[string]string{
		"100000000000.000000000000000000": "0.1",
		"250000000000.000000000000000000": "0.25",
		"123456789012.345678901234567890": "0.123456789012345679", // rounded up at 18 decimals
		"0.000000000000000000":            "0.1",                  // floor
		"1000000000000":                   "1",
	}
	for in, want := range cases {
		srv := feemarketServer(t, in)
		got, err := FetchMinGasPriceUqor(srv.URL, srv.Client())
		if err != nil || got != want {
			t.Errorf("%s: got %q, err %v, want %q", in, got, err, want)
		}
	}
	srv := feemarketServer(t, "abc")
	if _, err := FetchMinGasPriceUqor(srv.URL, srv.Client()); err == nil {
		t.Error("bad decimal accepted")
	}
}

func TestRecommendedGasPriceUqor(t *testing.T) {
	cases := []struct{ min, margin, want string }{
		{"100000000000", "", "0.15"},    // 0.1 x 1.5
		{"200000000000", "", "0.3"},     // 0.2 x 1.5
		{"100000000000", "1.2", "0.15"}, // 0.12 raised to 0.15
		{"400000000000", "2", "0.8"},
	}
	for _, c := range cases {
		srv := feemarketServer(t, c.min)
		got, err := RecommendedGasPriceUqor(srv.URL, c.margin, srv.Client())
		if err != nil || got != c.want {
			t.Errorf("%+v: got %q, err %v", c, got, err)
		}
	}
	srv := feemarketServer(t, "100000000000")
	if _, err := RecommendedGasPriceUqor(srv.URL, "0", srv.Client()); err == nil {
		t.Error("zero margin accepted")
	}
	if DefaultGasPrice != "0.15uqor" {
		t.Error("default gas price changed")
	}
}
