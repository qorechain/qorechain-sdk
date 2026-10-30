package tx

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	"github.com/cosmos/gogoproto/proto"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
)

func TestExactHybridGas(t *testing.T) {
	cases := map[uint64]uint64{
		0:      2000,
		100:    2102,
		166300: 171626, // ceil(169626) + 2000
		166301: 171628, // ceil(169627.02) = 169628
		50:     2051,   // ceil(51) + 2000
	}
	for sim, want := range cases {
		if got := ExactHybridGas(sim); got != want {
			t.Errorf("ExactHybridGas(%d) = %d, want %d", sim, got, want)
		}
	}
}

// gasNode answers applied_plan for v3.2.5 with height and the simulate route
// with simulated, counting both.
type gasNode struct {
	height     string
	simulated  string
	planHits   atomic.Int32
	simHits    atomic.Int32
	broadcasts atomic.Int32
	lastGas    atomic.Value // gas limit of the last broadcast tx
}

func (n *gasNode) server(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == query.AppliedPlanPath(query.ChainUpgradeV3_2_5):
			n.planHits.Add(1)
			_, _ = w.Write([]byte(`{"height":"` + n.height + `"}`))
		case strings.HasPrefix(r.URL.Path, query.AppliedPlanPath("")):
			_, _ = w.Write([]byte(`{"height":"5920000"}`)) // sign-bytes v2 plans
		case r.URL.Path == "/cosmos/tx/v1beta1/simulate":
			n.simHits.Add(1)
			_, _ = w.Write([]byte(`{"gas_info":{"gas_used":"` + n.simulated + `"}}`))
		case r.URL.Path == "/cosmos/tx/v1beta1/txs" && r.Method == http.MethodPost:
			n.broadcasts.Add(1)
			var req struct {
				TxBytes string `json:"tx_bytes"`
			}
			b, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(b, &req)
			raw, _ := base64.StdEncoding.DecodeString(req.TxBytes)
			_, _, authInfo, err := decodeHybrid(raw)
			if err != nil {
				t.Errorf("broadcast tx is not hybrid: %v", err)
			}
			n.lastGas.Store(gasLimitOf(t, authInfo))
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"GOOD","code":0}}`))
		default:
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"GOOD","code":0,"height":"10","gas_used":"1","gas_wanted":"2"}}`))
		}
	}))
}

func TestHybridGasWantedExactOnV325(t *testing.T) {
	query.ClearUpgradeCache()
	n := &gasNode{height: "3906833"}
	srv := n.server(t)
	defer srv.Close()

	d := HybridGasWanted(srv.URL, 166300, 0, srv.Client())
	if !d.Exact || d.GasWanted != 171626 || d.Simulated != 166300 || d.PlanLookupErr != nil {
		t.Fatalf("decision = %+v", d)
	}
	// An applied plan stays applied: the second call does not ask again.
	d = HybridGasWanted(srv.URL, 100000, 0, srv.Client())
	if !d.Exact || d.GasWanted != ExactHybridGas(100000) {
		t.Fatalf("second decision = %+v", d)
	}
	if hits := n.planHits.Load(); hits != 1 {
		t.Fatalf("applied_plan asked %d times, want 1 (cached per endpoint)", hits)
	}
	// An explicit multiplier is the caller's choice, even on v3.2.5.
	d = HybridGasWanted(srv.URL, 100000, 1.5, srv.Client())
	if d.Exact || d.GasWanted != 150000 {
		t.Fatalf("explicit multiplier decision = %+v", d)
	}
}

func TestHybridGasWantedOldRuleBelowV325(t *testing.T) {
	query.ClearUpgradeCache()
	n := &gasNode{height: "0"}
	srv := n.server(t)
	defer srv.Close()

	d := HybridGasWanted(srv.URL, 100000, 0, srv.Client())
	if d.Exact || d.GasWanted != 140000 || d.PlanLookupErr != nil {
		t.Fatalf("decision = %+v", d)
	}
	// No REST endpoint: the earlier rule, without asking anyone.
	d = HybridGasWanted("", 100000, 0, nil)
	if d.Exact || d.GasWanted != 140000 {
		t.Fatalf("no-rest decision = %+v", d)
	}
}

func TestHybridGasWantedLookupFailureKeepsOldRule(t *testing.T) {
	query.ClearUpgradeCache()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusBadGateway)
	}))
	defer srv.Close()
	d := HybridGasWanted(srv.URL, 100000, 0, srv.Client())
	if d.Exact || d.GasWanted != 140000 || d.PlanLookupErr == nil {
		t.Fatalf("decision = %+v", d)
	}
}

func TestBroadcastHybridAutoGasUsesExactRule(t *testing.T) {
	query.ClearUpgradeCache()
	n := &gasNode{height: "3906833", simulated: "166300"}
	srv := n.server(t)
	defer srv.Close()
	kp := newKeypair(t)
	build := hybridParams(t, kp, "qorechain-vladi", signbytes.V2)
	build.Fee = Fee{Gas: GasAuto}

	out, err := BroadcastHybridAndWait(BroadcastHybridParams{
		Build:   build,
		RestURL: srv.URL,
		Wait:    WaitOptions{Timeout: 2 * time.Second, Poll: 10 * time.Millisecond},
	})
	if err != nil {
		t.Fatalf("BroadcastHybridAndWait: %v", err)
	}
	if out.Gas == nil || !out.Gas.Exact || out.Gas.Simulated != 166300 || out.Gas.GasWanted != 171626 {
		t.Fatalf("gas = %+v", out.Gas)
	}
	if got := n.lastGas.Load(); got != uint64(171626) {
		t.Fatalf("broadcast gas limit = %v, want 171626", got)
	}
	if n.simHits.Load() != 1 || n.broadcasts.Load() != 1 {
		t.Fatalf("simulations %d broadcasts %d", n.simHits.Load(), n.broadcasts.Load())
	}
}

func TestBroadcastHybridAutoGasOldRule(t *testing.T) {
	query.ClearUpgradeCache()
	n := &gasNode{height: "0", simulated: "100000"}
	srv := n.server(t)
	defer srv.Close()
	kp := newKeypair(t)
	build := hybridParams(t, kp, "qorechain-vladi", signbytes.V2)
	build.Fee = Fee{Gas: GasAuto}

	out, err := BroadcastHybridAndWait(BroadcastHybridParams{
		Build:   build,
		RestURL: srv.URL,
		Wait:    WaitOptions{Timeout: 2 * time.Second, Poll: 10 * time.Millisecond},
	})
	if err != nil {
		t.Fatalf("BroadcastHybridAndWait: %v", err)
	}
	if out.Gas == nil || out.Gas.Exact || out.Gas.GasWanted != 140000 {
		t.Fatalf("gas = %+v", out.Gas)
	}
	if got := n.lastGas.Load(); got != uint64(140000) {
		t.Fatalf("broadcast gas limit = %v, want 140000", got)
	}
}

func gasLimitOf(t *testing.T, authInfo []byte) uint64 {
	t.Helper()
	var ai sdktx.AuthInfo
	if err := proto.Unmarshal(authInfo, &ai); err != nil {
		t.Errorf("decode auth info: %v", err)
		return 0
	}
	if ai.Fee == nil {
		return 0
	}
	return ai.Fee.GasLimit
}
