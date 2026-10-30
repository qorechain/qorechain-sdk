package query

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
)

func v325Server(t *testing.T, routes map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := routes[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotImplemented)
			_, _ = w.Write([]byte(`{"code":12,"message":"Not Implemented"}`))
			return
		}
		_, _ = w.Write([]byte(body))
	}))
}

func TestGetKEMKey(t *testing.T) {
	pub := bytes.Repeat([]byte{0x11}, 1568)
	srv := v325Server(t, map[string]string{
		"/qorechain/pqc/v1/kem/qor1found": `{"found":true,"key":{"address":"qor1found","algorithm_id":2,"algorithm_name":"mlkem1024","public_key":"` +
			base64.StdEncoding.EncodeToString(pub) + `","registered_height":"8979497"}}`,
		"/qorechain/pqc/v1/kem/qor1none": `{"found":false,"key":null}`,
	})
	defer srv.Close()
	c := NewRestClient(srv.URL, srv.Client())

	got, err := c.GetKEMKey("qor1found")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Found || got.Key == nil || got.Key.AlgorithmID != 2 || got.Key.AlgorithmName != "mlkem1024" ||
		got.Key.RegisteredHeight != 8979497 || !bytes.Equal(got.Key.PublicKey, pub) || got.Key.Address != "qor1found" {
		t.Fatalf("got %+v", got.Key)
	}
	none, err := c.GetKEMKey("qor1none")
	if err != nil || none.Found || none.Key != nil {
		t.Fatalf("none = %+v, %v", none, err)
	}
	if KEMKeyPath("0xAbC") != "/qorechain/pqc/v1/kem/0xAbC" {
		t.Errorf("path = %s", KEMKeyPath("0xAbC"))
	}
}

func TestGetSpendingRulesAndAuthenticators(t *testing.T) {
	srv := v325Server(t, map[string]string{
		"/qorechain/abstractaccount/v1/accounts/qor1acct/spending_rules": `{"rules":[{"id":"r1","daily_limit":"1000","per_tx_limit":"100","allowed_denoms":["uqor"],"enabled":true,` +
			`"allowed_evm_calls":[],"denom_limits":[{"denom":"erc20/0x0000000000000000000000000000000000000001","per_tx_limit":"5","daily_limit":""}]}],` +
			`"authenticator_rules":[{"scheme":"eip191","pubkey_hex":"02ab","rule":{"id":"k","per_tx_limit":"7","enabled":true}}]}`,
		"/qorechain/abstractaccount/v1/accounts/qor1acct/authenticators": `{"authenticators":[{"scheme":"eip191","pubkey_hex":"02ab","permissions":["evm"],` +
			`"expiry_unix":"1900000000","label":"phone","created_at_unix":"1800000000","revoked":false,"has_spend_rule":true,"future_field":1}]}`,
		CrossVMParamsPath: `{"max_message_size":"65536","max_queue_size":1000,"queue_timeout_blocks":"100","enabled":true,"bridge_allowed_targets":["cosmwasm:qor1x"]}`,
	})
	defer srv.Close()
	c := NewRestClient(srv.URL, srv.Client())

	rules, err := c.GetSpendingRules("qor1acct")
	if err != nil {
		t.Fatal(err)
	}
	if len(rules.Rules) != 1 || rules.Rules[0].DailyLimit != 1000 || rules.Rules[0].PerTxLimit != 100 || !rules.Rules[0].Enabled ||
		len(rules.Rules[0].DenomLimits) != 1 || rules.Rules[0].DenomLimits[0].PerTxLimit != "5" {
		t.Fatalf("rules = %+v", rules.Rules)
	}
	if len(rules.AuthenticatorRules) != 1 || rules.AuthenticatorRules[0].PubkeyHex != "02ab" || rules.AuthenticatorRules[0].Rule.PerTxLimit != 7 {
		t.Fatalf("authenticator rules = %+v", rules.AuthenticatorRules)
	}

	auths, err := c.GetAuthenticators("qor1acct")
	if err != nil {
		t.Fatal(err)
	}
	if len(auths.Authenticators) != 1 {
		t.Fatalf("authenticators = %+v", auths)
	}
	a := auths.Authenticators[0]
	if a.Scheme != "eip191" || a.ExpiryUnix != 1900000000 || a.CreatedAtUnix != 1800000000 || !a.HasSpendRule || a.Label != "phone" || len(a.Permissions) != 1 {
		t.Fatalf("authenticator = %+v", a)
	}

	p, err := c.GetCrossVMParams()
	if err != nil {
		t.Fatal(err)
	}
	if p.MaxMessageSize != 65536 || p.QueueTimeoutBlocks != 100 || len(p.BridgeAllowedTargets) != 1 {
		t.Fatalf("crossvm params = %+v", p)
	}

	if _, err := c.GetSpendingRules("qor1missing"); err == nil {
		t.Fatal("an unserved route should fail")
	}
}
