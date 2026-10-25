package query

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const (
	v324Addr = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k"
	v324Val  = "qorvaloper1hkkxx5jmmw02wcz26c74lsp74qysj6h4ewkcwk"
)

// jsonServer answers every request with body and records the paths asked.
func jsonServer(t *testing.T, body string) (*RestClient, *[]string) {
	t.Helper()
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return NewRestClient(srv.URL+"/", srv.Client()), &paths
}

func TestChainUpgradeV3_2_4(t *testing.T) {
	if ChainUpgradeV3_2_4 != "v3.2.4" {
		t.Fatal(ChainUpgradeV3_2_4)
	}
}

func TestStakingTierReadsTheMainnetShapes(t *testing.T) {
	c, paths := jsonServer(t, `{"lock_tiers":[{"months":3,"bonus_bps":150},{"months":12,"bonus_bps":500}],"light_node_bonus_bps":200,"validator_bonus_bps":300,"max_total_apy_bps":2500,"early_unlock_penalty_bps":500,"enabled":true,"min_lock_amount":"10000000"}`)
	params, err := c.GetStakingTierParams()
	if err != nil {
		t.Fatal(err)
	}
	if (*paths)[0] != "/qorechain/stakingtier/v1/params" {
		t.Fatalf("path %s", (*paths)[0])
	}
	if len(params.LockTiers) != 2 || params.LockTiers[0] != (StakingLockTier{Months: 3, BonusBps: 150}) || params.LockTiers[1] != (StakingLockTier{Months: 12, BonusBps: 500}) {
		t.Fatalf("tiers %+v", params.LockTiers)
	}
	if params.MinLockAmount.Int64() != 10_000_000 || !params.Enabled || params.MaxTotalApyBps != 2500 || params.LightNodeBonusBps != 200 {
		t.Fatalf("%+v", params)
	}

	c, paths = jsonServer(t, `{"locks":[{"id":"1","validator":"`+v324Val+`","locked_amount":"20000000","months":6,"end_time":"1800000000","accrued_bonus":"5","released":false}],"claimable":"5","total_claimable":"5"}`)
	locks, err := c.GetStakingLocks(v324Addr)
	if err != nil {
		t.Fatal(err)
	}
	if (*paths)[0] != "/qorechain/stakingtier/v1/locks/"+v324Addr {
		t.Fatalf("path %s", (*paths)[0])
	}
	l := locks.Locks[0]
	if l.ID != 1 || l.Validator != v324Val || l.LockedAmount.Int64() != 20_000_000 || l.Months != 6 || l.EndTime != 1_800_000_000 || l.Released || l.AccruedBonus.Int64() != 5 {
		t.Fatalf("%+v", l)
	}
	// Fields the answer omits read as zero, never a nil Int.
	if l.ProjectedBonusToExpiry.IsNil() || !l.ProjectedBonusToExpiry.IsZero() || l.StartHeight != 0 || l.ProjectedBonusBps != "" {
		t.Fatalf("omitted fields: %+v", l)
	}
	if locks.Claimable.Int64() != 5 || locks.TotalClaimable.Int64() != 5 {
		t.Fatalf("%+v", locks)
	}

	c, _ = jsonServer(t, `{"balance":"0","lock_count":"3","last_base_apy_bps":"4510.47"}`)
	pool, err := c.GetStakingTierPool()
	if err != nil {
		t.Fatal(err)
	}
	if pool.LockCount != 3 || pool.LastBaseApyBps != "4510.47" || !pool.Balance.IsZero() || !pool.TotalPaid.IsZero() {
		t.Fatalf("%+v", pool)
	}
	if _, err := ParseStakingTierPool([]byte(`{"balance":"1.5"}`)); err == nil {
		t.Fatal("a decimal amount accepted")
	}
}

func TestProtocolFeatures(t *testing.T) {
	c, paths := jsonServer(t, `{"features":[{"name":"pqc-sign-bytes-v2","enabled":true,"known":true,"staged":false},{"name":"x","enabled":false,"known":true,"staged":true}],"height":"3758400"}`)
	r, err := c.GetProtocolFeatures()
	if err != nil {
		t.Fatal(err)
	}
	if (*paths)[0] != "/qorechain/pqc/v1/protocol_features" {
		t.Fatalf("path %s", (*paths)[0])
	}
	if r.Height != 3_758_400 || r.Features[1] != (ProtocolFeature{Name: "x", Enabled: false, Known: true, Staged: true}) {
		t.Fatalf("%+v", r)
	}
	for name, want := range map[string]bool{"pqc-sign-bytes-v2": true, "x": false, "absent": false} {
		if got, err := c.IsProtocolFeatureEnabled(name); err != nil || got != want {
			t.Errorf("%s: %v %v", name, got, err)
		}
	}
}

func TestProtocolFeaturesOnAnOlderNodeIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotImplemented)
	}))
	defer srv.Close()
	if _, err := NewRestClient(srv.URL, srv.Client()).IsProtocolFeatureEnabled("x"); err == nil {
		t.Fatal("an unanswered query must be an error, never 'off'")
	}
}

func TestAuthNonceBytesOrHex(t *testing.T) {
	c, paths := jsonServer(t, `{"nonce":"7","linked":true}`)
	r, err := c.GetAuthNonce(v324Addr, []byte{0xab, 0x01})
	if err != nil || r.Nonce != 7 || !r.Linked {
		t.Fatalf("%+v %v", r, err)
	}
	if (*paths)[0] != "/qorechain/abstractaccount/v1/auth_nonce/"+v324Addr+"/ab01" {
		t.Fatalf("path %s", (*paths)[0])
	}
	if _, err := c.GetAuthNonceHex(v324Addr, "0xAB01"); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix((*paths)[1], "/AB01") {
		t.Fatalf("path %s", (*paths)[1])
	}
	for _, bad := range []string{"zz", "", "0x", "abc"} {
		if _, err := c.GetAuthNonceHex(v324Addr, bad); err == nil || !strings.Contains(err.Error(), "hex") {
			t.Errorf("%q: %v", bad, err)
		}
	}
	if _, err := c.GetAuthNonce(v324Addr, nil); err == nil {
		t.Error("empty key accepted")
	}
	if len(*paths) != 2 {
		t.Fatalf("a refused key must not reach the node: %d requests", len(*paths))
	}
	if _, err := ParseAuthNonce([]byte(`{"linked":true}`)); err == nil {
		t.Fatal("an answer without a nonce read as 0")
	}
	if r, err := ParseAuthNonce([]byte(`{"nonce":"0","linked":false}`)); err != nil || r.Nonce != 0 || r.Linked {
		t.Fatalf("%+v %v", r, err)
	}
}
