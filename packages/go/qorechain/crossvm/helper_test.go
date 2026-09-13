package crossvm

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	"github.com/cosmos/gogoproto/proto"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

func testSigner(t *testing.T) Signer {
	t.Helper()
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	acc, err := accounts.DeriveNativeAccount(mnemonic, 0)
	if err != nil {
		t.Fatalf("derive account: %v", err)
	}
	return Signer{
		Account:       acc,
		ChainID:       "qorechain-vladi",
		AccountNumber: 1,
		Sequence:      0,
		Fee:           tx.Fee{Amount: []tx.Coin{{Denom: "uqor", Amount: "3500"}}, Gas: "140000"},
	}
}

// decodeMsgs decodes the MsgCrossVMCall messages carried by a BuiltTx.
func decodeMsgs(t *testing.T, built *tx.BuiltTx) []*crossvmv1.MsgCrossVMCall {
	t.Helper()
	var body sdktx.TxBody
	if err := proto.Unmarshal(built.TxRaw.BodyBytes, &body); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	out := make([]*crossvmv1.MsgCrossVMCall, 0, len(body.Messages))
	for _, anyMsg := range body.Messages {
		if anyMsg.TypeUrl != MsgCrossVMCallTypeURL {
			t.Fatalf("unexpected type url: %s", anyMsg.TypeUrl)
		}
		var m crossvmv1.MsgCrossVMCall
		if err := proto.Unmarshal(anyMsg.Value, &m); err != nil {
			t.Fatalf("unmarshal MsgCrossVMCall: %v", err)
		}
		out = append(out, &m)
	}
	return out
}

func TestBuildCallFields(t *testing.T) {
	signer := testSigner(t)
	c := New(signer, Options{})
	built, err := c.BuildCall(CallOptions{
		TargetVM:       VMTypeSVM,
		TargetContract: "SoMeSvMpRoGrAm",
		Payload:        []byte{0xaa, 0xbb},
		Funds:          sdk.NewCoins(sdk.NewInt64Coin("uqor", 100)),
	})
	if err != nil {
		t.Fatalf("BuildCall: %v", err)
	}
	msgs := decodeMsgs(t, built)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	m := msgs[0]
	if m.Sender != signer.Account.Address {
		t.Errorf("sender = %q, want %q", m.Sender, signer.Account.Address)
	}
	if m.SourceVM != VMTypeEVM { // defaulted
		t.Errorf("sourceVM = %q, want default evm", m.SourceVM)
	}
	if m.TargetVM != VMTypeSVM {
		t.Errorf("targetVM = %q, want svm", m.TargetVM)
	}
	if m.TargetContract != "SoMeSvMpRoGrAm" {
		t.Errorf("targetContract = %q", m.TargetContract)
	}
	if string(m.Payload) != string([]byte{0xaa, 0xbb}) {
		t.Errorf("payload = %x", m.Payload)
	}
	if len(m.Funds) != 1 || m.Funds[0].Denom != "uqor" || m.Funds[0].Amount.Int64() != 100 {
		t.Errorf("funds = %v", m.Funds)
	}
	if len(built.TxRaw.Signatures) != 1 || len(built.TxRaw.Signatures[0]) == 0 {
		t.Fatal("missing signature")
	}
}

func TestBuildCallCosmwasmMarshalsJSON(t *testing.T) {
	signer := testSigner(t)
	c := New(signer, Options{})
	execMsg := map[string]any{"transfer": map[string]any{"recipient": "qor1xyz", "amount": "5"}}
	built, err := c.BuildCall(CallOptions{
		TargetVM:       VMTypeCosmWasm,
		TargetContract: "qor1contract",
		Cosmwasm:       execMsg,
	})
	if err != nil {
		t.Fatalf("BuildCall cosmwasm: %v", err)
	}
	m := decodeMsgs(t, built)[0]
	want, _ := json.Marshal(execMsg)
	if string(m.Payload) != string(want) {
		t.Errorf("payload = %s, want %s", m.Payload, want)
	}
	if m.TargetVM != VMTypeCosmWasm {
		t.Errorf("targetVM = %q", m.TargetVM)
	}
}

func TestCallOptionsPayloadExclusivity(t *testing.T) {
	c := New(testSigner(t), Options{})
	// Both set → error.
	if _, err := c.BuildCall(CallOptions{TargetVM: VMTypeEVM, TargetContract: "0x1", Payload: []byte{1}, Cosmwasm: map[string]any{}}); err == nil {
		t.Error("expected error when both Payload and Cosmwasm set")
	}
	// Neither set → error.
	if _, err := c.BuildCall(CallOptions{TargetVM: VMTypeEVM, TargetContract: "0x1"}); err == nil {
		t.Error("expected error when neither Payload nor Cosmwasm set")
	}
	// Missing target → error.
	if _, err := c.BuildCall(CallOptions{Payload: []byte{1}}); err == nil {
		t.Error("expected error when TargetVM/TargetContract missing")
	}
}

func TestBuildCallAtomicSingleTxNMessages(t *testing.T) {
	c := New(testSigner(t), Options{})
	built, err := c.BuildCallAtomic([]CallOptions{
		{TargetVM: VMTypeEVM, TargetContract: "0xaaa", Payload: []byte{0x01}},
		{TargetVM: VMTypeSVM, TargetContract: "prog", Payload: []byte{0x02}},
		{SourceVM: VMTypeCosmWasm, TargetVM: VMTypeEVM, TargetContract: "0xbbb", Cosmwasm: map[string]any{"a": 1}},
	})
	if err != nil {
		t.Fatalf("BuildCallAtomic: %v", err)
	}
	msgs := decodeMsgs(t, built)
	if len(msgs) != 3 {
		t.Fatalf("expected 3 messages in ONE tx, got %d", len(msgs))
	}
	// One signature → one tx.
	if len(built.TxRaw.Signatures) != 1 {
		t.Errorf("expected 1 signature (single tx), got %d", len(built.TxRaw.Signatures))
	}
	if msgs[2].SourceVM != VMTypeCosmWasm {
		t.Errorf("msg[2] sourceVM = %q, want cosmwasm", msgs[2].SourceVM)
	}
	if string(msgs[1].Payload) != string([]byte{0x02}) {
		t.Errorf("msg[1] payload = %x", msgs[1].Payload)
	}
}

func TestCallAtomicEmpty(t *testing.T) {
	c := New(testSigner(t), Options{})
	if _, err := c.CallAtomic(nil); err == nil {
		t.Error("expected error for empty CallAtomic")
	}
}

func TestCallBroadcasts(t *testing.T) {
	var broadcastBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch r.URL.Path {
		case "/cosmos/tx/v1beta1/txs":
			broadcastBody = string(body)
			w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0}}`))
		default:
			// tx-by-hash poll
			w.Write([]byte(`{"tx_response":{"txhash":"ABC123","code":0,"height":"10","gas_used":"1000","gas_wanted":"2000"}}`))
		}
	}))
	defer srv.Close()

	signer := testSigner(t)
	signer.RestURL = srv.URL
	c := New(signer, Options{})
	res, err := c.Call(CallOptions{TargetVM: VMTypeEVM, TargetContract: "0xdead", Payload: []byte{0x01}})
	if err != nil {
		t.Fatalf("Call: %v", err)
	}
	if res.TxHash != "ABC123" {
		t.Errorf("hash = %q, want ABC123", res.TxHash)
	}
	if broadcastBody == "" {
		t.Error("broadcast was not called")
	}
}

// ---- GetMessage ----

type fakeCrossVMServer struct {
	crossvmv1.UnimplementedQueryServer
}

func (*fakeCrossVMServer) Message(_ context.Context, req *crossvmv1.QueryMessageRequest) (*crossvmv1.QueryMessageResponse, error) {
	return &crossvmv1.QueryMessageResponse{
		Found:   true,
		Message: &crossvmv1.CrossVMMessageView{Id: req.Id, Status: "executed", SourceVm: "evm", TargetVm: "svm"},
	}, nil
}

func TestGetMessageViaGRPC(t *testing.T) {
	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	crossvmv1.RegisterQueryServer(srv, &fakeCrossVMServer{})
	go func() { _ = srv.Serve(lis) }()
	defer srv.Stop()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial bufconn: %v", err)
	}
	defer conn.Close()

	c := New(testSigner(t), Options{Query: crossvmv1.NewQueryClient(conn)})
	resp, err := c.GetMessage("msg-1")
	if err != nil {
		t.Fatalf("GetMessage: %v", err)
	}
	if !resp.Found || resp.Message.Id != "msg-1" || resp.Message.Status != "executed" {
		t.Errorf("resp = %+v", resp)
	}
}

type fakeQor struct{ called string }

func (f *fakeQor) GetCrossVMMessage(id string) (json.RawMessage, error) {
	f.called = id
	return json.RawMessage(`{"found":true,"message":{"id":"` + id + `","status":"pending"}}`), nil
}

func TestGetMessageViaQorFallback(t *testing.T) {
	q := &fakeQor{}
	c := New(testSigner(t), Options{Qor: q})
	resp, err := c.GetMessage("msg-2")
	if err != nil {
		t.Fatalf("GetMessage qor: %v", err)
	}
	if q.called != "msg-2" {
		t.Errorf("qor called with %q", q.called)
	}
	if resp.Message == nil || resp.Message.Id != "msg-2" {
		t.Errorf("resp = %+v", resp)
	}
}

func TestGetMessageNoClient(t *testing.T) {
	c := New(testSigner(t), Options{})
	if _, err := c.GetMessage("x"); err == nil {
		t.Error("expected error when no query client configured")
	}
}

func TestVMTypeConstants(t *testing.T) {
	if VMTypeEVM != "evm" || VMTypeCosmWasm != "cosmwasm" || VMTypeSVM != "svm" {
		t.Errorf("vm type constants wrong: %q %q %q", VMTypeEVM, VMTypeCosmWasm, VMTypeSVM)
	}
	if MsgCrossVMCallTypeURL != "/qorechain.crossvm.v1.MsgCrossVMCall" {
		t.Errorf("type url = %q", MsgCrossVMCallTypeURL)
	}
}

// ---- async ----

// TestBuildCallAsyncDefaultsToSynchronous asserts the default is "execute now
// and return the answer": a caller that does not ask for async must not get a
// queued call.
func TestBuildCallAsyncDefaultsToSynchronous(t *testing.T) {
	c := New(testSigner(t), Options{})
	built, err := c.BuildCall(CallOptions{
		TargetVM:       VMTypeEVM,
		TargetContract: "0xdead",
		Payload:        []byte{0x01},
	})
	if err != nil {
		t.Fatalf("BuildCall: %v", err)
	}
	if decodeMsgs(t, built)[0].Async {
		t.Error("async must default to false (execute now)")
	}
}

// TestBuildCallAsyncRoundTrips asserts Async=true reaches the encoded message.
func TestBuildCallAsyncRoundTrips(t *testing.T) {
	c := New(testSigner(t), Options{})
	built, err := c.BuildCall(CallOptions{
		TargetVM:       VMTypeCosmWasm,
		TargetContract: "qor1contract",
		Cosmwasm:       map[string]any{"ping": map[string]any{}},
		Async:          true,
	})
	if err != nil {
		t.Fatalf("BuildCall async: %v", err)
	}
	m := decodeMsgs(t, built)[0]
	if !m.Async {
		t.Fatal("async did not survive encoding into the tx body")
	}
	if m.TargetContract != "qor1contract" {
		t.Errorf("targetContract = %q", m.TargetContract)
	}
}

// TestBuildCallAtomicPerCallAsync asserts async is per-call, not per-tx: one
// transaction may mix a queued call with one that executes inline.
func TestBuildCallAtomicPerCallAsync(t *testing.T) {
	c := New(testSigner(t), Options{})
	built, err := c.BuildCallAtomic([]CallOptions{
		{TargetVM: VMTypeEVM, TargetContract: "0xaaa", Payload: []byte{0x01}, Async: true},
		{TargetVM: VMTypeSVM, TargetContract: "prog", Payload: []byte{0x02}},
	})
	if err != nil {
		t.Fatalf("BuildCallAtomic: %v", err)
	}
	msgs := decodeMsgs(t, built)
	if !msgs[0].Async {
		t.Error("msg[0] should be async")
	}
	if msgs[1].Async {
		t.Error("msg[1] should be synchronous")
	}
}

// ---- response decoding ----

// txResultWithResponses builds a tx.TxResult whose Raw carries the given
// cross-VM responses, encoded exactly as the chain does: TxResponse.data is the
// hex of the protobuf sdk.TxMsgData.
func txResultWithResponses(t *testing.T, responses ...*crossvmv1.MsgCrossVMCallResponse) *tx.TxResult {
	t.Helper()
	msgData := &sdk.TxMsgData{}
	for _, r := range responses {
		value, err := proto.Marshal(r)
		if err != nil {
			t.Fatalf("marshal response: %v", err)
		}
		msgData.MsgResponses = append(msgData.MsgResponses, &codectypes.Any{
			TypeUrl: MsgCrossVMCallResponseTypeURL,
			Value:   value,
		})
	}
	encoded, err := proto.Marshal(msgData)
	if err != nil {
		t.Fatalf("marshal TxMsgData: %v", err)
	}
	body, err := json.Marshal(map[string]any{
		"tx_response": map[string]any{
			"txhash": "ABC123",
			"code":   0,
			"data":   strings.ToUpper(hex.EncodeToString(encoded)),
		},
	})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	return &tx.TxResult{TxHash: "ABC123", Raw: body}
}

// TestDecodeCallResultSynchronous asserts the executed call's answer — Data,
// GasUsed and Executed — is surfaced alongside the message id.
func TestDecodeCallResultSynchronous(t *testing.T) {
	res := txResultWithResponses(t, &crossvmv1.MsgCrossVMCallResponse{
		MessageID: "msg-7",
		Executed:  true,
		Data:      []byte{0xca, 0xfe},
		GasUsed:   42_000,
	})

	got, err := DecodeCallResult(res)
	if err != nil {
		t.Fatalf("DecodeCallResult: %v", err)
	}
	if got.MessageID != "msg-7" {
		t.Errorf("MessageID = %q, want msg-7", got.MessageID)
	}
	if !got.Executed {
		t.Error("Executed = false, want true for a synchronous call")
	}
	if string(got.Data) != string([]byte{0xca, 0xfe}) {
		t.Errorf("Data = %x, want cafe", got.Data)
	}
	if got.GasUsed != 42_000 {
		t.Errorf("GasUsed = %d, want 42000", got.GasUsed)
	}
}

// TestDecodeCallResultQueued asserts a queued (async) call reports Executed
// false with no data — the id is all the caller gets until ProcessQueue runs.
func TestDecodeCallResultQueued(t *testing.T) {
	res := txResultWithResponses(t, &crossvmv1.MsgCrossVMCallResponse{MessageID: "msg-8"})

	got, err := DecodeCallResult(res)
	if err != nil {
		t.Fatalf("DecodeCallResult: %v", err)
	}
	if got.MessageID != "msg-8" || got.Executed || len(got.Data) != 0 || got.GasUsed != 0 {
		t.Errorf("queued result = %+v", got)
	}
}

// TestDecodeCallResultsOrder asserts results come back in message order, so
// result[i] belongs to the i-th CallAtomic option.
func TestDecodeCallResultsOrder(t *testing.T) {
	res := txResultWithResponses(t,
		&crossvmv1.MsgCrossVMCallResponse{MessageID: "a", Executed: true, Data: []byte{0x01}, GasUsed: 1},
		&crossvmv1.MsgCrossVMCallResponse{MessageID: "b"},
		&crossvmv1.MsgCrossVMCallResponse{MessageID: "c", Executed: true, Data: []byte{0x03}, GasUsed: 3},
	)

	all, err := DecodeCallResults(res)
	if err != nil {
		t.Fatalf("DecodeCallResults: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("expected 3 results, got %d", len(all))
	}
	for i, want := range []string{"a", "b", "c"} {
		if all[i].MessageID != want {
			t.Errorf("result[%d] id = %q, want %q", i, all[i].MessageID, want)
		}
	}
	if all[1].Executed || all[2].GasUsed != 3 {
		t.Errorf("results = %+v", all)
	}
}

// TestDecodeCallResultsEventFallback covers a node that leaves TxResponse.data
// empty: the ids are still recovered from the events, with the other fields
// zero.
func TestDecodeCallResultsEventFallback(t *testing.T) {
	body := []byte(`{"tx_response":{"txhash":"ABC","code":0,"data":"","events":[
		{"type":"crossvm_call","attributes":[{"key":"message_id","value":"evt-1"}]},
		{"type":"crossvm_call","attributes":[{"key":"message_id","value":"evt-2"}]}
	]}}`)
	all, err := DecodeCallResults(&tx.TxResult{TxHash: "ABC", Raw: body})
	if err != nil {
		t.Fatalf("DecodeCallResults: %v", err)
	}
	if len(all) != 2 || all[0].MessageID != "evt-1" || all[1].MessageID != "evt-2" {
		t.Fatalf("event fallback = %+v", all)
	}
}

// TestDecodeCallResultErrors covers the inputs that carry no response at all.
func TestDecodeCallResultErrors(t *testing.T) {
	if _, err := DecodeCallResults(nil); err == nil {
		t.Error("expected an error for a nil tx result")
	}
	if _, err := DecodeCallResults(&tx.TxResult{TxHash: "X"}); err == nil {
		t.Error("expected an error when the tx result carries no raw body")
	}
	empty := []byte(`{"tx_response":{"txhash":"X","code":0,"data":""}}`)
	if _, err := DecodeCallResult(&tx.TxResult{TxHash: "X", Raw: empty}); err == nil {
		t.Error("expected an error when the tx carries no cross-VM response")
	}
}
