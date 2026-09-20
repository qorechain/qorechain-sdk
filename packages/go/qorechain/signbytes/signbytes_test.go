package signbytes

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// ---- KAT vectors (chain v3.1.98) ----

type katFile struct {
	HybridDomain    string `json:"hybrid_domain"`
	MigrationDomain string `json:"migration_domain"`
	HybridV2        []struct {
		Name         string `json:"name"`
		ChainID      string `json:"chain_id"`
		BodyHex      string `json:"body_without_pqc_ext_hex"`
		AuthInfoHex  string `json:"auth_info_hex"`
		SignBytesHex string `json:"sign_bytes_hex"`
	} `json:"hybrid_v2"`
	MigrationV2 []struct {
		Name            string      `json:"name"`
		ChainID         string      `json:"chain_id"`
		Account         string      `json:"account"`
		FromAlgorithmID json.Number `json:"from_algorithm_id"`
		ToAlgorithmID   json.Number `json:"to_algorithm_id"`
		ExecutionHeight json.Number `json:"execution_height"`
		OldPubHex       string      `json:"old_public_key_hex"`
		NewPubHex       string      `json:"new_public_key_hex"`
		SignBytesHex    string      `json:"sign_bytes_hex"`
	} `json:"migration_v2"`
	BridgeV2 []struct {
		Name         string `json:"name"`
		ChainID      string `json:"chain_id"`
		Chain        string `json:"chain"`
		EventType    string `json:"event_type"`
		OperationID  string `json:"operation_id"`
		TxHash       string `json:"tx_hash"`
		Amount       string `json:"amount"`
		Asset        string `json:"asset"`
		SignBytesHex string `json:"sign_bytes_hex"`
	} `json:"bridge_attestation_v2"`
}

func loadKAT(t *testing.T) katFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "signbytes-kat-v3.1.98.json"))
	if err != nil {
		t.Fatalf("read KAT: %v", err)
	}
	var k katFile
	if err := json.Unmarshal(raw, &k); err != nil {
		t.Fatalf("parse KAT: %v", err)
	}
	return k
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("hex %q: %v", s, err)
	}
	return b
}

func mustU32(t *testing.T, s string) uint32 {
	t.Helper()
	n, err := strconv.ParseUint(s, 10, 32)
	if err != nil {
		t.Fatalf("uint32 %q: %v", s, err)
	}
	return uint32(n)
}

func TestKATVectors(t *testing.T) {
	k := loadKAT(t)
	if k.HybridDomain != HybridDomain {
		t.Errorf("hybrid domain = %q, KAT %q", HybridDomain, k.HybridDomain)
	}
	if k.MigrationDomain != MigrationDomain {
		t.Errorf("migration domain = %q, KAT %q", MigrationDomain, k.MigrationDomain)
	}
	count := 0
	for _, v := range k.HybridV2 {
		want := mustHex(t, v.SignBytesHex)
		b0, a := mustHex(t, v.BodyHex), mustHex(t, v.AuthInfoHex)
		if got := HybridV2(v.ChainID, b0, a); !bytes.Equal(got, want) {
			t.Errorf("hybrid_v2/%s: mismatch\n got %x\nwant %x", v.Name, got, want)
		}
		got, err := Hybrid(V2, v.ChainID, b0, a)
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("hybrid_v2/%s: dispatcher mismatch (err %v)", v.Name, err)
		}
		count++
	}
	for _, v := range k.MigrationV2 {
		want := mustHex(t, v.SignBytesHex)
		h, err := strconv.ParseInt(v.ExecutionHeight.String(), 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		from, to := mustU32(t, v.FromAlgorithmID.String()), mustU32(t, v.ToAlgorithmID.String())
		oldPub, newPub := mustHex(t, v.OldPubHex), mustHex(t, v.NewPubHex)
		if got := MigrationV2(v.ChainID, v.Account, from, to, h, oldPub, newPub); !bytes.Equal(got, want) {
			t.Errorf("migration_v2/%s: mismatch\n got %x\nwant %x", v.Name, got, want)
		}
		got, err := Migration(V2, v.ChainID, v.Account, from, to, h, oldPub, newPub)
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("migration_v2/%s: dispatcher mismatch (err %v)", v.Name, err)
		}
		count++
	}
	for _, v := range k.BridgeV2 {
		want := mustHex(t, v.SignBytesHex)
		att := BridgeAttestation{
			Chain: v.Chain, EventType: v.EventType, OperationID: v.OperationID,
			TxHash: v.TxHash, Amount: v.Amount, Asset: v.Asset,
		}
		if got := BridgeV2(v.ChainID, att); !bytes.Equal(got, want) {
			t.Errorf("bridge_attestation_v2/%s: mismatch\n got %x\nwant %x", v.Name, got, want)
		}
		got, err := Bridge(V2, v.ChainID, att)
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("bridge_attestation_v2/%s: dispatcher mismatch (err %v)", v.Name, err)
		}
		count++
	}
	if count != 11 {
		t.Fatalf("reproduced %d KAT vectors, want 11", count)
	}
}

// ---- v1 layouts ----

func TestHybridV1Layout(t *testing.T) {
	b0 := []byte{0x0a, 0x01, 0x02}
	a := []byte{0x12, 0x03, 0x04, 0x05}
	want := mustHex(t, "00000003"+"0a0102"+"00000004"+"12030405")
	if got := HybridV1(b0, a); !bytes.Equal(got, want) {
		t.Fatalf("HybridV1 = %x, want %x", got, want)
	}
	if got, _ := Hybrid(V1, "qorechain-vladi", b0, a); !bytes.Equal(got, want) {
		t.Fatalf("Hybrid(V1) = %x, want %x", got, want)
	}
	if got := HybridV1(nil, nil); !bytes.Equal(got, make([]byte, 8)) {
		t.Fatalf("HybridV1(empty) = %x", got)
	}
	// v2 = domain ‖ BE64(len chainID) ‖ chainID ‖ v1 body.
	v2 := HybridV2("qorechain-diana", b0, a)
	prefix := append([]byte(HybridDomain), 0, 0, 0, 0, 0, 0, 0, 15)
	prefix = append(prefix, "qorechain-diana"...)
	if !bytes.Equal(v2, append(prefix, want...)) {
		t.Fatalf("HybridV2 is not domain‖BE64(len)‖chainID‖v1: %x", v2)
	}
}

func TestMigrationV1Legacy(t *testing.T) {
	got := MigrationV1("qorechain-vladi", "qor1account", 1, 3, 4200)
	want := "qorechain-key-migration:chain=qorechain-vladi:from=1:to=3:account=qor1account:height=4200"
	if string(got) != want {
		t.Fatalf("MigrationV1 = %q, want %q", got, want)
	}
	d, err := Migration(V1, "qorechain-vladi", "qor1account", 1, 3, 4200, []byte("old"), []byte("new"))
	if err != nil || string(d) != want {
		t.Fatalf("Migration(V1) = %q, %v (keys must be ignored by v1)", d, err)
	}
}

func TestBridgeV1Legacy(t *testing.T) {
	att := BridgeAttestation{Chain: "ethereum", EventType: "deposit", OperationID: "op-0001", TxHash: "0xabc123", Amount: "1000000", Asset: "uqor"}
	want := "ethereum|deposit|op-0001|0xabc123|1000000|uqor"
	if got := BridgeV1(att); string(got) != want {
		t.Fatalf("BridgeV1 = %q, want %q", got, want)
	}
	d, err := Bridge(V1, "qorechain-vladi", att)
	if err != nil || string(d) != want {
		t.Fatalf("Bridge(V1) = %q, %v (v1 carries no chain id)", d, err)
	}
	if got := BridgeV1(BridgeAttestation{Amount: "0"}); string(got) != "||||0|" {
		t.Fatalf("BridgeV1(empty) = %q", got)
	}
}

func TestDispatchersRejectUnresolved(t *testing.T) {
	for _, v := range []Version{"", Auto} {
		if _, err := Hybrid(v, "x", nil, nil); !errors.Is(err, ErrUnresolvedVersion) {
			t.Errorf("Hybrid(%q) err = %v, want ErrUnresolvedVersion", v, err)
		}
		if _, err := Migration(v, "x", "a", 1, 3, 1, nil, nil); !errors.Is(err, ErrUnresolvedVersion) {
			t.Errorf("Migration(%q) err = %v", v, err)
		}
		if _, err := Bridge(v, "x", BridgeAttestation{}); !errors.Is(err, ErrUnresolvedVersion) {
			t.Errorf("Bridge(%q) err = %v", v, err)
		}
	}
	if _, err := Hybrid("v3", "x", nil, nil); err == nil {
		t.Error("Hybrid(v3) must fail")
	}
}

// ---- version selection ----

func TestVersionForTruthTable(t *testing.T) {
	cases := []struct {
		chain  string
		height int64
		want   Version
	}{
		{"qorechain-vladi", 0, V1},
		{"qorechain-vladi", 5746000, V2},
		{"qorechain-diana", 0, V1},
		{"qorechain-diana", 5746000, V2},
		{"qorechain-other", 0, V2},
		{"qorechain-other", 5746000, V2},
	}
	for _, c := range cases {
		if got := VersionFor(c.chain, c.height); got != c.want {
			t.Errorf("VersionFor(%s, %d) = %s, want %s", c.chain, c.height, got, c.want)
		}
	}
}

func TestResolveOffline(t *testing.T) {
	for _, c := range []struct {
		chain string
		req   Version
		want  Version
	}{
		{"qorechain-vladi", V1, V1},
		{"qorechain-vladi", V2, V2},
		{"qorechain-new", "", V2},
		{"qorechain-new", Auto, V2},
	} {
		got, err := ResolveOffline(c.chain, c.req)
		if err != nil || got != c.want {
			t.Errorf("ResolveOffline(%s, %q) = %s, %v; want %s", c.chain, c.req, got, err, c.want)
		}
	}
	for _, chain := range LegacyChains() {
		if _, err := ResolveOffline(chain, ""); !errors.Is(err, ErrUnresolvedVersion) {
			t.Errorf("ResolveOffline(%s, auto) err = %v, want ErrUnresolvedVersion", chain, err)
		}
	}
	if _, err := ResolveOffline("qorechain-new", "v9"); err == nil {
		t.Error("invalid version must fail")
	}
}

func TestParseVersion(t *testing.T) {
	for in, want := range map[string]Version{"": Auto, "auto": Auto, " V1 ": V1, "v2": V2} {
		if got, err := ParseVersion(in); err != nil || got != want {
			t.Errorf("ParseVersion(%q) = %s, %v", in, got, err)
		}
	}
	if _, err := ParseVersion("v3"); err == nil {
		t.Error("ParseVersion(v3) must fail")
	}
}

// ---- resolver ----

// planServer is an applied-plan endpoint that answers per PLAN NAME. A name with
// no body configured answers `{}` (the plan was never applied on this network),
// which is what each real network answers for the name it did not take.
type planServer struct {
	*httptest.Server
	requests atomic.Int32 // every applied-plan request
	rounds   atomic.Int32 // requests for V2Upgrades[0] — one per resolve round
	status   atomic.Int32

	mu    sync.Mutex
	plans map[string]string
	asked []string
}

func newPlanServer(t *testing.T, plans map[string]string) *planServer {
	t.Helper()
	ps := &planServer{plans: map[string]string{}}
	for k, v := range plans {
		ps.plans[k] = v
	}
	ps.status.Store(http.StatusOK)
	const prefix = "/cosmos/upgrade/v1beta1/applied_plan/"
	ps.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, prefix) {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, prefix)
		ps.requests.Add(1)
		if name == V2Upgrades[0] {
			ps.rounds.Add(1)
		}
		ps.mu.Lock()
		ps.asked = append(ps.asked, name)
		body, ok := ps.plans[name]
		ps.mu.Unlock()
		if !ok {
			body = `{}`
		}
		w.WriteHeader(int(ps.status.Load()))
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(ps.Close)
	return ps
}

// newLegacyPlanServer models diana today: the mainnet plan name v3.2.0 is not
// applied, and the record lives under the name the testnet took, v3.1.98.
func newLegacyPlanServer(t *testing.T, legacyBody string) *planServer {
	t.Helper()
	return newPlanServer(t, map[string]string{"v3.1.98": legacyBody})
}

func (ps *planServer) setPlan(name, body string) {
	ps.mu.Lock()
	ps.plans[name] = body
	ps.mu.Unlock()
}

func (ps *planServer) askedNames() []string {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	return append([]string(nil), ps.asked...)
}

// The list the resolver walks must match the chain's own
// x/pqc/types.SignBytesV2Upgrades, with the mainnet name first and the singular
// constant pointing at it.
func TestV2UpgradeNames(t *testing.T) {
	if want := []string{"v3.2.0", "v3.1.98"}; len(V2Upgrades) != len(want) {
		t.Fatalf("V2Upgrades = %v, want %v", V2Upgrades, want)
	} else {
		for i := range want {
			if V2Upgrades[i] != want[i] {
				t.Fatalf("V2Upgrades = %v, want %v", V2Upgrades, want)
			}
		}
	}
	if V2Upgrade != "v3.2.0" {
		t.Errorf("V2Upgrade = %q, want the primary name %q", V2Upgrade, "v3.2.0")
	}
	if V2Upgrades[0] != V2Upgrade {
		t.Errorf("V2Upgrades[0] = %q, want V2Upgrade %q", V2Upgrades[0], V2Upgrade)
	}
}

// Mainnet after its own upgrade: the FIRST name answers a positive height, so
// the resolver answers v2 after exactly ONE request and never asks the second.
func TestResolverFirstNameAppliedCostsOneRequest(t *testing.T) {
	ps := newPlanServer(t, map[string]string{"v3.2.0": `{"height":"7000000"}`})
	r := NewResolver(ResolverOptions{})
	got, err := r.Resolve(context.Background(), ps.URL, "qorechain-vladi", Auto)
	if err != nil || got != V2 {
		t.Fatalf("got %s, %v; want v2", got, err)
	}
	if n := ps.requests.Load(); n != 1 {
		t.Fatalf("requests = %d, want 1 (short-circuit on the first name)", n)
	}
	if asked := ps.askedNames(); len(asked) != 1 || asked[0] != "v3.2.0" {
		t.Fatalf("asked %v, want [v3.2.0]", asked)
	}
}

// Diana today: the first name is not applied, the second is. Two requests, v2.
// Before this fix the client asked v3.1.98 only, so mainnet (which applies
// v3.2.0) resolved v1 and every hybrid transaction was refused with pqc 21.
func TestResolverSecondNameAppliedCostsTwoRequests(t *testing.T) {
	ps := newLegacyPlanServer(t, `{"height":"5746000"}`)
	r := NewResolver(ResolverOptions{})
	got, err := r.Resolve(context.Background(), ps.URL, "qorechain-diana", Auto)
	if err != nil || got != V2 {
		t.Fatalf("got %s, %v; want v2", got, err)
	}
	if n := ps.requests.Load(); n != 2 {
		t.Fatalf("requests = %d, want 2", n)
	}
	asked := ps.askedNames()
	if len(asked) != 2 || asked[0] != "v3.2.0" || asked[1] != "v3.1.98" {
		t.Fatalf("asked %v, want [v3.2.0 v3.1.98]", asked)
	}
}

// Mainnet before its upgrade: every name answers zero (as "0" or as {}), so the
// resolver answers v1 — and only then.
func TestResolverNoNameAppliedIsV1(t *testing.T) {
	for _, c := range []struct {
		name  string
		plans map[string]string
	}{
		{"both zero", map[string]string{"v3.2.0": `{"height":"0"}`, "v3.1.98": `{"height":"0"}`}},
		{"both empty objects", map[string]string{"v3.2.0": `{}`, "v3.1.98": `{}`}},
		{"zero and empty", map[string]string{"v3.2.0": `{"height":"0"}`, "v3.1.98": `{}`}},
	} {
		t.Run(c.name, func(t *testing.T) {
			ps := newPlanServer(t, c.plans)
			r := NewResolver(ResolverOptions{})
			got, err := r.Resolve(context.Background(), ps.URL, "qorechain-vladi", Auto)
			if err != nil || got != V1 {
				t.Fatalf("got %s, %v; want v1", got, err)
			}
			if n := ps.requests.Load(); n != 2 {
				t.Fatalf("requests = %d, want 2 (every name asked before answering v1)", n)
			}
		})
	}
}

func TestResolverAppliedPlanAnswers(t *testing.T) {
	ctx := context.Background()
	for _, c := range []struct {
		body string
		want Version
	}{
		{`{"height":"5746000"}`, V2},
		{`{"height":"0"}`, V1},
		{`{}`, V1},
		{`{"height":5746000}`, V2},
	} {
		ps := newLegacyPlanServer(t, c.body)
		r := NewResolver(ResolverOptions{})
		got, err := r.Resolve(ctx, ps.URL+"/", "qorechain-diana", Auto)
		if err != nil || got != c.want {
			t.Errorf("body %s: got %s, %v; want %s", c.body, got, err, c.want)
		}
	}
}

func TestResolverNonLegacyAndExplicitSkipNetwork(t *testing.T) {
	ps := newLegacyPlanServer(t, `{"height":"0"}`)
	r := NewResolver(ResolverOptions{})
	if v, err := r.Resolve(context.Background(), ps.URL, "qorechain-future", Auto); err != nil || v != V2 {
		t.Fatalf("non-legacy auto = %s, %v; want v2", v, err)
	}
	if v, err := r.Resolve(context.Background(), "", "qorechain-vladi", V1); err != nil || v != V1 {
		t.Fatalf("explicit v1 = %s, %v", v, err)
	}
	if v, err := r.Resolve(context.Background(), "", "qorechain-vladi", V2); err != nil || v != V2 {
		t.Fatalf("explicit v2 = %s, %v", v, err)
	}
	// An explicit version skips the network even when a REST URL is at hand.
	if v, err := r.Resolve(context.Background(), ps.URL, "qorechain-vladi", V1); err != nil || v != V1 {
		t.Fatalf("explicit v1 with a rest url = %s, %v", v, err)
	}
	if n := ps.requests.Load(); n != 0 {
		t.Fatalf("expected no HTTP calls, got %d", n)
	}
}

func TestResolverLegacyWithoutRestURLErrors(t *testing.T) {
	r := NewResolver(ResolverOptions{})
	_, err := r.Resolve(context.Background(), "", "qorechain-vladi", Auto)
	if !errors.Is(err, ErrUnresolvedVersion) {
		t.Fatalf("err = %v, want ErrUnresolvedVersion", err)
	}
	for _, name := range V2Upgrades {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error %q does not name upgrade %s", err, name)
		}
	}
}

func TestResolverHTTPFailureErrors(t *testing.T) {
	ps := newLegacyPlanServer(t, `upstream down`)
	ps.setPlan("v3.2.0", `upstream down`)
	ps.status.Store(http.StatusBadGateway)
	r := NewResolver(ResolverOptions{})
	err := func() error {
		_, err := r.Resolve(context.Background(), ps.URL, "qorechain-diana", Auto)
		return err
	}()
	if !errors.Is(err, ErrUnresolvedVersion) {
		t.Fatalf("HTTP 502 err = %v, want ErrUnresolvedVersion", err)
	}
	for _, name := range V2Upgrades {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error %q does not name upgrade %s", err, name)
		}
	}
	// Malformed JSON is a failure too, never a guess.
	ps.status.Store(http.StatusOK)
	ps.setPlan("v3.2.0", `not json`)
	if _, err := r.Resolve(context.Background(), ps.URL, "qorechain-diana", Auto); !errors.Is(err, ErrUnresolvedVersion) {
		t.Fatalf("bad JSON err = %v", err)
	}
	// A failure on the SECOND name is a failure too: the first answering zero
	// must never be read as "not applied anywhere".
	ps.setPlan("v3.2.0", `{"height":"0"}`)
	ps.setPlan("v3.1.98", `not json`)
	err2 := func() error {
		_, err := r.Resolve(context.Background(), ps.URL, "qorechain-diana", Auto)
		return err
	}()
	if !errors.Is(err2, ErrUnresolvedVersion) {
		t.Fatalf("bad JSON on the second name err = %v", err2)
	}
	if !strings.Contains(err2.Error(), "v3.1.98") {
		t.Errorf("error %q does not say which plan failed", err2)
	}
	// Unreachable host.
	dead := httptest.NewServer(http.NotFoundHandler())
	url := dead.URL
	dead.Close()
	if _, err := r.Resolve(context.Background(), url, "qorechain-vladi", Auto); !errors.Is(err, ErrUnresolvedVersion) {
		t.Fatalf("unreachable err = %v", err)
	}
}

func TestResolverCacheTTLRefreshAndClear(t *testing.T) {
	ps := newLegacyPlanServer(t, `{"height":"0"}`)
	now := time.Unix(1_000_000, 0)
	r := NewResolver(ResolverOptions{TTL: time.Minute, Now: func() time.Time { return now }})
	ctx := context.Background()

	if v, _ := r.Resolve(ctx, ps.URL, "qorechain-diana", Auto); v != V1 {
		t.Fatalf("first = %s", v)
	}
	// The network upgrades; within the TTL the cached answer is served.
	ps.setPlan("v3.1.98", `{"height":"5746000"}`)
	now = now.Add(30 * time.Second)
	if v, _ := r.Resolve(ctx, ps.URL, "qorechain-diana", Auto); v != V1 {
		t.Fatalf("cached = %s, want v1", v)
	}
	if n := ps.rounds.Load(); n != 1 {
		t.Fatalf("cache hit should not query: rounds %d", n)
	}
	// One cached answer covers BOTH names, not one request each.
	if n := ps.requests.Load(); n != 2 {
		t.Fatalf("requests = %d, want 2 (one round of two names)", n)
	}
	// Force refresh bypasses the cache and replaces the entry.
	if v, _ := r.Refresh(ctx, ps.URL, "qorechain-diana", Auto); v != V2 {
		t.Fatalf("refresh = %s, want v2", v)
	}
	if v, _ := r.Resolve(ctx, ps.URL, "qorechain-diana", Auto); v != V2 {
		t.Fatalf("after refresh = %s, want v2", v)
	}
	if n := ps.rounds.Load(); n != 2 {
		t.Fatalf("rounds = %d, want 2", n)
	}
	// Cache is keyed per chain id: another legacy chain queries separately.
	if _, err := r.Resolve(ctx, ps.URL, "qorechain-vladi", Auto); err != nil {
		t.Fatal(err)
	}
	if n := ps.rounds.Load(); n != 3 {
		t.Fatalf("rounds = %d, want 3", n)
	}
	// Expiry after the TTL.
	now = now.Add(2 * time.Minute)
	_, _ = r.Resolve(ctx, ps.URL, "qorechain-diana", Auto)
	if n := ps.rounds.Load(); n != 4 {
		t.Fatalf("rounds after expiry = %d, want 4", n)
	}
	// ClearCache forces the next call to ask again.
	r.ClearCache()
	_, _ = r.Resolve(ctx, ps.URL, "qorechain-diana", Auto)
	if n := ps.rounds.Load(); n != 5 {
		t.Fatalf("rounds after clear = %d, want 5", n)
	}
}

func TestIsHybridRejection(t *testing.T) {
	cases := []struct {
		cs   string
		code uint32
		log  string
		want bool
	}{
		{"pqc", 21, "", true},
		{"", 4, "unauthorized: hybrid PQC signature verification failed", true},
		{"sdk", 21, "tx too large", false},
		{"", 21, "tx too large", false},
		{"bank", 21, "", false},
		{"pqc", 5, "", false},
	}
	for _, c := range cases {
		if got := IsHybridRejection(c.cs, c.code, c.log); got != c.want {
			t.Errorf("IsHybridRejection(%q,%d,%q) = %v, want %v", c.cs, c.code, c.log, got, c.want)
		}
	}
}

// A swapped (restURL, chainID) pair must fail loudly. Swapped, chainID holds a
// URL, which is not a legacy chain, so without the guard this would answer V2 —
// the form mainnet refuses — with no request made and no error.
func TestResolveRejectsSwappedArguments(t *testing.T) {
	r := NewResolver(ResolverOptions{})
	for _, tc := range []struct {
		name, restURL, chainID string
	}{
		{"swapped", "qorechain-vladi", "https://api.qore.host"},
		{"empty chain id", "https://api.qore.host", ""},
		{"rest url is not a url", "qorechain-vladi", "qorechain-vladi"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v, err := r.Resolve(context.Background(), tc.restURL, tc.chainID, Auto)
			if err == nil {
				t.Fatalf("expected an error, got version %q", v)
			}
			if !errors.Is(err, ErrUnresolvedVersion) {
				t.Fatalf("expected ErrUnresolvedVersion, got %v", err)
			}
		})
	}
}
