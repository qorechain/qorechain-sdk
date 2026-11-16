package tx

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/cosmos/cosmos-sdk/types"

	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
)

const (
	asyncBothOn = `{"features":[` +
		`{"name":"crossvm-async-gas-priced","enabled":true,"known":true,"staged":false},` +
		`{"name":"crossvm-async-escrow","enabled":true,"known":true,"staged":false}],"height":"9"}`
	asyncGasOff = `{"features":[` +
		`{"name":"crossvm-async-gas-priced","enabled":false,"known":true,"staged":true},` +
		`{"name":"crossvm-async-escrow","enabled":true,"known":true,"staged":false}],"height":"9"}`
	// mainnetShape lists the switches of chain v3.2.7, without the v3.2.8 ones.
	mainnetShape = `{"features":[{"name":"pqc-sign-bytes-v2","enabled":true,"known":true,"staged":false},` +
		`{"name":"abstractaccount-hardening","enabled":true,"known":true,"staged":false}],"height":"9"}`
)

type featureServer struct {
	*httptest.Server
	requests atomic.Int32
	status   atomic.Int32
}

func newFeatureServer(t *testing.T, status int, body string) *featureServer {
	t.Helper()
	ClearCrossVMAsyncFeatureCache()
	fs := &featureServer{}
	fs.status.Store(int32(status))
	fs.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != query.ProtocolFeaturesPath {
			http.NotFound(w, r)
			return
		}
		fs.requests.Add(1)
		st := int(fs.status.Load())
		if st == 0 {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(st)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(fs.Close)
	return fs
}

func asyncCall(gas, factor uint64) []sdk.Msg {
	return []sdk.Msg{&crossvmv1.MsgCrossVMCall{Sender: "qor1x", TargetVM: "cosmwasm", TargetContract: "qor1c",
		Payload: []byte("{}"), Async: true, AsyncGasLimit: gas, AsyncMaxFactor: factor}}
}

func TestRequireCrossVMAsyncSupport(t *testing.T) {
	cases := []struct {
		name        string
		status      int
		body        string
		gas, factor uint64
		wantErr     string // "" = allowed
		unsupported bool
	}{
		{"switches on", 200, asyncBothOn, 400_000, 2_000_000, "", false},
		{"absent (mainnet shape)", 200, mainnetShape, 400_000, 0,
			"MsgCrossVMCall async_gas_limit (field 8) requires chain v3.2.8 (switch crossvm-async-gas-priced is not on at ", true},
		{"absent, field 9", 200, mainnetShape, 0, 2_000_000,
			"MsgCrossVMCall async_max_factor (field 9) requires chain v3.2.8 (switch crossvm-async-escrow is not on at ", true},
		{"disabled", 200, asyncGasOff, 400_000, 0, "switch crossvm-async-gas-priced is not on", true},
		{"disabled switch, other field on", 200, asyncGasOff, 0, 2_000_000, "", false},
		{"404", 0, "", 400_000, 0, "requires chain v3.2.8", true},
		{"501", 501, `{"code":12,"message":"Not Implemented"}`, 0, 1_000_000, "requires chain v3.2.8", true},
		{"empty list", 200, `{"features":[],"height":"1"}`, 400_000, 0, "requires chain v3.2.8", true},
		{"500 cannot ask", 500, `{"code":13}`, 400_000, 0, "cannot ask", false},
		{"429 cannot ask", 429, `slow down`, 400_000, 0, "cannot ask", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			fs := newFeatureServer(t, c.status, c.body)
			err := RequireCrossVMAsyncSupport(context.Background(), fs.URL, asyncCall(c.gas, c.factor), fs.Client())
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("err = %v; want it to contain %q", err, c.wantErr)
			}
			if got := errors.Is(err, ErrCrossVMAsyncFieldUnsupported); got != c.unsupported {
				t.Fatalf("errors.Is(ErrCrossVMAsyncFieldUnsupported) = %v, want %v", got, c.unsupported)
			}
			if c.unsupported && !strings.HasSuffix(err.Error(), "; leave it 0 on this network") {
				t.Fatalf("err = %v; want the leave-it-0 advice", err)
			}
		})
	}
}

func TestRequireCrossVMAsyncSupportFieldsZeroMakesNoRequest(t *testing.T) {
	fs := newFeatureServer(t, 500, `down`)
	msgs := append(asyncCall(0, 0), &crossvmv1.MsgCrossVMCall{Sender: "qor1x", TargetVM: "evm", TargetContract: "0xabc", Payload: []byte{1}})
	if err := RequireCrossVMAsyncSupport(context.Background(), fs.URL, msgs, fs.Client()); err != nil {
		t.Fatal(err)
	}
	if err := RequireCrossVMAsyncSupport(context.Background(), "", msgs, nil); err != nil {
		t.Fatalf("no REST URL with both fields 0: %v", err)
	}
	if n := fs.requests.Load(); n != 0 {
		t.Fatalf("requests = %d, want 0", n)
	}
}

func TestRequireCrossVMAsyncSupportNoRestURL(t *testing.T) {
	err := RequireCrossVMAsyncSupport(context.Background(), "", asyncCall(400_000, 0), nil)
	if err == nil || !strings.Contains(err.Error(), "SkipFeatureCheck") {
		t.Fatalf("err = %v; want a no-REST-URL error naming SkipFeatureCheck", err)
	}
}

func TestRequireCrossVMAsyncSupportConnectionRefused(t *testing.T) {
	ClearCrossVMAsyncFeatureCache()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	err = RequireCrossVMAsyncSupport(context.Background(), "http://"+addr, asyncCall(400_000, 0), nil)
	if err == nil || !strings.Contains(err.Error(), "cannot ask") {
		t.Fatalf("err = %v; want a cannot-ask error", err)
	}
}

func TestRequireCrossVMAsyncSupportCachesOnAnswer(t *testing.T) {
	fs := newFeatureServer(t, 200, asyncBothOn)
	now := time.Unix(1_700_000_000, 0)
	crossVMFeatureNow = func() time.Time { return now }
	defer func() { crossVMFeatureNow = time.Now }()
	ctx := context.Background()
	if err := RequireCrossVMAsyncSupport(ctx, fs.URL, asyncCall(400_000, 0), fs.Client()); err != nil {
		t.Fatal(err)
	}
	fs.status.Store(500)
	now = now.Add(CrossVMAsyncFeatureTTL - time.Second)
	if err := RequireCrossVMAsyncSupport(ctx, fs.URL, asyncCall(400_000, 0), fs.Client()); err != nil {
		t.Fatalf("cached answer: %v", err)
	}
	if n := fs.requests.Load(); n != 1 {
		t.Fatalf("requests = %d, want 1 (cached)", n)
	}
	now = now.Add(2 * time.Second)
	if err := RequireCrossVMAsyncSupport(ctx, fs.URL, asyncCall(400_000, 0), fs.Client()); err == nil {
		t.Fatal("expected an error once the cached answer expired and the node is down")
	}
}

// The hybrid broadcast path refuses before signing or resolving anything.
func TestBroadcastHybridRefusesAsyncFieldsOnOlderNetwork(t *testing.T) {
	fs := newFeatureServer(t, 200, mainnetShape)
	_, err := BroadcastHybridAndWait(BroadcastHybridParams{
		Build:   BuildHybridMessagesParams{ChainID: "qorechain-vladi", Messages: asyncCall(400_000, 0)},
		RestURL: fs.URL, HTTPClient: fs.Client(),
	})
	if !errors.Is(err, ErrCrossVMAsyncFieldUnsupported) {
		t.Fatalf("err = %v; want ErrCrossVMAsyncFieldUnsupported", err)
	}
}
