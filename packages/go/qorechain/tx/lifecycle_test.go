package tx

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
	ammv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/amm/v1"
)

// ---- errors ----

func TestDecodeTxError(t *testing.T) {
	if err := DecodeTxError(0, "", ""); err != nil {
		t.Fatalf("zero code must decode to nil, got %v", err)
	}
	root := DecodeTxError(5, "", "insufficient funds raw")
	if root == nil || root.Reason != "insufficient funds" {
		t.Fatalf("root code 5 mismatch: %+v", root)
	}
	bank := DecodeTxError(5, "bank", "")
	if bank.Reason != "send transactions are disabled" {
		t.Fatalf("bank code 5 mismatch: %+v", bank)
	}
	unknownMod := DecodeTxError(99, "amm", "")
	if unknownMod.Reason != "unknown amm error" {
		t.Fatalf("amm fallback mismatch: %+v", unknownMod)
	}
	unknownCs := DecodeTxError(1, "mystery", "")
	if unknownCs.Reason != "unknown mystery error" {
		t.Fatalf("unknown codespace fallback mismatch: %+v", unknownCs)
	}
	if !errors.Is(error(root), error(root)) {
		t.Fatal("QoreTxError should satisfy error")
	}
}

// ---- gas ----

func TestParseGasPriceAndCalculateFee(t *testing.T) {
	price, err := ParseGasPrice("0.025uqor")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if price.Denom != "uqor" {
		t.Fatalf("denom mismatch: %s", price.Denom)
	}
	// gasLimit 100000 × 1.4 = 140000 feeGas; 140000 × 0.025 = 3500 uqor.
	fee, err := CalculateFee(100000, DefaultGasMultiplier, price)
	if err != nil {
		t.Fatalf("calc: %v", err)
	}
	if fee.Gas != "140000" {
		t.Fatalf("gas mismatch: %s", fee.Gas)
	}
	if len(fee.Amount) != 1 || fee.Amount[0].Amount != "3500" || fee.Amount[0].Denom != "uqor" {
		t.Fatalf("fee amount mismatch: %+v", fee.Amount)
	}
}

func TestEstimateFeeFromSimulate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cosmos/tx/v1beta1/simulate" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"gas_info":{"gas_used":"80000"}}`))
	}))
	defer srv.Close()

	fee, err := EstimateFee(srv.URL, []byte{0x01}, DefaultGasMultiplier, "", nil)
	if err != nil {
		t.Fatalf("estimate: %v", err)
	}
	// 80000 × 1.4 = 112000 feeGas; × 0.15 = 16800 uqor.
	if fee.Gas != "112000" || fee.Amount[0].Amount != "16800" {
		t.Fatalf("estimated fee mismatch: %+v", fee)
	}
}

// ---- tracking ----

func TestWaitForTxPollsThenSucceeds(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls < 2 {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"code":5,"message":"tx not found"}`))
			return
		}
		_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC","height":"42","code":0,"gas_used":"1000","gas_wanted":"2000"}}`))
	}))
	defer srv.Close()

	res, err := WaitForTx(srv.URL, "ABC", WaitOptions{Timeout: 5 * time.Second, Poll: 10 * time.Millisecond}, nil)
	if err != nil {
		t.Fatalf("wait: %v", err)
	}
	if res.Height != 42 || res.TxHash != "ABC" {
		t.Fatalf("result mismatch: %+v", res)
	}
	if calls < 2 {
		t.Fatalf("expected polling, got %d calls", calls)
	}
}

func TestWaitForTxTimesOut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"tx not found"}`))
	}))
	defer srv.Close()

	_, err := WaitForTx(srv.URL, "MISSING", WaitOptions{Timeout: 30 * time.Millisecond, Poll: 10 * time.Millisecond}, nil)
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestWaitForTxDeliveryError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"tx_response":{"txhash":"FAIL","height":"7","code":11,"codespace":"sdk","raw_log":"out of gas"}}`))
	}))
	defer srv.Close()

	_, err := WaitForTx(srv.URL, "FAIL", WaitOptions{Timeout: time.Second, Poll: 10 * time.Millisecond}, nil)
	var txErr *QoreTxError
	if !errors.As(err, &txErr) {
		t.Fatalf("expected *QoreTxError, got %v", err)
	}
	if txErr.Code != 11 || txErr.Reason != "out of gas" || txErr.TxHash != "FAIL" {
		t.Fatalf("decoded tx error mismatch: %+v", txErr)
	}
}

func TestWithRetry(t *testing.T) {
	var n int
	err := WithRetry(3, time.Millisecond, func() error {
		n++
		if n < 3 {
			return errors.New("transient")
		}
		return nil
	})
	if err != nil || n != 3 {
		t.Fatalf("retry mismatch: err=%v n=%d", err, n)
	}
}

// ---- search ----

func TestBuildEventQuery(t *testing.T) {
	got := BuildEventQuery([]string{"message.sender=qor1abc", "transfer.amount=10uqor"})
	want := "message.sender='qor1abc' AND transfer.amount='10uqor'"
	if got != want {
		t.Fatalf("query mismatch:\n got %s\nwant %s", got, want)
	}
}

func TestSearchTxs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cosmos/tx/v1beta1/txs" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if q := r.URL.Query().Get("query"); q != "message.sender='qor1abc'" {
			t.Errorf("query param mismatch: %s", q)
		}
		_, _ = w.Write([]byte(`{"tx_responses":[{"txhash":"H1","height":"3","code":0},{"txhash":"H2","height":"4","code":0}],"total":"2"}`))
	}))
	defer srv.Close()

	res, err := SearchTxs(srv.URL, []string{"message.sender=qor1abc"}, 1, 10, nil)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(res.Txs) != 2 || res.Total != 2 {
		t.Fatalf("search result mismatch: %+v", res)
	}
	if res.Txs[0].TxHash != "H1" || res.Txs[1].TxHash != "H2" {
		t.Fatalf("tx hashes mismatch: %+v", res.Txs)
	}
}

// ---- generic SendMessages + hybrid B0 contract with a custom message ----

func testAccount(t *testing.T) accounts.Secp256k1Account {
	t.Helper()
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	acc, err := accounts.DeriveNativeAccount(mnemonic, 0)
	if err != nil {
		t.Fatalf("derive account: %v", err)
	}
	return acc
}

func customSwapMsg(sender string) sdk.Msg {
	return &ammv1.MsgSwapExactIn{
		Sender:   sender,
		PoolID:   1,
		TokenIn:  sdk.NewCoin("uqor", math.NewInt(100)),
		DenomOut: "uusdc",
		MinOut:   math.NewInt(95),
	}
}

func TestSendMessagesBuildsSignedTx(t *testing.T) {
	acc := testAccount(t)
	built, err := SendMessages(SendMessagesParams{
		Account:       acc,
		Messages:      []sdk.Msg{customSwapMsg(acc.Address)},
		Fee:           Fee{Amount: []Coin{{Denom: "uqor", Amount: "3500"}}, Gas: "140000"},
		ChainID:       "qorechain-diana",
		AccountNumber: 1,
		Sequence:      0,
	})
	if err != nil {
		t.Fatalf("send messages: %v", err)
	}
	if len(built.TxRaw.Signatures) != 1 || len(built.TxRaw.Signatures[0]) == 0 {
		t.Fatal("missing classical signature")
	}
	if len(built.TxRaw.BodyBytes) == 0 || len(built.TxRawBytes) == 0 {
		t.Fatal("empty tx bytes")
	}
}

// TestHybridB0ExcludesExtensionWithCustomMessage verifies the hybrid sign-bytes
// framing for a CUSTOM message: PQC signs BE32(len B0)||B0||BE32(len A)||A where
// B0 is the body WITHOUT the PQC extension, and the resulting signature verifies
// against the recomputed framing.
func TestHybridB0ExcludesExtensionWithCustomMessage(t *testing.T) {
	acc := testAccount(t)
	kp, err := pqc.GeneratePQCKeypair()
	if err != nil {
		t.Fatalf("pqc keygen: %v", err)
	}
	built, err := BuildHybridMessages(BuildHybridMessagesParams{
		Account:       acc,
		PQCKeypair:    kp,
		Messages:      []sdk.Msg{customSwapMsg(acc.Address)},
		Fee:           Fee{Amount: []Coin{{Denom: "uqor", Amount: "3500"}}, Gas: "140000"},
		ChainID:       "qorechain-diana",
		AccountNumber: 1,
		Sequence:      0,
	})
	if err != nil {
		t.Fatalf("build hybrid: %v", err)
	}
	if len(built.PQCSignedMessage) == 0 || len(built.PQCSignature) != pqc.MLDSA87SignatureLength {
		t.Fatalf("hybrid artifacts missing: sig len %d", len(built.PQCSignature))
	}
	// The PQC signature must verify against the exact framed message.
	if !pqc.PQCVerify(kp.PublicKey, built.PQCSignedMessage, built.PQCSignature) {
		t.Fatal("PQC signature does not verify against PQCSignedMessage")
	}
	// The framed message must be BE32(len B0)||B0||BE32(len A)||A, and the B0 it
	// carries must NOT contain the hybrid-extension type URL (the final body
	// does).
	msg := built.PQCSignedMessage
	if len(msg) < 8 {
		t.Fatal("framed message too short")
	}
	b0Len := binary.BigEndian.Uint32(msg[:4])
	b0 := msg[4 : 4+b0Len]
	aLen := binary.BigEndian.Uint32(msg[4+b0Len : 8+b0Len])
	a := msg[8+b0Len:]
	if uint32(len(a)) != aLen {
		t.Fatalf("authInfo length prefix mismatch: prefix %d, actual %d", aLen, len(a))
	}
	// A must equal the broadcast AuthInfo bytes.
	if string(a) != string(built.AuthInfoBytes) {
		t.Fatal("framed A does not equal broadcast AuthInfoBytes")
	}
	if containsBytes(b0, []byte(pqc.HybridSigTypeURL)) {
		t.Fatal("B0 must NOT contain the PQC extension type URL")
	}
	if !containsBytes(built.TxRaw.BodyBytes, []byte(pqc.HybridSigTypeURL)) {
		t.Fatal("final body MUST contain the PQC extension type URL")
	}
}

func containsBytes(haystack, needle []byte) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if string(haystack[i:i+len(needle)]) == string(needle) {
			return true
		}
	}
	return false
}

var _ = json.Marshal
