package pqcdx

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
)

// planServer answers the applied-plan query with planBody and accepts every
// broadcast / poll.
func planServer(t *testing.T, planBody string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cosmos/upgrade/v1beta1/applied_plan/v3.1.98":
			_, _ = w.Write([]byte(planBody))
		case "/cosmos/tx/v1beta1/txs":
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0}}`))
		default:
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0,"height":"10"}}`))
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestMigrateToHybridResolvesSignBytesPerNetwork(t *testing.T) {
	for _, c := range []struct {
		plan string
		want signbytes.Version
	}{
		{`{"height":"5746000"}`, signbytes.V2},
		{`{"height":"0"}`, signbytes.V1},
	} {
		srv := planServer(t, c.plan)
		signer := testSigner(t)
		signer.RestURL = srv.URL
		signer.SignBytesResolver = signbytes.NewResolver(signbytes.ResolverOptions{})
		cl := New(signer, Options{Qor: &fakeQor{resp: json.RawMessage(`{"registered":true}`)}})
		res, err := cl.MigrateToHybrid(testBankSend(signer.Account.Address), MigrateToHybridOptions{})
		if err != nil {
			t.Fatalf("plan %s: %v", c.plan, err)
		}
		if res.SignBytesVersion != c.want || res.Retried {
			t.Fatalf("plan %s: version %s retried %v, want %s", c.plan, res.SignBytesVersion, res.Retried, c.want)
		}
	}
}

func TestMigrateToHybridExplicitSignBytes(t *testing.T) {
	srv := planServer(t, `{"height":"0"}`)
	signer := testSigner(t)
	signer.RestURL = srv.URL
	signer.SignBytesVersion = signbytes.V2
	cl := New(signer, Options{Qor: &fakeQor{resp: json.RawMessage(`{"registered":true}`)}})
	res, err := cl.MigrateToHybrid(testBankSend(signer.Account.Address), MigrateToHybridOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if res.SignBytesVersion != signbytes.V2 {
		t.Fatalf("version = %s, want v2", res.SignBytesVersion)
	}
}

func TestMigrateToHybridLegacyWithoutRestURLFails(t *testing.T) {
	signer := testSigner(t) // qorechain-vladi, no RestURL
	signer.SignBytesResolver = signbytes.NewResolver(signbytes.ResolverOptions{})
	cl := New(signer, Options{Qor: &fakeQor{resp: json.RawMessage(`{"registered":true}`)}})
	_, err := cl.MigrateToHybrid(testBankSend(signer.Account.Address), MigrateToHybridOptions{})
	if !errors.Is(err, signbytes.ErrUnresolvedVersion) {
		t.Fatalf("err = %v, want ErrUnresolvedVersion", err)
	}
}
