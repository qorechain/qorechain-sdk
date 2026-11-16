package authenticator

import (
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
)

const (
	hardeningOn  = `{"features":[{"name":"abstractaccount-hardening","enabled":true,"known":true,"staged":false}],"height":"4"}`
	hardeningOff = `{"features":[{"name":"abstractaccount-hardening","enabled":false,"known":true,"staged":false}],"height":"4"}`
	hardeningNo  = `{"features":[{"name":"pqc-sign-bytes-v2","enabled":true,"known":true,"staged":false}],"height":"4"}`
)

// digestServer answers protocol_features with (status, body), status 0 being
// a 404, and the v3.2.3 applied plan with planHeight.
type digestServer struct {
	*httptest.Server
	featureRequests atomic.Int32
	planRequests    atomic.Int32
	status          atomic.Int32
	body            atomic.Value // string
}

func newDigestServer(t *testing.T, status int, body, planHeight string) *digestServer {
	t.Helper()
	ClearEVMAuthDigestCache()
	query.ClearUpgradeCache()
	ds := &digestServer{}
	ds.status.Store(int32(status))
	ds.body.Store(body)
	ds.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case query.ProtocolFeaturesPath:
			ds.featureRequests.Add(1)
			st := int(ds.status.Load())
			if st == 0 {
				http.NotFound(w, r)
				return
			}
			w.WriteHeader(st)
			_, _ = w.Write([]byte(ds.body.Load().(string)))
		case "/cosmos/upgrade/v1beta1/applied_plan/v3.2.3":
			ds.planRequests.Add(1)
			_, _ = w.Write([]byte(`{"height":"` + planHeight + `"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(ds.Close)
	return ds
}

func TestEVMAuthDigestVersionFeatureFirst(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		body       string
		planHeight string
		want       string
		wantErr    bool
		planAsked  bool
	}{
		{"enabled", 200, hardeningOn, "0", EVMAuthDigestV2, false, false},
		{"disabled", 200, hardeningOff, "8003746", EVMAuthDigestV1, false, false},
		{"absent falls back to applied plan", 200, hardeningNo, "8003746", EVMAuthDigestV2, false, true},
		{"404 falls back to applied plan", 0, "", "8003746", EVMAuthDigestV2, false, true},
		{"404 falls back, plan not applied", 0, "", "0", EVMAuthDigestV1, false, true},
		{"501 falls back to applied plan", 501, `{"code":12,"message":"Not Implemented"}`, "8003746", EVMAuthDigestV2, false, true},
		{"empty list falls back to applied plan", 200, `{"features":[],"height":"1"}`, "0", EVMAuthDigestV1, false, true},
		{"no features key falls back to applied plan", 200, `{}`, "8003746", EVMAuthDigestV2, false, true},
		{"500 is an error", 500, `{"code":13}`, "8003746", "", true, false},
		{"429 is an error", 429, `slow down`, "8003746", "", true, false},
		{"unparsable is an error", 200, `<html>`, "8003746", "", true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ds := newDigestServer(t, c.status, c.body, c.planHeight)
			got, err := ResolveEVMAuthDigestVersion(ds.URL, "", ds.Client())
			if c.wantErr {
				if err == nil {
					t.Fatalf("got %q; want an error", got)
				}
				// Errors are not cached: the next call asks again.
				_, _ = ResolveEVMAuthDigestVersion(ds.URL, "auto", ds.Client())
				if n := ds.featureRequests.Load(); n != 2 {
					t.Fatalf("feature requests = %d, want 2 (errors are not cached)", n)
				}
			} else if err != nil || got != c.want {
				t.Fatalf("got %q, %v; want %s", got, err, c.want)
			}
			if asked := ds.planRequests.Load() > 0; asked != c.planAsked {
				t.Fatalf("applied_plan asked = %v, want %v", asked, c.planAsked)
			}
		})
	}
}

func TestEVMAuthDigestVersionConnectionRefused(t *testing.T) {
	ClearEVMAuthDigestCache()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	if v, err := ResolveEVMAuthDigestVersion("http://"+addr, "", nil); err == nil {
		t.Fatalf("got %q; want an error when the node refuses the connection", v)
	}
}

func TestEVMAuthDigestExplicitVersionMakesNoRequest(t *testing.T) {
	ds := newDigestServer(t, 500, `down`, "0")
	for _, v := range []string{EVMAuthDigestV1, EVMAuthDigestV2, "V2"} {
		got, err := ResolveEVMAuthDigestVersion(ds.URL, v, ds.Client())
		if err != nil || got == "" {
			t.Fatalf("%s: got %q, %v", v, got, err)
		}
	}
	if n := ds.featureRequests.Load() + ds.planRequests.Load(); n != 0 {
		t.Fatalf("requests = %d, want 0", n)
	}
	if _, err := ResolveEVMAuthDigestVersion(ds.URL, "v3", ds.Client()); err == nil {
		t.Fatal("an unknown version must be refused")
	}
}

func TestEVMAuthDigestVersionCachedWithinTTL(t *testing.T) {
	ds := newDigestServer(t, 200, hardeningOn, "0")
	now := time.Unix(1_700_000_000, 0)
	evmDigestNow = func() time.Time { return now }
	defer func() { evmDigestNow = time.Now }()
	rest := query.NewRestClient(ds.URL, ds.Client())
	if v, err := EVMAuthDigestVersion(rest); err != nil || v != EVMAuthDigestV2 {
		t.Fatalf("first = %q, %v", v, err)
	}
	// Within the TTL a node outage does not fail the next call.
	ds.status.Store(500)
	now = now.Add(EVMAuthDigestTTL - time.Second)
	if v, err := EVMAuthDigestVersion(rest); err != nil || v != EVMAuthDigestV2 {
		t.Fatalf("cached = %q, %v", v, err)
	}
	if n := ds.featureRequests.Load(); n != 1 {
		t.Fatalf("feature requests = %d, want 1 (cached)", n)
	}
	// After the TTL the node is asked again, and its failure is an error.
	now = now.Add(2 * time.Second)
	if _, err := EVMAuthDigestVersion(rest); err == nil {
		t.Fatal("expected an error once the cached answer expired and the node is down")
	}
	if n := ds.featureRequests.Load(); n != 2 {
		t.Fatalf("feature requests = %d, want 2", n)
	}
}
