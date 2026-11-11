package authenticator

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"
	dcrsecp "github.com/decred/dcrd/dcrec/secp256k1/v4"
	dcrecdsa "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

const (
	linkChain   = "qorechain-diana"
	linkAccount = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj"
)

func TestSignLinkEd25519VerifiesWithStdlib(t *testing.T) {
	seed := bytes.Repeat([]byte{0x07}, 32)
	pub, proof, err := SignLinkEd25519(seed, linkChain, linkAccount)
	if err != nil {
		t.Fatal(err)
	}
	text := messages.AuthenticatorLinkMessage(linkChain, linkAccount, "ed25519", pub)
	if !ed25519.Verify(ed25519.PublicKey(pub), []byte(text), proof) {
		t.Fatal("stdlib ed25519 does not verify the proof")
	}
	if err := VerifyPossessionProof(linkChain, linkAccount, "ed25519", pub, proof); err != nil {
		t.Fatal(err)
	}
	// The 64-byte private key form gives the same key and proof.
	pub2, proof2, err := SignLinkEd25519(ed25519.NewKeyFromSeed(seed), linkChain, linkAccount)
	if err != nil || !bytes.Equal(pub, pub2) || !bytes.Equal(proof, proof2) {
		t.Fatal("64-byte key form differs")
	}
	if err := VerifyPossessionProof("qorechain-vladi", linkAccount, "ed25519", pub, proof); err == nil {
		t.Fatal("proof for another chain accepted")
	}
}

func TestSignLinkSecp256k1VerifiesWithDecred(t *testing.T) {
	priv := bytes.Repeat([]byte{0x11}, 32)
	pub, proof, err := SignLinkSecp256k1(priv, linkChain, linkAccount)
	if err != nil {
		t.Fatal(err)
	}
	if len(pub) != 33 || len(proof) != 64 {
		t.Fatalf("sizes %d / %d", len(pub), len(proof))
	}
	pk, err := dcrsecp.ParsePubKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	var r, s dcrsecp.ModNScalar
	r.SetByteSlice(proof[:32])
	s.SetByteSlice(proof[32:])
	if s.IsOverHalfOrder() {
		t.Fatal("proof is not low-S")
	}
	digest := sha256.Sum256([]byte(messages.AuthenticatorLinkMessage(linkChain, linkAccount, "secp256k1", pub)))
	if !dcrecdsa.NewSignature(&r, &s).Verify(digest[:], pk) {
		t.Fatal("decred does not verify the proof")
	}
	if err := VerifyPossessionProof(linkChain, linkAccount, "secp256k1", pub, proof); err != nil {
		t.Fatal(err)
	}
	if err := VerifyPossessionProof(linkChain, linkAccount, "secp256k1", pk.SerializeUncompressed(), proof); err == nil {
		t.Fatal("uncompressed key accepted")
	}
}

func TestSignLinkEIP191Recovers(t *testing.T) {
	priv := bytes.Repeat([]byte{0x22}, 32)
	addr, proof, err := SignLinkEIP191(priv, linkChain, linkAccount)
	if err != nil {
		t.Fatal(err)
	}
	if len(addr) != 20 || len(proof) != 65 || (proof[64] != 27 && proof[64] != 28) {
		t.Fatalf("addr %d bytes, proof %d bytes, v %d", len(addr), len(proof), proof[64])
	}
	// Independent EIP-191 recovery.
	text := messages.AuthenticatorLinkMessage(linkChain, linkAccount, "secp256k1", addr)
	h := sha3.NewLegacyKeccak256()
	h.Write([]byte("\x19Ethereum Signed Message:\n" + itoa(len(text)) + text))
	pk, _, err := dcrecdsa.RecoverCompact(append([]byte{proof[64]}, proof[:64]...), h.Sum(nil))
	if err != nil {
		t.Fatal(err)
	}
	k := sha3.NewLegacyKeccak256()
	k.Write(pk.SerializeUncompressed()[1:])
	if !bytes.Equal(k.Sum(nil)[12:], addr) {
		t.Fatal("recovered address differs")
	}
	if err := VerifyPossessionProof(linkChain, linkAccount, "secp256k1", addr, proof); err != nil {
		t.Fatal(err)
	}
	// v as 0/1 is accepted too.
	alt := append([]byte(nil), proof...)
	alt[64] -= 27
	if err := VerifyPossessionProof(linkChain, linkAccount, "secp256k1", addr, alt); err != nil {
		t.Fatalf("v 0/1: %v", err)
	}
	other, _, _ := SignLinkEIP191(bytes.Repeat([]byte{0x23}, 32), linkChain, linkAccount)
	if err := VerifyPossessionProof(linkChain, linkAccount, "secp256k1", other, proof); err == nil {
		t.Fatal("proof accepted for another address")
	}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func TestLinkAuthenticatorMsgs(t *testing.T) {
	pub, proof, _ := SignLinkEd25519(bytes.Repeat([]byte{0x07}, 32), linkChain, linkAccount)
	rules := []abstractaccountv1.SpendingRule{{ID: "r", Enabled: true, PerTxLimit: 1000}}
	msgs, err := LinkAuthenticatorMsgs(LinkParams{Owner: linkAccount, ChainID: linkChain, Scheme: "ed25519", Pubkey: pub,
		Permissions: []string{"send"}, PossessionProof: proof, SpendingRules: rules})
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 2 {
		t.Fatalf("got %d msgs", len(msgs))
	}
	up, ok1 := msgs[0].(*abstractaccountv1.MsgUpdateSpendingRules)
	reg, ok2 := msgs[1].(*abstractaccountv1.MsgRegisterAuthenticator)
	if !ok1 || !ok2 || up.Owner != linkAccount || up.AccountAddress != linkAccount || !bytes.Equal(reg.PossessionProof, proof) {
		t.Fatalf("msgs = %+v", msgs)
	}
	// No value permission and no rules: only the registration.
	msgs, err = LinkAuthenticatorMsgs(LinkParams{Owner: linkAccount, ChainID: linkChain, Scheme: "ed25519", Pubkey: pub,
		Permissions: []string{"query"}, PossessionProof: proof})
	if err != nil || len(msgs) != 1 {
		t.Fatalf("msgs = %v, err = %v", msgs, err)
	}
	bad := []LinkParams{
		{Owner: linkAccount, ChainID: linkChain, Scheme: "ed25519", Pubkey: pub, Permissions: []string{"send"}, PossessionProof: proof},
		{Owner: linkAccount, ChainID: linkChain, Scheme: "ed25519", Pubkey: pub, Permissions: []string{"all"}, PossessionProof: proof,
			SpendingRules: []abstractaccountv1.SpendingRule{{Enabled: true, AllowedDenoms: []string{"uqor"}}}},
		{Owner: linkAccount, ChainID: linkChain, Scheme: "ed25519", Pubkey: pub, PossessionProof: nil},
		{Owner: linkAccount, ChainID: "other", Scheme: "ed25519", Pubkey: pub, PossessionProof: proof},
	}
	for i, p := range bad {
		if _, err := LinkAuthenticatorMsgs(p); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}

func anyOf(t *testing.T, m proto.Message) *codectypes.Any {
	t.Helper()
	b, err := proto.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return &codectypes.Any{TypeUrl: "/" + proto.MessageName(m), Value: b}
}

func execTxResult(t *testing.T, responses []*codectypes.Any, events string) *tx.TxResult {
	t.Helper()
	data, err := proto.Marshal(&sdk.TxMsgData{MsgResponses: responses})
	if err != nil {
		t.Fatal(err)
	}
	raw := `{"tx_response":{"txhash":"ABC","code":0,"data":"` + strings.ToUpper(hex.EncodeToString(data)) + `","events":` + events + `}}`
	return &tx.TxResult{TxHash: "ABC", Raw: json.RawMessage(raw)}
}

func TestDecodeExecutionResults(t *testing.T) {
	events := `[{"type":"message","attributes":[{"key":"action","value":"x"}]},
	 {"type":"abstractaccount_execution_failed","attributes":[{"key":"account","value":"qor1a"},{"key":"lane","value":"evm"},{"key":"nonce","value":"4"},{"key":"reason","value":"execution reverted"},{"key":"msg_index","value":"1"}]}]`
	res := execTxResult(t, []*codectypes.Any{
		anyOf(t, &abstractaccountv1.MsgExecuteCosmosResponse{Success: true}),
		anyOf(t, &abstractaccountv1.MsgExecuteEVMResponse{Success: false, Ret: []byte{1}, GasUsed: 21000, VmError: "revert"}),
	}, events)
	out, err := DecodeExecutionResults(res)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 || !out[0].Success || out[0].Lane != "cosmos" || out[1].Success || out[1].GasUsed != 21000 ||
		out[1].VMError != "revert" || out[1].Reason != "execution reverted" || out[1].Nonce != "4" || out[1].Account != "qor1a" {
		t.Fatalf("out = %+v", out)
	}
	_, err = RequireExecutionsSucceeded(res)
	var fe *ExecutionFailedError
	if !errors.As(err, &fe) || len(fe.Failed) != 1 || !strings.Contains(err.Error(), "execution reverted") {
		t.Fatalf("err = %v", err)
	}
	ok := execTxResult(t, []*codectypes.Any{anyOf(t, &abstractaccountv1.MsgExecuteEVMResponse{Success: true})}, `[]`)
	if _, err := RequireExecutionsSucceeded(ok); err != nil {
		t.Fatal(err)
	}
}

func TestDecodeExecutionResultsEventsOnly(t *testing.T) {
	raw := `{"tx_response":{"txhash":"ABC","data":"","events":[{"type":"abstractaccount_execution_failed","attributes":[{"key":"lane","value":"cosmos"},{"key":"reason","value":"insufficient funds"}]}]}}`
	out, err := DecodeExecutionResults(&tx.TxResult{TxHash: "ABC", Raw: json.RawMessage(raw)})
	if err != nil || len(out) != 1 || out[0].Success || out[0].Reason != "insufficient funds" {
		t.Fatalf("out = %+v, err = %v", out, err)
	}
}
