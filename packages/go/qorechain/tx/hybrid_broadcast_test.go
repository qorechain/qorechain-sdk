package tx

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/cosmos/cosmos-sdk/types"
	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	"github.com/cosmos/gogoproto/proto"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
)

// decodeHybrid extracts the ML-DSA-87 signature and B0 / A from a hybrid TxRaw.
func decodeHybrid(txBytes []byte) (sig, b0, authInfo []byte, err error) {
	var raw sdktx.TxRaw
	if err := proto.Unmarshal(txBytes, &raw); err != nil {
		return nil, nil, nil, err
	}
	var body sdktx.TxBody
	if err := proto.Unmarshal(raw.BodyBytes, &body); err != nil {
		return nil, nil, nil, err
	}
	if len(body.ExtensionOptions) != 1 {
		return nil, nil, nil, fmt.Errorf("expected 1 extension option, got %d", len(body.ExtensionOptions))
	}
	var ext pqcv1.PQCHybridSignature
	if err := ext.Unmarshal(body.ExtensionOptions[0].Value); err != nil {
		return nil, nil, nil, err
	}
	stripped := body
	stripped.ExtensionOptions = nil
	b0, err = proto.Marshal(&stripped)
	if err != nil {
		return nil, nil, nil, err
	}
	return ext.PQCSignature, b0, raw.AuthInfoBytes, nil
}

func pqcSigFromTx(t *testing.T, txBytes []byte) (sig, b0, authInfo []byte) {
	t.Helper()
	sig, b0, authInfo, err := decodeHybrid(txBytes)
	if err != nil {
		t.Fatalf("decode hybrid tx: %v", err)
	}
	return sig, b0, authInfo
}

// fakeChain is a REST node for a network that verifies ONLY one hybrid form
// (verifies), while its applied-plan endpoint answers planBodies in turn (the
// last one repeats) — modelling a node whose first answer was stale.
type fakeChain struct {
	pub          []byte
	chainID      string
	verifies     signbytes.Version
	rejectCS     string // codespace used when refusing
	rejectCode   uint32
	rejectLog    string
	planBodies   []string
	planHits     atomic.Int32 // resolve ROUNDS (one per applied-plan lookup)
	planRequests atomic.Int32 // individual applied-plan requests, one per name
	broadcasts   atomic.Int32
}

// appliedPlanPrefix is the REST path of the upgrade applied-plan query; the plan
// name follows it.
const appliedPlanPrefix = "/cosmos/upgrade/v1beta1/applied_plan/"

func (f *fakeChain) server() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, appliedPlanPrefix):
			// The switch to v2 ships under several plan names and this network,
			// like diana, took the LAST one: the earlier names answer "not
			// applied", so a client that asks only for the first resolves v1 and
			// is refused with pqc 21. One resolve round asks every name in turn.
			name := strings.TrimPrefix(r.URL.Path, appliedPlanPrefix)
			f.planRequests.Add(1)
			if name != signbytes.V2Upgrades[len(signbytes.V2Upgrades)-1] {
				f.planHits.Add(1)
				_, _ = w.Write([]byte(`{}`))
				return
			}
			i := int(f.planHits.Load()) - 1
			if i < 0 {
				i = 0
			}
			if i >= len(f.planBodies) {
				i = len(f.planBodies) - 1
			}
			_, _ = w.Write([]byte(f.planBodies[i]))
		case r.URL.Path == "/cosmos/tx/v1beta1/txs" && r.Method == http.MethodPost:
			f.broadcasts.Add(1)
			var req struct {
				TxBytes string `json:"tx_bytes"`
			}
			b, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(b, &req)
			txBytes, _ := base64.StdEncoding.DecodeString(req.TxBytes)
			sig, b0, a, derr := decodeHybrid(txBytes)
			msg, _ := signbytes.Hybrid(f.verifies, f.chainID, b0, a)
			if derr != nil || !pqc.PQCVerify(f.pub, msg, sig) {
				resp := map[string]any{"tx_response": map[string]any{
					"txhash": "BAD", "code": f.rejectCode, "codespace": f.rejectCS, "raw_log": f.rejectLog,
				}}
				_ = json.NewEncoder(w).Encode(resp)
				return
			}
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"GOOD","code":0}}`))
		default: // tx poll
			_, _ = w.Write([]byte(`{"tx_response":{"txhash":"GOOD","code":0,"height":"10","gas_used":"1","gas_wanted":"2"}}`))
		}
	}))
}

func hybridParams(t *testing.T, kp pqc.Keypair, chainID string, v signbytes.Version) BuildHybridMessagesParams {
	acc := mustAccount(t)
	return BuildHybridMessagesParams{
		Account:          acc,
		PQCKeypair:       kp,
		Messages:         []sdk.Msg{&banktypes.MsgSend{FromAddress: acc.Address, ToAddress: acc.Address, Amount: coins("uqor", "1")}},
		Fee:              sampleFee(),
		ChainID:          chainID,
		AccountNumber:    3,
		Sequence:         9,
		SignBytesVersion: v,
	}
}

func newKeypair(t *testing.T) pqc.Keypair {
	t.Helper()
	kp, err := pqc.GeneratePQCKeypair()
	if err != nil {
		t.Fatal(err)
	}
	return kp
}

func TestBroadcastHybridRetriesOnceAfterPQC21(t *testing.T) {
	kp := newKeypair(t)
	fc := &fakeChain{
		pub: kp.PublicKey, chainID: "qorechain-diana", verifies: signbytes.V2,
		rejectCS: "pqc", rejectCode: 21, rejectLog: "hybrid PQC signature verification failed",
		// First answer is stale (plan not applied yet), then the upgrade shows.
		planBodies: []string{`{"height":"0"}`, `{"height":"5746000"}`},
	}
	srv := fc.server()
	defer srv.Close()

	out, err := BroadcastHybridAndWait(BroadcastHybridParams{
		Build:    hybridParams(t, kp, "qorechain-diana", signbytes.Auto),
		RestURL:  srv.URL,
		Wait:     WaitOptions{Timeout: 2 * time.Second, Poll: 10 * time.Millisecond},
		Resolver: signbytes.NewResolver(signbytes.ResolverOptions{}),
	})
	if err != nil {
		t.Fatalf("BroadcastHybridAndWait: %v", err)
	}
	if !out.Retried || out.Built.SignBytesVersion != signbytes.V2 || out.Result.TxHash != "GOOD" {
		t.Fatalf("result = retried %v version %s hash %s", out.Retried, out.Built.SignBytesVersion, out.Result.TxHash)
	}
	if b, p := fc.broadcasts.Load(), fc.planHits.Load(); b != 2 || p != 2 {
		t.Fatalf("broadcasts %d plan queries %d, want 2 and 2", b, p)
	}
	// Each round asks for every name, so the record under the later name is found.
	if got, want := fc.planRequests.Load(), int32(2*len(signbytes.V2Upgrades)); got != want {
		t.Fatalf("applied-plan requests = %d, want %d (every name, both rounds)", got, want)
	}
}

func TestBroadcastHybridExplicitVersionNoRetry(t *testing.T) {
	kp := newKeypair(t)
	fc := &fakeChain{
		pub: kp.PublicKey, chainID: "qorechain-diana", verifies: signbytes.V2,
		rejectCS: "pqc", rejectCode: 21, rejectLog: "hybrid PQC signature verification failed",
		planBodies: []string{`{"height":"5746000"}`},
	}
	srv := fc.server()
	defer srv.Close()

	out, err := BroadcastHybridAndWait(BroadcastHybridParams{
		Build:    hybridParams(t, kp, "qorechain-diana", signbytes.V1),
		RestURL:  srv.URL,
		Resolver: signbytes.NewResolver(signbytes.ResolverOptions{}),
	})
	if err == nil || !IsHybridSignBytesRejection(err) {
		t.Fatalf("expected the pqc 21 refusal, got %v", err)
	}
	var txErr *QoreTxError
	if !errors.As(err, &txErr) || txErr.Codespace != "pqc" || txErr.Code != 21 {
		t.Fatalf("error = %#v", err)
	}
	if out == nil || out.Retried {
		t.Fatal("explicit version must not retry")
	}
	if b, p := fc.broadcasts.Load(), fc.planHits.Load(); b != 1 || p != 0 {
		t.Fatalf("broadcasts %d plan queries %d, want 1 and 0", b, p)
	}
}

func TestBroadcastHybridOtherCodespace21NoRetry(t *testing.T) {
	kp := newKeypair(t)
	fc := &fakeChain{
		pub: kp.PublicKey, chainID: "qorechain-diana", verifies: signbytes.V2,
		rejectCS: "sdk", rejectCode: 21, rejectLog: "tx too large",
		planBodies: []string{`{"height":"0"}`, `{"height":"5746000"}`},
	}
	srv := fc.server()
	defer srv.Close()

	out, err := BroadcastHybridAndWait(BroadcastHybridParams{
		Build:    hybridParams(t, kp, "qorechain-diana", signbytes.Auto),
		RestURL:  srv.URL,
		Resolver: signbytes.NewResolver(signbytes.ResolverOptions{}),
	})
	if err == nil || IsHybridSignBytesRejection(err) {
		t.Fatalf("expected a non-hybrid refusal, got %v", err)
	}
	if out.Retried {
		t.Fatal("sdk code 21 must not retry")
	}
	if b, p := fc.broadcasts.Load(), fc.planHits.Load(); b != 1 || p != 1 {
		t.Fatalf("broadcasts %d plan queries %d, want 1 and 1", b, p)
	}
}

func TestBroadcastHybridLegacyWithoutRestURLFails(t *testing.T) {
	kp := newKeypair(t)
	_, err := BroadcastHybridAndWait(BroadcastHybridParams{
		Build:    hybridParams(t, kp, "qorechain-vladi", signbytes.Auto),
		Resolver: signbytes.NewResolver(signbytes.ResolverOptions{}),
	})
	if !errors.Is(err, signbytes.ErrUnresolvedVersion) {
		t.Fatalf("err = %v, want ErrUnresolvedVersion", err)
	}
}

func TestBuildHybridTxV2SignatureBindsV2Bytes(t *testing.T) {
	kp := newKeypair(t)
	built, err := BuildHybridMessages(hybridParams(t, kp, "qorechain-diana", signbytes.V2))
	if err != nil {
		t.Fatal(err)
	}
	if built.SignBytesVersion != signbytes.V2 {
		t.Fatalf("SignBytesVersion = %s", built.SignBytesVersion)
	}
	sig, b0, a := pqcSigFromTx(t, built.TxRawBytes)
	v2 := signbytes.HybridV2("qorechain-diana", b0, a)
	v1 := signbytes.HybridV1(b0, a)
	if !bytes.Equal(built.PQCSignedMessage, v2) {
		t.Fatal("PQCSignedMessage is not the v2 sign-bytes")
	}
	if !pqc.PQCVerify(kp.PublicKey, v2, sig) {
		t.Fatal("v2 signature does not verify over the v2 bytes")
	}
	if pqc.PQCVerify(kp.PublicKey, v1, sig) {
		t.Fatal("v2 signature must NOT verify over the v1 bytes")
	}
	// Bound to the chain id: the same signature fails for another network.
	if pqc.PQCVerify(kp.PublicKey, signbytes.HybridV2("qorechain-vladi", b0, a), sig) {
		t.Fatal("v2 signature must NOT verify for another chain id")
	}
}

func TestBuildHybridTxAutoOffline(t *testing.T) {
	kp := newKeypair(t)
	// Non-legacy chain: auto resolves to v2 offline.
	built, err := BuildHybridMessages(hybridParams(t, kp, "qorechain-devnet-1", ""))
	if err != nil || built.SignBytesVersion != signbytes.V2 {
		t.Fatalf("non-legacy auto: %v, %v", built, err)
	}
	// Legacy chain: auto without a resolved version fails loudly.
	for _, chain := range signbytes.LegacyChains() {
		_, err := BuildHybridMessages(hybridParams(t, kp, chain, signbytes.Auto))
		if !errors.Is(err, signbytes.ErrUnresolvedVersion) || !strings.Contains(err.Error(), chain) {
			t.Fatalf("%s auto: err = %v", chain, err)
		}
	}
}

func TestIsHybridSignBytesRejection(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{nil, false},
		{DecodeTxError(21, "pqc", ""), true},
		{DecodeTxError(21, "sdk", "tx too large"), false},
		{DecodeTxError(21, "", "tx too large"), false},
		{DecodeTxError(4, "", "hybrid PQC signature verification failed: bad sig"), true},
		{errors.New("broadcast HTTP 400: hybrid PQC signature verification failed"), true},
		{errors.New("connection refused"), false},
	}
	for i, c := range cases {
		if got := IsHybridSignBytesRejection(c.err); got != c.want {
			t.Errorf("case %d (%v): got %v, want %v", i, c.err, got, c.want)
		}
	}
}
