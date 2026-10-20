package pqcdx

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	"github.com/cosmos/gogoproto/proto"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

// fakeQor records the address passed and returns a canned response.
type fakeQor struct {
	called string
	resp   json.RawMessage
	err    error
}

func (f *fakeQor) GetPQCKeyStatus(address string) (json.RawMessage, error) {
	f.called = address
	if f.err != nil {
		return nil, f.err
	}
	return f.resp, nil
}

// seededKeypair is the ML-DSA-87 keypair from a 32-byte seed filled with b.
func seededKeypair(b byte) pqc.Keypair {
	var seed [mldsa87.SeedSize]byte
	for i := range seed {
		seed[i] = b
	}
	pub, priv := mldsa87.NewKeyFromSeed(&seed)
	pubBytes, _ := pub.MarshalBinary()
	privBytes, _ := priv.MarshalBinary()
	return pqc.Keypair{PublicKey: pubBytes, SecretKey: privBytes}
}

// testKeypair is the test signer's keypair: fixed, so the fake REST status
// route can report it as the registered key.
func testKeypair(t *testing.T) pqc.Keypair {
	t.Helper()
	return seededKeypair(2)
}

func testSigner(t *testing.T) Signer {
	t.Helper()
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	acc, err := accounts.DeriveNativeAccount(mnemonic, 0)
	if err != nil {
		t.Fatalf("derive account: %v", err)
	}
	return Signer{
		Account:       acc,
		PQCKeypair:    testKeypair(t),
		ChainID:       "qorechain-vladi",
		AccountNumber: 1,
		Sequence:      0,
		Fee:           tx.Fee{Amount: []tx.Coin{{Denom: "uqor", Amount: "3500"}}, Gas: "140000"},
	}
}

// decodeRegisterMsg decodes the single MsgRegisterPQCKeyV2 from a BuiltTx.
func decodeRegisterMsg(t *testing.T, built *tx.BuiltTx) *pqcv1.MsgRegisterPQCKeyV2 {
	t.Helper()
	var body sdktx.TxBody
	if err := proto.Unmarshal(built.TxRaw.BodyBytes, &body); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if len(body.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(body.Messages))
	}
	any := body.Messages[0]
	if any.TypeUrl != MsgRegisterPQCKeyV2TypeURL {
		t.Fatalf("type url = %q, want %q", any.TypeUrl, MsgRegisterPQCKeyV2TypeURL)
	}
	var m pqcv1.MsgRegisterPQCKeyV2
	if err := proto.Unmarshal(any.Value, &m); err != nil {
		t.Fatalf("unmarshal MsgRegisterPQCKeyV2: %v", err)
	}
	return &m
}

func decodeMigrateMsg(t *testing.T, built *tx.BuiltTx) *pqcv1.MsgMigratePQCKey {
	t.Helper()
	var body sdktx.TxBody
	if err := proto.Unmarshal(built.TxRaw.BodyBytes, &body); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if len(body.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(body.Messages))
	}
	any := body.Messages[0]
	if any.TypeUrl != MsgMigratePQCKeyTypeURL {
		t.Fatalf("type url = %q, want %q", any.TypeUrl, MsgMigratePQCKeyTypeURL)
	}
	var m pqcv1.MsgMigratePQCKey
	if err := proto.Unmarshal(any.Value, &m); err != nil {
		t.Fatalf("unmarshal MsgMigratePQCKey: %v", err)
	}
	return &m
}

// fakePQCFound is what the fake REST status route answers for the signer
// (GET /qorechain/pqc/v1/account/{addr} → {"found": ...}). When found, the
// registered key is the test signer's.
var fakePQCFound = true

func writePQCStatus(w http.ResponseWriter) {
	if fakePQCFound {
		key := base64.StdEncoding.EncodeToString(seededKeypair(2).PublicKey)
		_, _ = w.Write([]byte(`{"found":true,"account":{"public_key":"` + key + `"}}`))
		return
	}
	_, _ = w.Write([]byte(`{"found":false,"account":null}`))
}

// broadcastServer returns an httptest server that handles broadcast + tx poll,
// recording the broadcast body.
func broadcastServer(t *testing.T, body *string) *httptest.Server {
	t.Helper()
	ClearPQCStatusCache()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/qorechain/pqc/v1/account/") {
			writePQCStatus(w)
			return
		}
		switch r.URL.Path {
		case "/cosmos/tx/v1beta1/txs":
			b, _ := io.ReadAll(r.Body)
			if body != nil {
				*body = string(b)
			}
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0}}`))
		default:
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0,"height":"10","gas_used":"1000","gas_wanted":"2000"}}`))
		}
	}))
}

// ---- IsPQCRegistered / GetPQCStatus ----

func TestGetPQCStatusRegistered(t *testing.T) {
	q := &fakeQor{resp: json.RawMessage(`{"registered":true,"algorithm_id":1,"public_key":"AQID"}`)}
	s, err := GetPQCStatus(q, "qor1abc")
	if err != nil {
		t.Fatalf("GetPQCStatus: %v", err)
	}
	if q.called != "qor1abc" {
		t.Errorf("called with %q", q.called)
	}
	if !s.Registered {
		t.Error("expected Registered=true")
	}
	if s.AlgorithmID != 1 {
		t.Errorf("AlgorithmID = %d, want 1", s.AlgorithmID)
	}
	if string(s.Pubkey) != string([]byte{1, 2, 3}) {
		t.Errorf("Pubkey = %x, want 010203", s.Pubkey)
	}
}

func TestGetPQCStatusUnregistered(t *testing.T) {
	q := &fakeQor{resp: json.RawMessage(`{"registered":false}`)}
	s, err := GetPQCStatus(q, "qor1abc")
	if err != nil {
		t.Fatalf("GetPQCStatus: %v", err)
	}
	if s.Registered {
		t.Error("expected Registered=false")
	}
	if s.AlgorithmID != 0 || s.Pubkey != nil {
		t.Errorf("expected zero status, got %+v", s)
	}
}

func TestGetPQCStatusAltFieldNames(t *testing.T) {
	// is_registered + pubkey + algorithm aliases.
	q := &fakeQor{resp: json.RawMessage(`{"is_registered":true,"algorithm":2,"pubkey":"BAUG"}`)}
	s, err := GetPQCStatus(q, "qor1abc")
	if err != nil {
		t.Fatalf("GetPQCStatus: %v", err)
	}
	if !s.Registered || s.AlgorithmID != 2 || string(s.Pubkey) != string([]byte{4, 5, 6}) {
		t.Errorf("alt-field decode wrong: %+v", s)
	}
}

func TestGetPQCStatusInferredFromKey(t *testing.T) {
	// No boolean flag but a non-empty key → registered.
	q := &fakeQor{resp: json.RawMessage(`{"public_key":"AQID"}`)}
	s, err := GetPQCStatus(q, "qor1abc")
	if err != nil {
		t.Fatalf("GetPQCStatus: %v", err)
	}
	if !s.Registered {
		t.Error("expected Registered inferred from non-empty key")
	}
}

func TestGetPQCStatusNilClient(t *testing.T) {
	if _, err := GetPQCStatus(nil, "x"); err == nil {
		t.Error("expected error for nil client")
	}
}

func TestIsPQCRegistered(t *testing.T) {
	q := &fakeQor{resp: json.RawMessage(`{"registered":true}`)}
	ok, err := IsPQCRegistered(q, "qor1abc")
	if err != nil {
		t.Fatalf("IsPQCRegistered: %v", err)
	}
	if !ok {
		t.Error("expected true")
	}

	q2 := &fakeQor{resp: json.RawMessage(`{"registered":false}`)}
	ok2, err := IsPQCRegistered(q2, "qor1abc")
	if err != nil {
		t.Fatalf("IsPQCRegistered: %v", err)
	}
	if ok2 {
		t.Error("expected false")
	}
}

// ---- EnsurePQCRegistered ----

func TestEnsureAlreadyRegisteredNoTx(t *testing.T) {
	q := &fakeQor{resp: json.RawMessage(`{"registered":true,"algorithm_id":1}`)}
	signer := testSigner(t)
	// No RestURL set: if it tried to broadcast, the test would fail on the empty URL.
	c := New(signer, Options{Qor: q})
	res, err := c.EnsurePQCRegistered(RegisterOptions{})
	if err != nil {
		t.Fatalf("EnsurePQCRegistered: %v", err)
	}
	if !res.AlreadyRegistered {
		t.Error("expected AlreadyRegistered=true")
	}
	if res.TxHash != "" {
		t.Errorf("expected no tx hash, got %q", res.TxHash)
	}
}

func TestEnsureMissingBroadcasts(t *testing.T) {
	fakePQCFound = false
	defer func() { fakePQCFound = true }()
	var bcastBody string
	srv := broadcastServer(t, &bcastBody)
	defer srv.Close()

	q := &fakeQor{resp: json.RawMessage(`{"registered":false}`)}
	signer := testSigner(t)
	signer.RestURL = srv.URL
	c := New(signer, Options{Qor: q})

	res, err := c.EnsurePQCRegistered(RegisterOptions{})
	if err != nil {
		t.Fatalf("EnsurePQCRegistered: %v", err)
	}
	if res.AlreadyRegistered {
		t.Error("expected AlreadyRegistered=false")
	}
	if res.TxHash != "ABC123" {
		t.Errorf("TxHash = %q, want ABC123", res.TxHash)
	}
	if bcastBody == "" {
		t.Fatal("broadcast was not called")
	}

	// Verify the broadcast tx carried the correct MsgRegisterPQCKey fields by
	// rebuilding the same message and comparing wire bytes.
	built, err := c.BuildRegister(RegisterOptions{})
	if err != nil {
		t.Fatalf("BuildRegister: %v", err)
	}
	m := decodeRegisterMsg(t, built)
	if m.Sender != signer.Account.Address {
		t.Errorf("sender = %q, want %q", m.Sender, signer.Account.Address)
	}
	if string(m.PublicKey) != string(signer.PQCKeypair.PublicKey) {
		t.Error("public_key does not match signer PQC public key")
	}
	if m.AlgorithmID != pqcv1.AlgorithmID(pqc.AlgorithmDilithium5) {
		t.Errorf("algorithm_id = %d, want %d (ML-DSA-87)", m.AlgorithmID, pqc.AlgorithmDilithium5)
	}
	if string(m.ECDSAPubkey) != string(signer.Account.PublicKey) {
		t.Error("ecdsa_pubkey does not match signer secp256k1 public key")
	}
	if m.KeyType != DefaultKeyType {
		t.Errorf("key_type = %q, want %q", m.KeyType, DefaultKeyType)
	}
	if len(built.TxRaw.Signatures) != 1 || len(built.TxRaw.Signatures[0]) == 0 {
		t.Error("missing classical signature")
	}
}

func TestEnsureForceSkipsStatusCheck(t *testing.T) {
	srv := broadcastServer(t, nil)
	defer srv.Close()

	q := &fakeQor{resp: json.RawMessage(`{"registered":true}`)} // would say already registered
	signer := testSigner(t)
	signer.RestURL = srv.URL
	c := New(signer, Options{Qor: q})

	res, err := c.EnsurePQCRegistered(RegisterOptions{Force: true})
	if err != nil {
		t.Fatalf("EnsurePQCRegistered force: %v", err)
	}
	if res.AlreadyRegistered {
		t.Error("Force should broadcast regardless of status")
	}
	if res.TxHash != "ABC123" {
		t.Errorf("TxHash = %q", res.TxHash)
	}
	if q.called != "" {
		t.Error("Force should skip the qor_getPQCKeyStatus check")
	}
}

func TestEnsureCustomKeyType(t *testing.T) {
	signer := testSigner(t)
	c := New(signer, Options{})
	built, err := c.BuildRegister(RegisterOptions{KeyType: "ml-dsa-87"})
	if err != nil {
		t.Fatalf("BuildRegister: %v", err)
	}
	if m := decodeRegisterMsg(t, built); m.KeyType != "ml-dsa-87" {
		t.Errorf("key_type = %q, want ml-dsa-87", m.KeyType)
	}
}

func TestEnsureMissingPQCKeyErrors(t *testing.T) {
	signer := testSigner(t)
	signer.PQCKeypair = pqc.Keypair{} // no keys
	c := New(signer, Options{})
	if _, err := c.BuildRegister(RegisterOptions{}); err == nil {
		t.Error("expected error when PQC public key missing")
	}
}

// ---- MigratePQCKey ----

func TestMigratePQCKeyFields(t *testing.T) {
	signer := testSigner(t)
	c := New(signer, Options{})
	opts := MigrateOptions{
		OldPublicKey:   []byte{0x01, 0x02},
		NewPublicKey:   []byte{0x03, 0x04},
		NewAlgorithmID: pqc.AlgorithmDilithium5,
		OldSignature:   []byte{0xaa},
		NewSignature:   []byte{0xbb},
	}
	built, err := c.BuildMigratePQCKey(opts)
	if err != nil {
		t.Fatalf("BuildMigratePQCKey: %v", err)
	}
	m := decodeMigrateMsg(t, built)
	if m.Sender != signer.Account.Address {
		t.Errorf("sender = %q", m.Sender)
	}
	if string(m.OldPublicKey) != string(opts.OldPublicKey) || string(m.NewPublicKey) != string(opts.NewPublicKey) {
		t.Error("migrate public keys not set correctly")
	}
	if uint8(m.NewAlgorithmID) != pqc.AlgorithmDilithium5 {
		t.Errorf("new_algorithm_id = %d", m.NewAlgorithmID)
	}
	if string(m.OldSignature) != string(opts.OldSignature) || string(m.NewSignature) != string(opts.NewSignature) {
		t.Error("migrate signatures not set correctly")
	}
}

func TestMigratePQCKeyValidation(t *testing.T) {
	c := New(testSigner(t), Options{})
	// Missing new key.
	if _, err := c.BuildMigratePQCKey(MigrateOptions{OldSignature: []byte{1}, NewSignature: []byte{2}}); err == nil {
		t.Error("expected error when NewPublicKey missing")
	}
	// Missing signatures.
	if _, err := c.BuildMigratePQCKey(MigrateOptions{NewPublicKey: []byte{1}}); err == nil {
		t.Error("expected error when signatures missing")
	}
}

func TestMigratePQCKeyBroadcasts(t *testing.T) {
	srv := broadcastServer(t, nil)
	defer srv.Close()
	signer := testSigner(t)
	signer.RestURL = srv.URL
	c := New(signer, Options{})
	res, err := c.MigratePQCKey(MigrateOptions{
		NewPublicKey: []byte{0x03},
		OldSignature: []byte{0xaa},
		NewSignature: []byte{0xbb},
	})
	if err != nil {
		t.Fatalf("MigratePQCKey: %v", err)
	}
	if res.TxHash != "ABC123" {
		t.Errorf("hash = %q", res.TxHash)
	}
}

// ---- MigrateToHybrid ----

// testBankSend builds a self-send bank message for use as a hybrid payload.
func testBankSend(addr string) []sdk.Msg {
	return []sdk.Msg{messages.Bank.Send(addr, addr, sdk.NewCoins(sdk.NewInt64Coin("uqor", 10)))}
}

func TestMigrateToHybridAlreadyRegistered(t *testing.T) {
	srv := broadcastServer(t, nil)
	defer srv.Close()
	q := &fakeQor{resp: json.RawMessage(`{"registered":true,"algorithm_id":1}`)}
	signer := testSigner(t)
	signer.RestURL = srv.URL
	c := New(signer, Options{Qor: q})

	res, err := c.MigrateToHybrid(testBankSend(signer.Account.Address), MigrateToHybridOptions{})
	if err != nil {
		t.Fatalf("MigrateToHybrid: %v", err)
	}
	if !res.AlreadyRegistered {
		t.Error("expected AlreadyRegistered=true")
	}
	if res.RegisterTxHash != "" {
		t.Error("expected no register tx")
	}
	if res.Result == nil || res.Result.TxHash != "ABC123" {
		t.Errorf("hybrid result = %+v", res.Result)
	}
}

func TestMigrateToHybridRegistersFirst(t *testing.T) {
	fakePQCFound = false
	defer func() { fakePQCFound = true }()
	srv := broadcastServer(t, nil)
	defer srv.Close()
	q := &fakeQor{resp: json.RawMessage(`{"registered":false}`)}
	signer := testSigner(t)
	signer.RestURL = srv.URL
	c := New(signer, Options{Qor: q})

	res, err := c.MigrateToHybrid(testBankSend(signer.Account.Address), MigrateToHybridOptions{})
	if err != nil {
		t.Fatalf("MigrateToHybrid: %v", err)
	}
	if res.AlreadyRegistered {
		t.Error("expected AlreadyRegistered=false")
	}
	if res.RegisterTxHash != "ABC123" {
		t.Errorf("RegisterTxHash = %q", res.RegisterTxHash)
	}
	if res.Result == nil || res.Result.TxHash != "ABC123" {
		t.Errorf("hybrid result = %+v", res.Result)
	}
}

func TestMigrateToHybridEmptyMessages(t *testing.T) {
	c := New(testSigner(t), Options{Qor: &fakeQor{resp: json.RawMessage(`{"registered":true}`)}})
	if _, err := c.MigrateToHybrid(nil, MigrateToHybridOptions{}); err == nil {
		t.Error("expected error for empty messages")
	}
}

func TestMigrateToHybridRequiresSecretKey(t *testing.T) {
	signer := testSigner(t)
	signer.PQCKeypair.SecretKey = nil
	q := &fakeQor{resp: json.RawMessage(`{"registered":true}`)}
	c := New(signer, Options{Qor: q})
	if _, err := c.MigrateToHybrid(testBankSend(signer.Account.Address), MigrateToHybridOptions{}); err == nil {
		t.Error("expected error when PQC secret key missing")
	}
}

func TestTypeURLConstants(t *testing.T) {
	if MsgRegisterPQCKeyTypeURL != "/qorechain.pqc.v1.MsgRegisterPQCKey" {
		t.Errorf("register type url = %q", MsgRegisterPQCKeyTypeURL)
	}
	if MsgRegisterPQCKeyV2TypeURL != "/qorechain.pqc.v1.MsgRegisterPQCKeyV2" {
		t.Errorf("register v2 type url = %q", MsgRegisterPQCKeyV2TypeURL)
	}
	if MsgMigratePQCKeyTypeURL != "/qorechain.pqc.v1.MsgMigratePQCKey" {
		t.Errorf("migrate type url = %q", MsgMigratePQCKeyTypeURL)
	}
}

func TestClientAddress(t *testing.T) {
	signer := testSigner(t)
	c := New(signer, Options{})
	if c.Address() != signer.Account.Address {
		t.Errorf("Address() = %q, want %q", c.Address(), signer.Account.Address)
	}
}

// ---- REST status (the route every public endpoint serves) ----

func TestFetchPQCStatusUnclearAnswerIsAnError(t *testing.T) {
	ClearPQCStatusCache()
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(http.StatusNotImplemented)
			return
		}
		_, _ = w.Write([]byte(`{"registered":false}`))
	}))
	defer srv.Close()
	if _, err := FetchPQCStatus(srv.URL, "qor1x"); err == nil || !strings.Contains(err.Error(), "cannot tell") {
		t.Fatalf("expected an unknown status, got %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected one retry, got %d calls", calls)
	}
}

func TestFetchPQCStatusCachesPositive(t *testing.T) {
	ClearPQCStatusCache()
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/qorechain/pqc/v1/account/qor1x" {
			t.Errorf("path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"found":true,"account":{"public_key":"AQID"}}`))
	}))
	defer srv.Close()
	for i := 0; i < 2; i++ {
		s, err := FetchPQCStatus(srv.URL+"/", "qor1x")
		if err != nil || !s.Registered {
			t.Fatalf("%+v %v", s, err)
		}
	}
	if calls != 1 {
		t.Fatalf("a positive answer must be cached, got %d calls", calls)
	}
}

func TestEnsureNeverRegistersOnUnknownStatus(t *testing.T) {
	ClearPQCStatusCache()
	broadcasts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cosmos/tx/v1beta1/txs" {
			broadcasts++
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	signer := testSigner(t)
	signer.RestURL = srv.URL
	if _, err := New(signer, Options{}).EnsurePQCRegistered(RegisterOptions{}); err == nil {
		t.Fatal("expected an error on an unknown status")
	}
	if broadcasts != 0 {
		t.Fatalf("registered blind: %d broadcasts", broadcasts)
	}
}

func TestEnsureTreatsAlreadyRegisteredAsSuccess(t *testing.T) {
	ClearPQCStatusCache()
	fakePQCFound = false
	defer func() { fakePQCFound = true }()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/qorechain/pqc/v1/account/") {
			writePQCStatus(w)
			return
		}
		_, _ = w.Write([]byte(`{"tx_response":{"txhash":"AB","code":7,"codespace":"pqc","raw_log":"PQC account already registered"}}`))
	}))
	defer srv.Close()
	signer := testSigner(t)
	signer.RestURL = srv.URL
	res, err := New(signer, Options{}).EnsurePQCRegistered(RegisterOptions{})
	if err != nil || !res.AlreadyRegistered {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestGetPQCStatusRefusesAnEmptyAnswer(t *testing.T) {
	if _, err := GetPQCStatus(&fakeQor{resp: json.RawMessage(`null`)}, "qor1x"); err == nil {
		t.Fatal("an empty answer must not read as 'not registered'")
	}
}

// ---- proof of possession at registration (chain v3.2.3) ----

func registeredPoP(t *testing.T, v323Height string) []byte {
	t.Helper()
	ClearPQCStatusCache()
	query.ClearUpgradeCache()
	var bcast string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/qorechain/pqc/v1/account/"):
			_, _ = w.Write([]byte(`{"found":false,"account":null}`))
		case r.URL.Path == "/cosmos/upgrade/v1beta1/applied_plan/v3.2.3":
			_, _ = w.Write([]byte(`{"height":"` + v323Height + `"}`))
		case r.URL.Path == "/cosmos/tx/v1beta1/txs":
			b, _ := io.ReadAll(r.Body)
			bcast = string(b)
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0}}`))
		default:
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0,"height":"10"}}`))
		}
	}))
	defer srv.Close()
	signer := testSigner(t)
	signer.RestURL = srv.URL
	if _, err := New(signer, Options{}).EnsurePQCRegistered(RegisterOptions{}); err != nil {
		t.Fatalf("EnsurePQCRegistered: %v", err)
	}
	var req struct {
		TxBytes []byte `json:"tx_bytes"`
	}
	if err := json.Unmarshal([]byte(bcast), &req); err != nil {
		t.Fatalf("broadcast body: %v", err)
	}
	var raw sdktx.TxRaw
	if err := proto.Unmarshal(req.TxBytes, &raw); err != nil {
		t.Fatalf("tx raw: %v", err)
	}
	return decodeRegisterMsg(t, &tx.BuiltTx{TxRaw: &raw}).ProofOfPossession
}

func TestEnsureAttachesProofOfPossessionOnceV323IsApplied(t *testing.T) {
	if pop := registeredPoP(t, "8003746"); len(pop) != 4627 {
		t.Fatalf("expected a 4627-byte proof, got %d bytes", len(pop))
	}
}

func TestEnsureLeavesProofOfPossessionOffBeforeV323(t *testing.T) {
	if pop := registeredPoP(t, "0"); len(pop) != 0 {
		t.Fatalf("expected no proof before v3.2.3, got %d bytes", len(pop))
	}
}

// checkTxServer answers every broadcast with checkTx and every tx poll with an
// included code-0 result, so only the broadcast answer decides the outcome.
func checkTxServer(t *testing.T, checkTx string, broadcasts *int) *httptest.Server {
	t.Helper()
	ClearPQCStatusCache()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/qorechain/pqc/v1/account/") {
			writePQCStatus(w)
			return
		}
		if r.URL.Path == "/cosmos/tx/v1beta1/txs" {
			*broadcasts++
			_, _ = w.Write([]byte(checkTx))
			return
		}
		_, _ = w.Write([]byte(`{"tx_response":{"txhash":"OK0","code":0,"height":"10"}}`))
	}))
}

func TestEnsureReturnsACheckTxRefusalAsATxError(t *testing.T) {
	fakePQCFound = false
	defer func() { fakePQCFound = true }()
	var broadcasts int
	srv := checkTxServer(t, `{"tx_response":{"txhash":"FEE13","code":13,"codespace":"sdk","raw_log":"insufficient fee"}}`, &broadcasts)
	defer srv.Close()
	signer := testSigner(t)
	signer.RestURL = srv.URL
	res, err := New(signer, Options{}).EnsurePQCRegistered(RegisterOptions{})
	var txErr *tx.QoreTxError
	if !errors.As(err, &txErr) {
		t.Fatalf("want *tx.QoreTxError, got %+v %v", res, err)
	}
	if txErr.Code != 13 || txErr.Codespace != "sdk" || txErr.RawLog != "insufficient fee" || txErr.TxHash != "FEE13" {
		t.Fatalf("decoded %+v", txErr)
	}
	if res.TxHash != "" || res.AlreadyRegistered {
		t.Fatalf("a refused registration must not read as done: %+v", res)
	}
}

func TestEnsureCheckTxCodeZeroReturnsTheHash(t *testing.T) {
	fakePQCFound = false
	defer func() { fakePQCFound = true }()
	var broadcasts int
	srv := checkTxServer(t, `{"tx_response":{"txhash":"OK0","code":0}}`, &broadcasts)
	defer srv.Close()
	signer := testSigner(t)
	signer.RestURL = srv.URL
	res, err := New(signer, Options{}).EnsurePQCRegistered(RegisterOptions{})
	if err != nil || res.AlreadyRegistered || res.TxHash != "OK0" {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestMigrateToHybridStopsWhenTheRegistrationIsRefused(t *testing.T) {
	fakePQCFound = false
	defer func() { fakePQCFound = true }()
	var broadcasts int
	srv := checkTxServer(t, `{"tx_response":{"txhash":"FEE13","code":13,"codespace":"sdk","raw_log":"insufficient fee"}}`, &broadcasts)
	defer srv.Close()
	signer := testSigner(t)
	signer.RestURL = srv.URL
	signer.SignBytesVersion = signbytes.V2
	c := New(signer, Options{})
	_, err := c.MigrateToHybrid(testBankSend(signer.Account.Address), MigrateToHybridOptions{})
	var txErr *tx.QoreTxError
	if !errors.As(err, &txErr) || txErr.Code != 13 {
		t.Fatalf("want the registration's tx error, got %v", err)
	}
	if broadcasts != 1 {
		t.Fatalf("the hybrid tx must not be sent after a refused registration: %d broadcasts", broadcasts)
	}
}
