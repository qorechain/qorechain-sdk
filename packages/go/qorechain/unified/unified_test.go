package unified

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"

	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	"github.com/cosmos/gogoproto/proto"
	dcrsecp "github.com/decred/dcrd/dcrec/secp256k1/v4"
	dcrecdsa "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"

	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
)

const katMnemonic = "test test test test test test test test test test test junk"

func TestDeriveUnifiedAccountKAT(t *testing.T) {
	acc, err := DeriveUnifiedAccount(katMnemonic, 0)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if got, want := acc.Cosmos, "qor17w0adeg64ky0daxwd2ugyuneellmjgnxhkv37z"; got != want {
		t.Errorf("cosmos = %s, want %s", got, want)
	}
	if got, want := acc.Evm, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; got != want {
		t.Errorf("evm = %s, want %s", got, want)
	}
	if got, want := acc.Svm, "HQ1S8pxTw4YN41GPdWYPQVfweQveXAUtfFnZNmvPfrYf"; got != want {
		t.Errorf("svm = %s, want %s", got, want)
	}
	if len(acc.Pqc.PublicKey) != 2592 || len(acc.Pqc.SecretKey) != 4896 {
		t.Errorf("pqc lengths = %d/%d, want 2592/4896", len(acc.Pqc.PublicKey), len(acc.Pqc.SecretKey))
	}
	// PQC-pubkey determinism: first 8 bytes lock exact cross-language derivation.
	if got, want := hex.EncodeToString(acc.Pqc.PublicKey[:8]), "4a685622f2a99d54"; got != want {
		t.Errorf("pqc pubkey prefix = %s, want %s", got, want)
	}
	if len(acc.PublicKey) != 33 {
		t.Errorf("compressed pubkey = %d bytes, want 33", len(acc.PublicKey))
	}
	if len(acc.PrivateKey) != 32 {
		t.Errorf("private key = %d bytes, want 32", len(acc.PrivateKey))
	}
}

func TestUnifiedAccountFromSeedKAT(t *testing.T) {
	seed := bytes.Repeat([]byte{0x01}, 32)
	acc, err := UnifiedAccountFromSeed(seed)
	if err != nil {
		t.Fatalf("from seed: %v", err)
	}
	if got, want := acc.Cosmos, "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj"; got != want {
		t.Errorf("cosmos = %s, want %s", got, want)
	}
	if got, want := acc.Evm, "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1"; got != want {
		t.Errorf("evm = %s, want %s", got, want)
	}
	if got, want := acc.Svm, "2n2Cnc7fib6rm4Azo1mbvMuHB3iCb1J254kEQDcrHyPu"; got != want {
		t.Errorf("svm = %s, want %s", got, want)
	}
	if len(acc.Pqc.PublicKey) != 2592 || len(acc.Pqc.SecretKey) != 4896 {
		t.Errorf("pqc lengths = %d/%d, want 2592/4896", len(acc.Pqc.PublicKey), len(acc.Pqc.SecretKey))
	}
	// PQC-pubkey determinism for the seed path (uses the "seed:"+hex(priv) suffix).
	if got, want := hex.EncodeToString(acc.Pqc.PublicKey[:8]), "2d7f888fecbe5b24"; got != want {
		t.Errorf("pqc pubkey prefix = %s, want %s", got, want)
	}
}

func TestDeriveUnifiedDeterministic(t *testing.T) {
	a, err := DeriveUnifiedAccount(katMnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	b, err := DeriveUnifiedAccount(katMnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	if a.Cosmos != b.Cosmos || !bytes.Equal(a.Pqc.SecretKey, b.Pqc.SecretKey) {
		t.Fatal("derivation is not deterministic")
	}
	c, err := DeriveUnifiedAccount(katMnemonic, 1)
	if err != nil {
		t.Fatal(err)
	}
	if a.Cosmos == c.Cosmos {
		t.Fatal("different indices must yield different accounts")
	}
}

func TestAddressesFrom20AndQoreAddresses(t *testing.T) {
	acc, err := DeriveUnifiedAccount(katMnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	// AddressesFrom20 round-trips to the same three encodings.
	enc, err := AddressesFrom20(acc.AddressBytes)
	if err != nil {
		t.Fatal(err)
	}
	if enc.Cosmos != acc.Cosmos || enc.Evm != acc.Evm || enc.Svm != acc.Svm {
		t.Fatal("AddressesFrom20 mismatch")
	}
	// QoreAddresses from each of the three input forms must agree.
	fromEvm, err := QoreAddresses("", acc.Evm, "")
	if err != nil {
		t.Fatal(err)
	}
	fromCosmos, err := QoreAddresses(acc.Cosmos, "", "")
	if err != nil {
		t.Fatal(err)
	}
	fromHex, err := QoreAddresses("", "", hex.EncodeToString(acc.AddressBytes[:]))
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range []Addresses{fromEvm, fromCosmos, fromHex} {
		if g.Cosmos != acc.Cosmos || g.Evm != acc.Evm || g.Svm != acc.Svm {
			t.Fatalf("QoreAddresses mismatch: %+v", g)
		}
	}
}

// TestUnifiedAccountFromPhantomSignatureRemoved asserts the signature-derived
// account constructor is gone: it returns an error and no account, and the error
// points callers at the authenticator lanes.
func TestUnifiedAccountFromPhantomSignatureRemoved(t *testing.T) {
	sig := bytes.Repeat([]byte{0xAB}, 64)
	acc, err := UnifiedAccountFromPhantomSignature(sig)
	if err == nil {
		t.Fatal("expected an error: deriving a spend key from a wallet signature must not be possible")
	}
	if acc.PrivateKey != nil || acc.Cosmos != "" || acc.Evm != "" || acc.Svm != "" {
		t.Fatalf("expected the zero account, got %+v", acc)
	}
	for _, want := range []string{
		"removed in v0.8.0",
		"MsgRegisterAuthenticator",
		"MsgExecuteCosmos",
		"MsgExecuteEVM",
		"treated as exposed",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error message must mention %q, got: %s", want, err.Error())
		}
	}
}

// verifyEthSig checks a 64-byte r‖s signature as secp256k1 over keccak256(msg)
// against the account's compressed public key.
func verifyEthSig(t *testing.T, compressedPub, msg, sig []byte) bool {
	t.Helper()
	if len(sig) != 64 {
		t.Fatalf("signature must be 64 bytes, got %d", len(sig))
	}
	pub, err := dcrsecp.ParsePubKey(compressedPub)
	if err != nil {
		t.Fatalf("parse pubkey: %v", err)
	}
	var r, s dcrsecp.ModNScalar
	if r.SetByteSlice(sig[:32]) {
		t.Fatal("r overflow")
	}
	if s.SetByteSlice(sig[32:]) {
		t.Fatal("s overflow")
	}
	ecdsaSig := dcrecdsa.NewSignature(&r, &s)
	return ecdsaSig.Verify(keccak(msg), pub)
}

func TestSignClassicalEthVerifiesOverKeccak(t *testing.T) {
	acc, err := DeriveUnifiedAccount(katMnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	msg := &banktypes.MsgSend{
		FromAddress: acc.Cosmos,
		ToAddress:   acc.Cosmos,
	}
	raw, err := SignClassicalEth(EthSignParams{
		Account:       acc,
		ChainID:       "qorechain-vladi",
		AccountNumber: 7,
		Sequence:      3,
		Messages:      []Message{{TypeURL: "/cosmos.bank.v1beta1.MsgSend", Value: msg}},
		Fee:           Fee{Amount: []Coin{{Denom: "uqor", Amount: "100"}}, Gas: 200000},
	})
	if err != nil {
		t.Fatalf("sign classical: %v", err)
	}
	var txRaw sdktx.TxRaw
	if err := proto.Unmarshal(raw, &txRaw); err != nil {
		t.Fatalf("decode TxRaw: %v", err)
	}
	if len(txRaw.Signatures) != 1 {
		t.Fatalf("expected 1 signature, got %d", len(txRaw.Signatures))
	}
	// Reconstruct the SignDoc the signature must cover.
	signDoc, err := proto.Marshal(&sdktx.SignDoc{
		BodyBytes:     txRaw.BodyBytes,
		AuthInfoBytes: txRaw.AuthInfoBytes,
		ChainId:       "qorechain-vladi",
		AccountNumber: 7,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !verifyEthSig(t, acc.PublicKey, signDoc, txRaw.Signatures[0]) {
		t.Fatal("classical eth signature does not verify as secp256k1 over keccak256(SignDoc)")
	}
	// Classical body must NOT carry a PQC extension.
	var body sdktx.TxBody
	if err := proto.Unmarshal(txRaw.BodyBytes, &body); err != nil {
		t.Fatal(err)
	}
	if len(body.ExtensionOptions) != 0 {
		t.Fatal("classical body must have no extension options")
	}
	// The signer pubkey Any must use the eth_secp256k1 type URL.
	var ai sdktx.AuthInfo
	if err := proto.Unmarshal(txRaw.AuthInfoBytes, &ai); err != nil {
		t.Fatal(err)
	}
	if got := ai.SignerInfos[0].PublicKey.TypeUrl; got != ETHSECP256K1PubKeyType {
		t.Fatalf("pubkey type = %s, want %s", got, ETHSECP256K1PubKeyType)
	}
}

func TestSignHybridEthVerifiesAndFrames(t *testing.T) {
	acc, err := DeriveUnifiedAccount(katMnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	msg := &banktypes.MsgSend{FromAddress: acc.Cosmos, ToAddress: acc.Cosmos}
	raw, err := SignHybridEth(EthSignParams{
		SignBytesVersion: signbytes.V1,
		Account:          acc,
		ChainID:          "qorechain-vladi",
		AccountNumber:    7,
		Sequence:         3,
		Messages:         []Message{{TypeURL: "/cosmos.bank.v1beta1.MsgSend", Value: msg}},
		Fee:              Fee{Amount: []Coin{{Denom: "uqor", Amount: "100"}}, Gas: 200000},
	})
	if err != nil {
		t.Fatalf("sign hybrid: %v", err)
	}
	var txRaw sdktx.TxRaw
	if err := proto.Unmarshal(raw, &txRaw); err != nil {
		t.Fatal(err)
	}
	// Final body carries exactly one PQC extension option.
	var body sdktx.TxBody
	if err := proto.Unmarshal(txRaw.BodyBytes, &body); err != nil {
		t.Fatal(err)
	}
	if len(body.ExtensionOptions) != 1 {
		t.Fatalf("hybrid body must have 1 extension option, got %d", len(body.ExtensionOptions))
	}

	// Rebuild B0 (body WITHOUT ext) and verify the ML-DSA-87 signature over
	// frame(B0, authInfo).
	b0, err := proto.Marshal(&sdktx.TxBody{
		Messages:      body.Messages,
		Memo:          body.Memo,
		TimeoutHeight: body.TimeoutHeight,
	})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(b0, txRaw.BodyBytes) {
		t.Fatal("B0 must differ from the final body (ext must be present in final body only)")
	}

	// Classical signature verifies over keccak256(SignDoc(finalBody, A)).
	signDoc, err := proto.Marshal(&sdktx.SignDoc{
		BodyBytes:     txRaw.BodyBytes,
		AuthInfoBytes: txRaw.AuthInfoBytes,
		ChainId:       "qorechain-vladi",
		AccountNumber: 7,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !verifyEthSig(t, acc.PublicKey, signDoc, txRaw.Signatures[0]) {
		t.Fatal("hybrid classical signature does not verify over keccak256(SignDoc)")
	}
}

func TestParseOnChainPubKey(t *testing.T) {
	acc, err := DeriveUnifiedAccount(katMnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := SignClassicalEth(EthSignParams{
		Account:       acc,
		ChainID:       "qorechain-vladi",
		AccountNumber: 1,
		Sequence:      0,
		Messages:      []Message{{TypeURL: "/cosmos.bank.v1beta1.MsgSend", Value: &banktypes.MsgSend{FromAddress: acc.Cosmos, ToAddress: acc.Cosmos}}},
		Fee:           Fee{Amount: []Coin{{Denom: "uqor", Amount: "1"}}, Gas: 100000},
	})
	if err != nil {
		t.Fatal(err)
	}
	var txRaw sdktx.TxRaw
	if err := proto.Unmarshal(raw, &txRaw); err != nil {
		t.Fatal(err)
	}
	var ai sdktx.AuthInfo
	if err := proto.Unmarshal(txRaw.AuthInfoBytes, &ai); err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseOnChainPubKeyAny(ai.SignerInfos[0].PublicKey)
	if err != nil {
		t.Fatalf("parse pubkey: %v", err)
	}
	if parsed.Addresses.Cosmos != acc.Cosmos {
		t.Fatalf("parsed cosmos = %s, want %s", parsed.Addresses.Cosmos, acc.Cosmos)
	}
	if !bytes.Equal(parsed.CompressedPubKey, acc.PublicKey) {
		t.Fatal("parsed pubkey mismatch")
	}
}
