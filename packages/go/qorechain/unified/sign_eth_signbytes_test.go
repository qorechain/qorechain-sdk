package unified

import (
	"errors"
	"testing"

	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	"github.com/cosmos/gogoproto/proto"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
)

func signHybridEthFor(t *testing.T, chainID string, v signbytes.Version) (UnifiedAccount, []byte, error) {
	t.Helper()
	acc, err := DeriveUnifiedAccount(katMnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	msg := &banktypes.MsgSend{FromAddress: acc.Cosmos, ToAddress: acc.Cosmos}
	raw, err := SignHybridEth(EthSignParams{
		Account:          acc,
		ChainID:          chainID,
		AccountNumber:    7,
		Sequence:         3,
		Messages:         []Message{{TypeURL: "/cosmos.bank.v1beta1.MsgSend", Value: msg}},
		Fee:              Fee{Amount: []Coin{{Denom: "uqor", Amount: "100"}}, Gas: 200000},
		SignBytesVersion: v,
	})
	return acc, raw, err
}

// hybridParts returns the PQC signature, B0 and A of a hybrid TxRaw.
func hybridParts(t *testing.T, raw []byte) (sig, b0, a []byte) {
	t.Helper()
	var txRaw sdktx.TxRaw
	if err := proto.Unmarshal(raw, &txRaw); err != nil {
		t.Fatal(err)
	}
	var body sdktx.TxBody
	if err := proto.Unmarshal(txRaw.BodyBytes, &body); err != nil {
		t.Fatal(err)
	}
	var ext pqcv1.PQCHybridSignature
	if err := ext.Unmarshal(body.ExtensionOptions[0].Value); err != nil {
		t.Fatal(err)
	}
	body.ExtensionOptions = nil
	b0, err := proto.Marshal(&body)
	if err != nil {
		t.Fatal(err)
	}
	return ext.PQCSignature, b0, txRaw.AuthInfoBytes
}

func TestSignHybridEthV2BindsV2Bytes(t *testing.T) {
	acc, raw, err := signHybridEthFor(t, "qorechain-diana", signbytes.V2)
	if err != nil {
		t.Fatal(err)
	}
	sig, b0, a := hybridParts(t, raw)
	if !pqc.PQCVerify(acc.Pqc.PublicKey, signbytes.HybridV2("qorechain-diana", b0, a), sig) {
		t.Fatal("v2 signature does not verify over the v2 bytes")
	}
	if pqc.PQCVerify(acc.Pqc.PublicKey, signbytes.HybridV1(b0, a), sig) {
		t.Fatal("v2 signature must NOT verify over the v1 bytes")
	}
}

func TestSignHybridEthV1SignsV1Bytes(t *testing.T) {
	acc, raw, err := signHybridEthFor(t, "qorechain-vladi", signbytes.V1)
	if err != nil {
		t.Fatal(err)
	}
	sig, b0, a := hybridParts(t, raw)
	if !pqc.PQCVerify(acc.Pqc.PublicKey, signbytes.HybridV1(b0, a), sig) {
		t.Fatal("v1 signature does not verify over the v1 bytes")
	}
	if pqc.PQCVerify(acc.Pqc.PublicKey, signbytes.HybridV2("qorechain-vladi", b0, a), sig) {
		t.Fatal("v1 signature must NOT verify over the v2 bytes")
	}
}

func TestSignHybridEthAutoOffline(t *testing.T) {
	// Non-legacy chain: auto is v2 without any network access.
	acc, raw, err := signHybridEthFor(t, "qorechain-devnet-1", "")
	if err != nil {
		t.Fatal(err)
	}
	sig, b0, a := hybridParts(t, raw)
	if !pqc.PQCVerify(acc.Pqc.PublicKey, signbytes.HybridV2("qorechain-devnet-1", b0, a), sig) {
		t.Fatal("non-legacy auto must sign v2")
	}
	// Legacy chain: auto without a resolved version fails loudly.
	for _, chain := range signbytes.LegacyChains() {
		if _, _, err := signHybridEthFor(t, chain, signbytes.Auto); !errors.Is(err, signbytes.ErrUnresolvedVersion) {
			t.Fatalf("%s auto: err = %v, want ErrUnresolvedVersion", chain, err)
		}
	}
	// Classical signing ignores the version.
	accC, _ := DeriveUnifiedAccount(katMnemonic, 0)
	if _, err := SignClassicalEth(EthSignParams{Account: accC, ChainID: "qorechain-vladi"}); err != nil {
		t.Fatalf("classical: %v", err)
	}
}
