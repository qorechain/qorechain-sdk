package tx

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"cosmossdk.io/math"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdktypes "github.com/cosmos/cosmos-sdk/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	"github.com/cosmos/gogoproto/proto"

	sdktx "github.com/cosmos/cosmos-sdk/types/tx"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
)

// Public test mnemonic only (never a real secret).
const testMnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

const testChainID = "qorechain-diana"

func mustAccount(t *testing.T) accounts.Secp256k1Account {
	t.Helper()
	acc, err := accounts.DeriveNativeAccount(testMnemonic, 0)
	if err != nil {
		t.Fatalf("derive account: %v", err)
	}
	return acc
}

func sampleFee() Fee {
	return Fee{
		Amount: []Coin{{Denom: "uqor", Amount: "5000"}},
		Gas:    "200000",
	}
}

func TestFeeFromEstimateUsesSuggestedFee(t *testing.T) {
	raw := json.RawMessage(`{"suggested_fee_uqor":"1234","estimated_blocks":2}`)
	fee, err := FeeFromEstimate(raw, "200000")
	if err != nil {
		t.Fatalf("FeeFromEstimate: %v", err)
	}
	if fee.Gas != "200000" {
		t.Errorf("gas = %q, want 200000", fee.Gas)
	}
	if len(fee.Amount) != 1 || fee.Amount[0].Denom != "uqor" || fee.Amount[0].Amount != "1234" {
		t.Errorf("amount = %+v, want [{uqor 1234}]", fee.Amount)
	}
}

func TestFeeFromEstimateNumberFallback(t *testing.T) {
	raw := json.RawMessage(`{"suggested_fee_uqor":4200}`)
	fee, err := FeeFromEstimate(raw, "100000")
	if err != nil {
		t.Fatalf("FeeFromEstimate: %v", err)
	}
	if fee.Amount[0].Amount != "4200" {
		t.Errorf("amount = %q, want 4200", fee.Amount[0].Amount)
	}
}

func TestBankSendBuildsSignedTxRaw(t *testing.T) {
	acc := mustAccount(t)
	to := "qor1recipient00000000000000000000000000000"
	amount := []Coin{{Denom: "uqor", Amount: "1000"}}

	built, err := BankSend(BankSendParams{
		Account:       acc,
		ToAddress:     to,
		Amount:        amount,
		ChainID:       testChainID,
		AccountNumber: 7,
		Sequence:      3,
		Fee:           sampleFee(),
		Memo:          "hello",
	})
	if err != nil {
		t.Fatalf("BankSend: %v", err)
	}
	if len(built.TxRawBytes) == 0 {
		t.Fatal("TxRawBytes empty")
	}

	// Decode the TxRaw and inspect the body.
	var txRaw sdktx.TxRaw
	if err := proto.Unmarshal(built.TxRawBytes, &txRaw); err != nil {
		t.Fatalf("unmarshal TxRaw: %v", err)
	}
	if len(txRaw.Signatures) != 1 {
		t.Fatalf("signatures = %d, want 1", len(txRaw.Signatures))
	}
	if len(txRaw.Signatures[0]) != 64 {
		t.Errorf("classical sig len = %d, want 64", len(txRaw.Signatures[0]))
	}

	var body sdktx.TxBody
	if err := proto.Unmarshal(txRaw.BodyBytes, &body); err != nil {
		t.Fatalf("unmarshal TxBody: %v", err)
	}
	if body.Memo != "hello" {
		t.Errorf("memo = %q, want hello", body.Memo)
	}
	if len(body.Messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(body.Messages))
	}
	var msg banktypes.MsgSend
	if err := proto.Unmarshal(body.Messages[0].Value, &msg); err != nil {
		t.Fatalf("unmarshal MsgSend: %v", err)
	}
	if msg.FromAddress != acc.Address {
		t.Errorf("from = %q, want %q", msg.FromAddress, acc.Address)
	}
	if msg.ToAddress != to {
		t.Errorf("to = %q, want %q", msg.ToAddress, to)
	}
	if len(msg.Amount) != 1 || msg.Amount[0].Denom != "uqor" || msg.Amount[0].Amount.String() != "1000" {
		t.Errorf("amount = %+v, want [{uqor 1000}]", msg.Amount)
	}

	// Classical signature must verify over the SignDoc(bodyBytes, authInfo, ...).
	priv := &secp256k1.PrivKey{Key: acc.PrivateKey}
	signDoc := &sdktx.SignDoc{
		BodyBytes:     txRaw.BodyBytes,
		AuthInfoBytes: txRaw.AuthInfoBytes,
		ChainId:       testChainID,
		AccountNumber: 7,
	}
	signBytes, err := proto.Marshal(signDoc)
	if err != nil {
		t.Fatalf("marshal SignDoc: %v", err)
	}
	if !priv.PubKey().VerifySignature(signBytes, txRaw.Signatures[0]) {
		t.Error("classical signature does not verify over SignDoc")
	}
}

func TestBroadcastPostsToRESTEndpoint(t *testing.T) {
	cases := []struct {
		mode     BroadcastMode
		wantMode string
	}{
		{"sync", "BROADCAST_MODE_SYNC"},
		{"async", "BROADCAST_MODE_ASYNC"},
		{"block", "BROADCAST_MODE_BLOCK"},
	}
	for _, c := range cases {
		t.Run(string(c.mode), func(t *testing.T) {
			var gotPath, gotMode, gotTxBytes string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				body, _ := io.ReadAll(r.Body)
				var payload struct {
					TxBytes string `json:"tx_bytes"`
					Mode    string `json:"mode"`
				}
				_ = json.Unmarshal(body, &payload)
				gotMode = payload.Mode
				gotTxBytes = payload.TxBytes
				_, _ = w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0}}`))
			}))
			defer srv.Close()

			txBytes := []byte{0x01, 0x02, 0x03}
			resp, err := Broadcast(srv.URL, txBytes, c.mode, srv.Client())
			if err != nil {
				t.Fatalf("Broadcast: %v", err)
			}
			if gotPath != "/cosmos/tx/v1beta1/txs" {
				t.Errorf("path = %q, want /cosmos/tx/v1beta1/txs", gotPath)
			}
			if gotMode != c.wantMode {
				t.Errorf("mode = %q, want %q", gotMode, c.wantMode)
			}
			if gotTxBytes != base64.StdEncoding.EncodeToString(txBytes) {
				t.Errorf("tx_bytes = %q, want base64 of input", gotTxBytes)
			}
			var parsed map[string]any
			if err := json.Unmarshal(resp, &parsed); err != nil {
				t.Errorf("response not parseable: %v", err)
			}
		})
	}
}

func TestBroadcastHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusBadGateway)
	}))
	defer srv.Close()
	if _, err := Broadcast(srv.URL, []byte{0x01}, "sync", srv.Client()); err == nil {
		t.Error("expected error on non-2xx response")
	}
}

func TestBuildHybridTxContract(t *testing.T) {
	acc := mustAccount(t)
	kp, err := pqc.GeneratePQCKeypair()
	if err != nil {
		t.Fatalf("generate PQC keypair: %v", err)
	}

	msg := &banktypes.MsgSend{
		FromAddress: acc.Address,
		ToAddress:   "qor1recipient00000000000000000000000000000",
		Amount:      coins("uqor", "2500"),
	}
	built, err := BuildHybridTx(BuildHybridTxParams{
		Account:       acc,
		PQCKeypair:    kp,
		Messages:      []Message{{TypeURL: MsgSendTypeURL, Value: msg}},
		Fee:           sampleFee(),
		ChainID:       testChainID,
		AccountNumber: 11,
		Sequence:      5,
		Memo:          "pqc",
	})
	if err != nil {
		t.Fatalf("BuildHybridTx: %v", err)
	}

	// ML-DSA-87 signature must be 4627 bytes and verify over the framed message.
	if len(built.PQCSignature) != pqc.MLDSA87SignatureLength {
		t.Errorf("pqc sig len = %d, want %d", len(built.PQCSignature), pqc.MLDSA87SignatureLength)
	}
	if !pqc.PQCVerify(kp.PublicKey, built.PQCSignedMessage, built.PQCSignature) {
		t.Error("PQCVerify failed over the signed message")
	}

	// Decode final TxRaw + body.
	var txRaw sdktx.TxRaw
	if err := proto.Unmarshal(built.TxRawBytes, &txRaw); err != nil {
		t.Fatalf("unmarshal TxRaw: %v", err)
	}
	if len(txRaw.Signatures) != 1 || len(txRaw.Signatures[0]) != 64 {
		t.Fatalf("classical signature missing/invalid len")
	}

	var finalBody sdktx.TxBody
	if err := proto.Unmarshal(txRaw.BodyBytes, &finalBody); err != nil {
		t.Fatalf("unmarshal final TxBody: %v", err)
	}

	// The PQC extension must be in ExtensionOptions (CRITICAL slot).
	if len(finalBody.ExtensionOptions) != 1 {
		t.Fatalf("extension_options = %d, want 1", len(finalBody.ExtensionOptions))
	}
	ext := finalBody.ExtensionOptions[0]
	if ext.TypeUrl != pqc.HybridSigTypeURL {
		t.Errorf("ext type URL = %q, want %q", ext.TypeUrl, pqc.HybridSigTypeURL)
	}
	// The Any.value must be the Go-JSON shape.
	var extJSON struct {
		AlgorithmID  int    `json:"algorithm_id"`
		PqcSignature string `json:"pqc_signature"`
		PqcPublicKey string `json:"pqc_public_key"`
	}
	if err := json.Unmarshal(ext.Value, &extJSON); err != nil {
		t.Fatalf("ext value not JSON: %v", err)
	}
	if extJSON.AlgorithmID != pqc.AlgorithmDilithium5 {
		t.Errorf("algorithm_id = %d, want %d", extJSON.AlgorithmID, pqc.AlgorithmDilithium5)
	}
	sigBytes, err := base64.StdEncoding.DecodeString(extJSON.PqcSignature)
	if err != nil {
		t.Fatalf("pqc_signature not std-base64: %v", err)
	}
	if len(sigBytes) != pqc.MLDSA87SignatureLength {
		t.Errorf("decoded pqc sig len = %d, want %d", len(sigBytes), pqc.MLDSA87SignatureLength)
	}
	if extJSON.PqcPublicKey != "" {
		t.Error("pqc_public_key should be omitted when not requested")
	}

	// KEY PROPERTY: strip the PQC ext from the final body, re-marshal (B0'),
	// re-frame, and assert it equals the signed message. Also assert it differs
	// from a framing over the with-ext body.
	strippedBody := finalBody
	strippedBody.ExtensionOptions = nil
	b0prime, err := proto.Marshal(&strippedBody)
	if err != nil {
		t.Fatalf("marshal stripped body: %v", err)
	}
	reframed := frame(b0prime, txRaw.AuthInfoBytes)
	if !bytes.Equal(reframed, built.PQCSignedMessage) {
		t.Error("re-framed B0' does not equal the signed message")
	}

	withExtFraming := frame(txRaw.BodyBytes, txRaw.AuthInfoBytes)
	if bytes.Equal(withExtFraming, built.PQCSignedMessage) {
		t.Error("framing over with-ext body unexpectedly equals signed message")
	}

	// The signed message framing must be BE32(len)||B0||BE32(len)||A.
	if got := binary.BigEndian.Uint32(built.PQCSignedMessage[:4]); int(got) != len(b0prime) {
		t.Errorf("BE32 length prefix = %d, want %d", got, len(b0prime))
	}

	// Classical signature verifies over SignDoc(finalBody, A, chainID, accNum).
	priv := &secp256k1.PrivKey{Key: acc.PrivateKey}
	signDoc := &sdktx.SignDoc{
		BodyBytes:     txRaw.BodyBytes,
		AuthInfoBytes: txRaw.AuthInfoBytes,
		ChainId:       testChainID,
		AccountNumber: 11,
	}
	signBytes, err := proto.Marshal(signDoc)
	if err != nil {
		t.Fatalf("marshal SignDoc: %v", err)
	}
	if !priv.PubKey().VerifySignature(signBytes, txRaw.Signatures[0]) {
		t.Error("classical signature does not verify over final SignDoc")
	}
}

func TestBuildHybridTxIncludesPublicKey(t *testing.T) {
	acc := mustAccount(t)
	kp, err := pqc.GeneratePQCKeypair()
	if err != nil {
		t.Fatalf("generate PQC keypair: %v", err)
	}
	msg := &banktypes.MsgSend{
		FromAddress: acc.Address,
		ToAddress:   "qor1recipient00000000000000000000000000000",
		Amount:      coins("uqor", "1"),
	}
	built, err := BuildHybridTx(BuildHybridTxParams{
		Account:             acc,
		PQCKeypair:          kp,
		Messages:            []Message{{TypeURL: MsgSendTypeURL, Value: msg}},
		Fee:                 sampleFee(),
		ChainID:             testChainID,
		AccountNumber:       1,
		Sequence:            0,
		IncludePQCPublicKey: true,
	})
	if err != nil {
		t.Fatalf("BuildHybridTx: %v", err)
	}
	var txRaw sdktx.TxRaw
	if err := proto.Unmarshal(built.TxRawBytes, &txRaw); err != nil {
		t.Fatalf("unmarshal TxRaw: %v", err)
	}
	var finalBody sdktx.TxBody
	if err := proto.Unmarshal(txRaw.BodyBytes, &finalBody); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	var extJSON struct {
		PqcPublicKey string `json:"pqc_public_key"`
	}
	if err := json.Unmarshal(finalBody.ExtensionOptions[0].Value, &extJSON); err != nil {
		t.Fatalf("ext value not JSON: %v", err)
	}
	pkBytes, err := base64.StdEncoding.DecodeString(extJSON.PqcPublicKey)
	if err != nil {
		t.Fatalf("pqc_public_key not std-base64: %v", err)
	}
	if len(pkBytes) != pqc.MLDSA87PublicKeyLength {
		t.Errorf("pubkey len = %d, want %d", len(pkBytes), pqc.MLDSA87PublicKeyLength)
	}
}

// helpers shared with the implementation's test only.

func coins(denom, amount string) sdktypes.Coins {
	amt, _ := math.NewIntFromString(amount)
	return sdktypes.Coins{sdktypes.Coin{Denom: denom, Amount: amt}}
}

func frame(b0, a []byte) []byte {
	out := make([]byte, 0, 8+len(b0)+len(a))
	var p [4]byte
	binary.BigEndian.PutUint32(p[:], uint32(len(b0)))
	out = append(out, p[:]...)
	out = append(out, b0...)
	binary.BigEndian.PutUint32(p[:], uint32(len(a)))
	out = append(out, p[:]...)
	out = append(out, a...)
	return out
}
