package pqcdx

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

var (
	mineKP  = seededKeypair(2) // the test signer's keypair
	otherKP = seededKeypair(3)
)

// keyServer is a fake REST endpoint whose status route answers, in turn, each
// of keys (nil = {"found": false}, empty = found without a key; the last answer
// repeats). Broadcasts answer
// with refusal when set, else success. It counts status reads and broadcasts.
type keyServer struct {
	*httptest.Server
	mu         sync.Mutex
	keys       [][]byte
	reads      int
	broadcasts int
}

func newKeyServer(t *testing.T, refusal string, keys ...[]byte) *keyServer {
	t.Helper()
	ClearPQCStatusCache()
	ks := &keyServer{keys: keys}
	ks.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ks.mu.Lock()
		defer ks.mu.Unlock()
		switch {
		case strings.HasPrefix(r.URL.Path, "/qorechain/pqc/v1/account/"):
			k := ks.keys[min(ks.reads, len(ks.keys)-1)]
			ks.reads++
			if k == nil {
				_, _ = w.Write([]byte(`{"found":false,"account":null}`))
				return
			}
			if len(k) == 0 {
				_, _ = w.Write([]byte(`{"found":true,"account":{}}`))
				return
			}
			_, _ = w.Write([]byte(`{"found":true,"account":{"public_key":"` + base64.StdEncoding.EncodeToString(k) + `"}}`))
		case r.URL.Path == "/cosmos/upgrade/v1beta1/applied_plan/v3.2.3":
			_, _ = w.Write([]byte(`{"height":"0"}`))
		case r.URL.Path == "/cosmos/tx/v1beta1/txs":
			ks.broadcasts++
			if refusal != "" {
				_, _ = w.Write([]byte(refusal))
				return
			}
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0}}`))
		default:
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0,"height":"10"}}`))
		}
	}))
	t.Cleanup(ks.Close)
	return ks
}

func restSigner(t *testing.T, url string) Signer {
	t.Helper()
	signer := testSigner(t)
	signer.RestURL = url
	return signer
}

const alreadyRegisteredRefusal = `{"tx_response":{"txhash":"AB","code":7,"codespace":"pqc","raw_log":"PQC account already registered"}}`

func TestEnsureRefusesWhenAnotherKeyIsRegistered(t *testing.T) {
	ks := newKeyServer(t, "", otherKP.PublicKey)
	signer := restSigner(t, ks.URL)
	_, err := New(signer, Options{}).EnsurePQCRegistered(RegisterOptions{})
	var mm *PQCKeyMismatchError
	if !errors.As(err, &mm) {
		t.Fatalf("expected *PQCKeyMismatchError, got %v", err)
	}
	if mm.Kind() != "pqc_key_mismatch" || mm.Address != signer.Account.Address {
		t.Errorf("kind %q address %q", mm.Kind(), mm.Address)
	}
	if !bytes.Equal(mm.RegisteredPublicKey, otherKP.PublicKey) || !bytes.Equal(mm.PublicKey, mineKP.PublicKey) {
		t.Error("error carries the wrong keys")
	}
	if !strings.Contains(err.Error(), "different PQC key") || !strings.Contains(err.Error(), "Nothing was sent") {
		t.Errorf("message: %s", err)
	}
	if ks.broadcasts != 0 {
		t.Fatalf("sent %d transactions", ks.broadcasts)
	}
	// The mismatch is confirmed with a fresh (uncached) read before returning.
	if ks.reads != 2 {
		t.Fatalf("expected 2 status reads, got %d", ks.reads)
	}
}

func TestEnsureRereadsSoACachedPreRotationKeyIsNoFalseAlarm(t *testing.T) {
	ks := newKeyServer(t, "", otherKP.PublicKey, mineKP.PublicKey)
	signer := restSigner(t, ks.URL)
	if _, err := FetchPQCStatus(ks.URL, signer.Account.Address); err != nil { // cached: old key
		t.Fatal(err)
	}
	res, err := New(signer, Options{}).EnsurePQCRegistered(RegisterOptions{})
	if err != nil || !res.AlreadyRegistered || !res.KeyVerified {
		t.Fatalf("%+v %v", res, err)
	}
	if ks.broadcasts != 0 {
		t.Fatalf("sent %d transactions", ks.broadcasts)
	}
}

func TestMigrateToHybridRefusesAKeypairTheChainDoesNotHold(t *testing.T) {
	ks := newKeyServer(t, "", otherKP.PublicKey)
	signer := restSigner(t, ks.URL)
	_, err := New(signer, Options{}).MigrateToHybrid(testBankSend(signer.Account.Address), MigrateToHybridOptions{})
	var mm *PQCKeyMismatchError
	if !errors.As(err, &mm) {
		t.Fatalf("expected *PQCKeyMismatchError, got %v", err)
	}
	if ks.broadcasts != 0 {
		t.Fatalf("sent %d transactions", ks.broadcasts)
	}
}

func TestEnsureComparesAStatusReadOverQorRPC(t *testing.T) {
	signer := testSigner(t) // no RestURL: a broadcast would fail
	for _, tc := range []struct {
		name     string
		pubkey   string
		mismatch bool
	}{
		{"hex other", hex.EncodeToString(otherKP.PublicKey), true},
		{"0x hex other", "0x" + hex.EncodeToString(otherKP.PublicKey), true},
		{"base64 mine", base64.StdEncoding.EncodeToString(mineKP.PublicKey), false},
		{"url-safe base64 mine", base64.RawURLEncoding.EncodeToString(mineKP.PublicKey), false},
		{"hex mine", hex.EncodeToString(mineKP.PublicKey), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q := &fakeQor{resp: json.RawMessage(`{"registered":true,"public_key":"` + tc.pubkey + `"}`)}
			res, err := New(signer, Options{Qor: q}).EnsurePQCRegistered(RegisterOptions{})
			var mm *PQCKeyMismatchError
			if tc.mismatch {
				if !errors.As(err, &mm) {
					t.Fatalf("expected *PQCKeyMismatchError, got %+v %v", res, err)
				}
				return
			}
			if err != nil || !res.AlreadyRegistered || !res.KeyVerified {
				t.Fatalf("%+v %v", res, err)
			}
		})
	}
}

func TestEnsureDoesNotCountAStatusWithoutAKeyAsAMatch(t *testing.T) {
	// Nothing to read the key from: registered, but not verified as yours.
	q := &fakeQor{resp: json.RawMessage(`{"registered":true}`)}
	res, err := New(testSigner(t), Options{Qor: q}).EnsurePQCRegistered(RegisterOptions{})
	if err != nil || !res.AlreadyRegistered || res.KeyVerified {
		t.Fatalf("%+v %v", res, err)
	}

	// With REST, an answer without the key is read again uncached and compared.
	ks := newKeyServer(t, "", []byte{}, mineKP.PublicKey)
	res, err = New(restSigner(t, ks.URL), Options{}).EnsurePQCRegistered(RegisterOptions{})
	if err != nil || !res.AlreadyRegistered || !res.KeyVerified {
		t.Fatalf("%+v %v", res, err)
	}
	if ks.reads != 2 || ks.broadcasts != 0 {
		t.Fatalf("reads %d broadcasts %d", ks.reads, ks.broadcasts)
	}

	ks = newKeyServer(t, "", []byte{}, otherKP.PublicKey)
	_, err = New(restSigner(t, ks.URL), Options{}).EnsurePQCRegistered(RegisterOptions{})
	var mm *PQCKeyMismatchError
	if !errors.As(err, &mm) || !bytes.Equal(mm.RegisteredPublicKey, otherKP.PublicKey) {
		t.Fatalf("expected *PQCKeyMismatchError, got %v", err)
	}
	if ks.broadcasts != 0 {
		t.Fatalf("sent %d transactions", ks.broadcasts)
	}

	// Still no key after the re-read: registered, not verified.
	ks = newKeyServer(t, "", []byte{})
	res, err = New(restSigner(t, ks.URL), Options{}).EnsurePQCRegistered(RegisterOptions{})
	if err != nil || !res.AlreadyRegistered || res.KeyVerified || ks.broadcasts != 0 {
		t.Fatalf("%+v %v broadcasts %d", res, err, ks.broadcasts)
	}
}

func TestEnsureChecksTheKeyAfterAnAlreadyRegisteredRefusal(t *testing.T) {
	// First read: not registered. Then someone registers OTHER before our tx lands.
	ks := newKeyServer(t, alreadyRegisteredRefusal, nil, otherKP.PublicKey)
	_, err := New(restSigner(t, ks.URL), Options{}).EnsurePQCRegistered(RegisterOptions{})
	var mm *PQCKeyMismatchError
	if !errors.As(err, &mm) || !bytes.Equal(mm.RegisteredPublicKey, otherKP.PublicKey) {
		t.Fatalf("expected *PQCKeyMismatchError, got %v", err)
	}

	ks = newKeyServer(t, alreadyRegisteredRefusal, nil, mineKP.PublicKey)
	res, err := New(restSigner(t, ks.URL), Options{}).EnsurePQCRegistered(RegisterOptions{})
	if err != nil || !res.AlreadyRegistered || !res.KeyVerified {
		t.Fatalf("%+v %v", res, err)
	}

	// The re-read carries no key: registered meanwhile, but not verified.
	ks = newKeyServer(t, alreadyRegisteredRefusal, nil, []byte{})
	res, err = New(restSigner(t, ks.URL), Options{}).EnsurePQCRegistered(RegisterOptions{})
	if err != nil || !res.AlreadyRegistered || res.KeyVerified {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestFetchPQCStatusReadsPossessionProven(t *testing.T) {
	for _, tc := range []struct {
		field string
		want  *bool
	}{
		{`,"possession_proven":true`, ptr(true)},
		{`,"possession_proven":false`, ptr(false)},
		{``, nil}, // a node below v3.2.4
	} {
		ClearPQCStatusCache()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"found":true,"account":{"public_key":"AQID"` + tc.field + `}}`))
		}))
		s, err := FetchPQCStatus(srv.URL, "qor1x")
		srv.Close()
		if err != nil {
			t.Fatal(err)
		}
		if (s.PossessionProven == nil) != (tc.want == nil) || (tc.want != nil && *s.PossessionProven != *tc.want) {
			t.Fatalf("%q: %v", tc.field, s.PossessionProven)
		}
		if tc.want == nil {
			continue
		}
		// Cached with the rest of the status, and a copy each time.
		*s.PossessionProven = !*tc.want
		again, err := FetchPQCStatus(srv.URL, "qor1x")
		if err != nil || again.PossessionProven == nil || *again.PossessionProven != *tc.want {
			t.Fatalf("cached: %v %v", again.PossessionProven, err)
		}
	}
}

func ptr[T any](v T) *T { return &v }

func TestFetchPQCStatusCacheKeepsTheKey(t *testing.T) {
	ks := newKeyServer(t, "", mineKP.PublicKey)
	if _, err := FetchPQCStatus(ks.URL, "qor1x"); err != nil {
		t.Fatal(err)
	}
	again, err := FetchPQCStatus(ks.URL, "qor1x")
	if err != nil {
		t.Fatal(err)
	}
	if ks.reads != 1 {
		t.Fatalf("a positive answer must be cached, got %d reads", ks.reads)
	}
	if !bytes.Equal(PQCStatusPublicKey(again), mineKP.PublicKey) {
		t.Fatal("cached answer lost the key")
	}
	if m, known := IsRegisteredPQCKey(again, mineKP.PublicKey); !m || !known {
		t.Errorf("own key: match %v known %v", m, known)
	}
	if m, known := IsRegisteredPQCKey(again, otherKP.PublicKey); m || !known {
		t.Errorf("other key: match %v known %v", m, known)
	}
	if _, known := IsRegisteredPQCKey(Status{Registered: true}, mineKP.PublicKey); known {
		t.Error("a status without a key must be unknown")
	}
	if PQCStatusPublicKey(Status{Registered: true}) != nil {
		t.Error("a status without a key has no public key")
	}
}

func TestFetchPQCStatusReadsAURLSafeBase64Key(t *testing.T) {
	ClearPQCStatusCache()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"found":true,"account":{"algorithm_id":1,"public_key":"` +
			base64.URLEncoding.EncodeToString(mineKP.PublicKey) + `"}}`))
	}))
	defer srv.Close()
	s, err := FetchPQCStatus(srv.URL, "qor1x")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(s.Pubkey, mineKP.PublicKey) || s.AlgorithmID != 1 {
		t.Fatalf("%+v", s)
	}
}
