package pqcdx

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	"github.com/cosmos/gogoproto/proto"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

const (
	possessionOn  = `{"features":[{"name":"pqc-possession-flag","enabled":true,"known":true,"staged":false}],"height":"7"}`
	possessionOff = `{"features":[{"name":"pqc-possession-flag","enabled":false,"known":true,"staged":false}],"height":"7"}`
	possessionNo  = `{"features":[{"name":"pqc-sign-bytes-v2","enabled":true,"known":true,"staged":false}],"height":"7"}`
)

// possessionServer answers protocol_features with (status, body) (status 0 is
// a 404) and the v3.2.3 applied plan with planHeight; it accepts every
// registration broadcast and keeps the last one.
type possessionServer struct {
	*httptest.Server
	featureRequests atomic.Int32
	planRequests    atomic.Int32
	broadcast       atomic.Value // string
}

func newPossessionServer(t *testing.T, status int, body, planHeight string) *possessionServer {
	t.Helper()
	ClearPQCStatusCache()
	ClearProofOfPossessionCache()
	query.ClearUpgradeCache()
	ps := &possessionServer{}
	ps.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == query.ProtocolFeaturesPath:
			ps.featureRequests.Add(1)
			if status == 0 {
				http.NotFound(w, r)
				return
			}
			w.WriteHeader(status)
			_, _ = w.Write([]byte(body))
		case r.URL.Path == "/cosmos/upgrade/v1beta1/applied_plan/v3.2.3":
			ps.planRequests.Add(1)
			_, _ = w.Write([]byte(`{"height":"` + planHeight + `"}`))
		case strings.HasPrefix(r.URL.Path, "/qorechain/pqc/v1/account/"):
			_, _ = w.Write([]byte(`{"found":false,"account":null}`))
		case r.URL.Path == "/cosmos/tx/v1beta1/txs":
			b, _ := io.ReadAll(r.Body)
			ps.broadcast.Store(string(b))
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0}}`))
		default:
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0,"height":"10"}}`))
		}
	}))
	t.Cleanup(ps.Close)
	return ps
}

func (ps *possessionServer) sentProof(t *testing.T) []byte {
	t.Helper()
	b, _ := ps.broadcast.Load().(string)
	var req struct {
		TxBytes []byte `json:"tx_bytes"`
	}
	if err := json.Unmarshal([]byte(b), &req); err != nil {
		t.Fatalf("broadcast body: %v", err)
	}
	var raw sdktx.TxRaw
	if err := proto.Unmarshal(req.TxBytes, &raw); err != nil {
		t.Fatalf("tx raw: %v", err)
	}
	return decodeRegisterMsg(t, &tx.BuiltTx{TxRaw: &raw}).ProofOfPossession
}

func TestEnsureProofOfPossessionByProtocolFeature(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		body       string
		planHeight string
		attach     bool
		wantErr    bool
		planAsked  bool
	}{
		{"enabled", 200, possessionOn, "0", true, false, false},
		{"disabled", 200, possessionOff, "8003746", false, false, false},
		{"absent falls back to applied plan", 200, possessionNo, "8003746", true, false, true},
		{"404 falls back to applied plan", 0, "", "8003746", true, false, true},
		{"501 falls back to applied plan", 501, `{"code":12,"message":"Not Implemented"}`, "0", false, false, true},
		{"empty list falls back to applied plan", 200, `{"features":[],"height":"1"}`, "8003746", true, false, true},
		{"500 is an error", 500, `{"code":13}`, "8003746", false, true, false},
		{"429 is an error", 429, `slow down`, "8003746", false, true, false},
		{"unparsable is an error", 200, `<html>`, "8003746", false, true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ps := newPossessionServer(t, c.status, c.body, c.planHeight)
			signer := restSigner(t, ps.URL)
			_, err := New(signer, Options{}).EnsurePQCRegistered(RegisterOptions{})
			if c.wantErr {
				if err == nil {
					t.Fatal("expected an error when the network cannot be asked")
				}
				if ps.broadcast.Load() != nil {
					t.Fatal("nothing may be broadcast when the network cannot be asked")
				}
			} else {
				if err != nil {
					t.Fatalf("EnsurePQCRegistered: %v", err)
				}
				if got := len(ps.sentProof(t)) > 0; got != c.attach {
					t.Fatalf("proof attached = %v, want %v", got, c.attach)
				}
			}
			if asked := ps.planRequests.Load() > 0; asked != c.planAsked {
				t.Fatalf("applied_plan asked = %v, want %v", asked, c.planAsked)
			}
		})
	}
}

func TestEnsureExplicitProofChoiceMakesNoQuery(t *testing.T) {
	t.Run("explicit proof", func(t *testing.T) {
		ps := newPossessionServer(t, 500, `down`, "0")
		signer := restSigner(t, ps.URL)
		proof := []byte{1, 2, 3}
		if _, err := New(signer, Options{}).EnsurePQCRegistered(RegisterOptions{ProofOfPossession: proof}); err != nil {
			t.Fatal(err)
		}
		if got := ps.sentProof(t); string(got) != string(proof) {
			t.Fatalf("sent %x, want %x", got, proof)
		}
		if n := ps.featureRequests.Load() + ps.planRequests.Load(); n != 0 {
			t.Fatalf("requests = %d, want 0", n)
		}
	})
	t.Run("skip", func(t *testing.T) {
		ps := newPossessionServer(t, 500, `down`, "8003746")
		signer := restSigner(t, ps.URL)
		if _, err := New(signer, Options{}).EnsurePQCRegistered(RegisterOptions{SkipProofOfPossession: true}); err != nil {
			t.Fatal(err)
		}
		if got := ps.sentProof(t); len(got) != 0 {
			t.Fatalf("sent a %d-byte proof, want none", len(got))
		}
		if n := ps.featureRequests.Load() + ps.planRequests.Load(); n != 0 {
			t.Fatalf("requests = %d, want 0", n)
		}
	})
}

func TestProofOfPossessionWantedConnectionRefused(t *testing.T) {
	ClearProofOfPossessionCache()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	if _, err := ProofOfPossessionWanted(context.Background(), "http://"+addr, "qorechain-vladi"); err == nil {
		t.Fatal("expected an error when the node refuses the connection")
	}
}

func TestProofOfPossessionWantedCachesAnswersNotErrors(t *testing.T) {
	ps := newPossessionServer(t, 200, possessionOn, "0")
	now := time.Unix(1_700_000_000, 0)
	possessionNow = func() time.Time { return now }
	defer func() { possessionNow = time.Now }()
	ctx := context.Background()
	if want, err := ProofOfPossessionWanted(ctx, ps.URL, "qorechain-diana"); err != nil || !want {
		t.Fatalf("first = %v, %v", want, err)
	}
	now = now.Add(PossessionTTL - time.Second)
	if want, err := ProofOfPossessionWanted(ctx, ps.URL, "qorechain-diana"); err != nil || !want {
		t.Fatalf("cached = %v, %v", want, err)
	}
	if n := ps.featureRequests.Load(); n != 1 {
		t.Fatalf("feature requests = %d, want 1 (cached)", n)
	}
	// Another chain id behind the same URL is its own entry.
	if _, err := ProofOfPossessionWanted(ctx, ps.URL, "qorechain-vladi"); err != nil {
		t.Fatal(err)
	}
	if n := ps.featureRequests.Load(); n != 2 {
		t.Fatalf("feature requests = %d, want 2", n)
	}

	// An error is not cached.
	bad := newPossessionServer(t, 503, `busy`, "0")
	possessionNow = func() time.Time { return now }
	for i := 0; i < 2; i++ {
		if _, err := ProofOfPossessionWanted(ctx, bad.URL, "qorechain-diana"); err == nil {
			t.Fatal("expected an error")
		}
	}
	if n := bad.featureRequests.Load(); n != 2 {
		t.Fatalf("feature requests = %d, want 2 (errors are not cached)", n)
	}
}
