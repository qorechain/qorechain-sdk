// Package tx builds, signs, and broadcasts native QoreChain transactions,
// including hybrid (classical + post-quantum) signing.
//
// A native transaction carries a classical secp256k1 signature in
// TxRaw.Signatures. A hybrid transaction additionally attaches an ML-DSA-87
// (Dilithium-5) signature to the TxBody as a PQCHybridSignature extension. The
// chain's ante handler verifies BOTH, so a hybrid account stays interoperable
// with classical verification while gaining quantum safety.
//
// ───────────────────────────────────────────────────────────────────────────
//
//	The wallet ↔ chain hybrid contract (enforced by the chain; matches the TS SDK)
//
// ───────────────────────────────────────────────────────────────────────────
// The chain verifies the ML-DSA-87 signature over the tx body WITH the PQC
// extension REMOVED:
//
//   - B0 = protobuf bytes of the TxBody containing the messages/memo/timeout but
//     NOT the PQCHybridSignature extension.
//   - A  = the AuthInfo bytes (signer secp256k1 pubkey, SIGN_MODE_DIRECT,
//     sequence, fee) — the exact bytes that are broadcast.
//   - PQC signed message = BE32(len(B0)) || B0 || BE32(len(A)) || A (4-byte
//     big-endian length prefixes; NO hashing, NO domain prefix).
//   - PQC signature = PQCSign(pqcSecret, message) — pure ML-DSA-87, 4627 bytes.
//   - The PQCHybridSignature extension is then added to TxBody.ExtensionOptions
//     (the CRITICAL extension-options slot) as an Any whose TypeUrl is
//     "/qorechain.pqc.v1.PQCHybridSignature" and whose Value is the UTF-8 bytes
//     of the Go-JSON {"algorithm_id","pqc_signature","pqc_public_key"?}
//     (standard padded base64; pqc_public_key omitted when not supplied) → the
//     final body bytes.
//   - The CLASSICAL secp256k1 SIGN_MODE_DIRECT signature is computed over
//     SignDoc(finalBody, A, chainID, accountNumber) and goes in TxRaw.Signatures
//     (outside the body). The classical signature never signs itself.
//
// The signer's PQC key must be registered on-chain (via MsgRegisterPQCKey)
// before hybrid txs PQC-verify — unless IncludePQCPublicKey is set, which embeds
// the key for auto-registration on first use. Registering the key is the
// caller's responsibility.
//
// Determinism note (same caveat as the TS SDK): the BE32 framing is
// byte-for-byte deterministic on the wallet side. Cross-implementation
// determinism (this gogoproto encoding vs. the chain's re-marshal of the same
// TxBody) is confirmed for the default bank message types; callers using custom
// message types with non-canonical field ordering must ensure their encoding is
// canonical.
package tx

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"cosmossdk.io/math"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdktypes "github.com/cosmos/cosmos-sdk/types"
	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	signingtypes "github.com/cosmos/cosmos-sdk/types/tx/signing"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	"github.com/cosmos/gogoproto/proto"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
)

// MsgSendTypeURL is the /cosmos.bank.v1beta1.MsgSend type URL.
const MsgSendTypeURL = "/cosmos.bank.v1beta1.MsgSend"

// BroadcastMode selects the REST /cosmos/tx/v1beta1/txs broadcast behavior.
type BroadcastMode string

// Broadcast modes for the REST txs endpoint.
const (
	BroadcastSync  BroadcastMode = "sync"
	BroadcastAsync BroadcastMode = "async"
	BroadcastBlock BroadcastMode = "block"
)

var broadcastModeMap = map[BroadcastMode]string{
	BroadcastSync:  "BROADCAST_MODE_SYNC",
	BroadcastAsync: "BROADCAST_MODE_ASYNC",
	BroadcastBlock: "BROADCAST_MODE_BLOCK",
}

// Coin is a Cosmos coin amount (denom + integer base amount as a string).
type Coin struct {
	Denom  string
	Amount string
}

// Fee is the transaction fee: a coin amount plus a gas limit (as a string).
type Fee struct {
	// Amount is the coins paid as a fee (e.g. uqor).
	Amount []Coin
	// Gas is the gas limit, as a decimal string (e.g. "200000").
	Gas string
	// Granter optionally pays the fee via a fee grant.
	Granter string
	// Payer optionally identifies the fee payer.
	Payer string
}

// Message is a transaction message to encode into the TxBody: a type URL plus a
// gogoproto message value.
type Message struct {
	TypeURL string
	Value   proto.Message
}

// BuiltTx is a built, signed transaction plus the intermediate artifacts.
//
// For a plain BankSend the PQC fields are empty; for BuildHybridTx they expose
// the exact bytes signed by ML-DSA-87 so the contract can be asserted/audited.
type BuiltTx struct {
	// TxRaw is the assembled transaction (final body + authInfo + classical sig).
	TxRaw *sdktx.TxRaw
	// TxRawBytes is the encoded TxRaw, ready to broadcast.
	TxRawBytes []byte
	// AuthInfoBytes is A — identical in the PQC framing and the SignDoc.
	AuthInfoBytes []byte
	// PQCSignedMessage is the exact bytes the ML-DSA-87 signature covered (nil
	// for a non-hybrid tx).
	PQCSignedMessage []byte
	// PQCSignature is the raw ML-DSA-87 signature (Dilithium-5: 4627 bytes; nil
	// for a non-hybrid tx).
	PQCSignature []byte
}

// feeEstimateResponse mirrors the AI fee-oracle REST response. suggested_fee_uqor
// is a uint64 that proto3 JSON encodes as a string; a number is tolerated too.
type feeEstimateResponse struct {
	SuggestedFeeUqor json.RawMessage `json:"suggested_fee_uqor"`
}

// FeeFromEstimate converts a RestClient fee-estimate JSON body into a Fee.
//
// The estimate provides only the suggested fee amount (in uqor); the gas limit
// is chosen by the caller. If the response has no usable suggested fee, an error
// is returned so callers can fall back to a static fee.
func FeeFromEstimate(estimate json.RawMessage, gas string) (Fee, error) {
	var resp feeEstimateResponse
	if err := json.Unmarshal(estimate, &resp); err != nil {
		return Fee{}, fmt.Errorf("parse fee estimate: %w", err)
	}
	if len(resp.SuggestedFeeUqor) == 0 {
		return Fee{}, fmt.Errorf("fee estimate has no suggested_fee_uqor")
	}
	// Accept either a JSON string ("1234") or a JSON number (1234).
	amount := strings.Trim(string(resp.SuggestedFeeUqor), `"`)
	if amount == "" || amount == "0" || amount == "null" {
		return Fee{}, fmt.Errorf("fee estimate suggested_fee_uqor is empty/zero")
	}
	// Normalize a float-encoded number (e.g. "4200") by stripping a trailing
	// fractional part the oracle should never emit; keep it simple and reject
	// non-integers.
	if strings.ContainsAny(amount, ".eE") {
		return Fee{}, fmt.Errorf("fee estimate suggested_fee_uqor is not an integer: %s", amount)
	}
	return Fee{
		Amount: []Coin{{Denom: "uqor", Amount: amount}},
		Gas:    gas,
	}, nil
}

// BankSendParams are the inputs to BankSend.
type BankSendParams struct {
	// Account is the native secp256k1 signer (from accounts.DeriveNativeAccount).
	Account accounts.Secp256k1Account
	// ToAddress is the bech32 recipient address.
	ToAddress string
	// Amount is the coins to send.
	Amount []Coin
	// ChainID is the chain id (e.g. "qorechain-diana").
	ChainID string
	// AccountNumber is the signer's on-chain account number.
	AccountNumber uint64
	// Sequence is the signer's current account sequence (nonce).
	Sequence uint64
	// Fee is the fee to pay.
	Fee Fee
	// Memo is an optional tx memo.
	Memo string
	// TimeoutHeight is an optional tx timeout height (0 = none).
	TimeoutHeight uint64
}

// BankSend builds and signs a bank MsgSend into a broadcast-ready TxRaw.
//
// It constructs /cosmos.bank.v1beta1.MsgSend from the account address to
// ToAddress, builds the SIGN_MODE_DIRECT AuthInfo from the account's compressed
// secp256k1 pubkey, signs the SignDoc, and assembles the TxRaw. This does not
// broadcast — pass BuiltTx.TxRawBytes to Broadcast.
func BankSend(params BankSendParams) (*BuiltTx, error) {
	amount, err := toCoins(params.Amount)
	if err != nil {
		return nil, err
	}
	msg := &banktypes.MsgSend{
		FromAddress: params.Account.Address,
		ToAddress:   params.ToAddress,
		Amount:      amount,
	}
	msgAny, err := codectypes.NewAnyWithValue(msg)
	if err != nil {
		return nil, fmt.Errorf("pack MsgSend: %w", err)
	}
	body := &sdktx.TxBody{
		Messages:      []*codectypes.Any{msgAny},
		Memo:          params.Memo,
		TimeoutHeight: params.TimeoutHeight,
	}
	bodyBytes, err := proto.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal TxBody: %w", err)
	}
	authInfoBytes, err := buildAuthInfoBytes(params.Account.PublicKey, params.Sequence, params.Fee)
	if err != nil {
		return nil, err
	}
	sig, err := signDirect(params.Account.PrivateKey, bodyBytes, authInfoBytes, params.ChainID, params.AccountNumber)
	if err != nil {
		return nil, err
	}
	txRaw := &sdktx.TxRaw{
		BodyBytes:     bodyBytes,
		AuthInfoBytes: authInfoBytes,
		Signatures:    [][]byte{sig},
	}
	txRawBytes, err := proto.Marshal(txRaw)
	if err != nil {
		return nil, fmt.Errorf("marshal TxRaw: %w", err)
	}
	return &BuiltTx{
		TxRaw:         txRaw,
		TxRawBytes:    txRawBytes,
		AuthInfoBytes: authInfoBytes,
	}, nil
}

// BuildHybridTxParams are the inputs to BuildHybridTx.
type BuildHybridTxParams struct {
	// Account is the native secp256k1 signer (classical half).
	Account accounts.Secp256k1Account
	// PQCKeypair is the ML-DSA-87 (Dilithium-5) keypair (post-quantum half).
	PQCKeypair pqc.Keypair
	// Messages are the tx messages as {TypeURL, Value} pairs.
	Messages []Message
	// Fee is the fee to pay.
	Fee Fee
	// ChainID is the chain id.
	ChainID string
	// AccountNumber is the signer's on-chain account number.
	AccountNumber uint64
	// Sequence is the signer's current account sequence.
	Sequence uint64
	// Memo is an optional tx memo.
	Memo string
	// TimeoutHeight is an optional tx timeout height (0 = none).
	TimeoutHeight uint64
	// IncludePQCPublicKey embeds the 2592-byte ML-DSA-87 public key in the
	// extension for auto-registration on first use. Defaults to false (the key
	// is expected to be registered already via MsgRegisterPQCKey).
	IncludePQCPublicKey bool
}

// BuildHybridTx builds a fully signed hybrid (classical + PQC) transaction
// following the chain contract documented in the package header.
//
// The build sequence:
//  1. Encode B0 — the TxBody WITHOUT the PQC extension.
//  2. Encode A  — the single-signer SIGN_MODE_DIRECT AuthInfo.
//  3. message = BE32(len B0) || B0 || BE32(len A) || A; ML-DSA-87 sign it.
//  4. Build the PQCHybridSignature extension Any and attach it to a new body
//     identical to step 1 but with ExtensionOptions = [ext] → final body bytes.
//  5. Classical SIGN_MODE_DIRECT signature over SignDoc(finalBody, A, chainID,
//     accountNumber).
//  6. Assemble TxRaw(finalBody, A, [classicalSig]).
//
// The returned BuiltTx exposes PQCSignedMessage and PQCSignature so the contract
// can be asserted/audited.
func BuildHybridTx(params BuildHybridTxParams) (*BuiltTx, error) {
	encoded, err := encodeMessages(params.Messages)
	if err != nil {
		return nil, err
	}

	// 1. B0 — body WITHOUT the PQC extension.
	baseBody := &sdktx.TxBody{
		Messages:      encoded,
		Memo:          params.Memo,
		TimeoutHeight: params.TimeoutHeight,
	}
	b0, err := proto.Marshal(baseBody)
	if err != nil {
		return nil, fmt.Errorf("marshal base TxBody: %w", err)
	}

	// 2. A — single-signer AuthInfo (SIGN_MODE_DIRECT).
	authInfoBytes, err := buildAuthInfoBytes(params.Account.PublicKey, params.Sequence, params.Fee)
	if err != nil {
		return nil, err
	}

	// 3. PQC framing + ML-DSA-87 signature over B0 + A (NOT the final body).
	pqcSignedMessage := frameSignBytes(b0, authInfoBytes)
	pqcSignature, err := pqc.PQCSign(params.PQCKeypair.SecretKey, pqcSignedMessage)
	if err != nil {
		return nil, fmt.Errorf("PQC sign: %w", err)
	}

	// 4. Build the PQC extension Any (Go-JSON value) and attach it to the FINAL
	//    body as a CRITICAL extension option.
	var publicKey []byte
	if params.IncludePQCPublicKey {
		publicKey = params.PQCKeypair.PublicKey
	}
	ext, err := pqc.BuildHybridSignatureExtension(pqc.AlgorithmDilithium5, pqcSignature, publicKey)
	if err != nil {
		return nil, fmt.Errorf("build hybrid extension: %w", err)
	}
	extValue, err := json.Marshal(ext)
	if err != nil {
		return nil, fmt.Errorf("marshal hybrid extension JSON: %w", err)
	}
	extAny := &codectypes.Any{TypeUrl: pqc.HybridSigTypeURL, Value: extValue}
	finalBody := &sdktx.TxBody{
		Messages:         encoded,
		Memo:             params.Memo,
		TimeoutHeight:    params.TimeoutHeight,
		ExtensionOptions: []*codectypes.Any{extAny},
	}
	bodyBytesFinal, err := proto.Marshal(finalBody)
	if err != nil {
		return nil, fmt.Errorf("marshal final TxBody: %w", err)
	}

	// 5. Classical SIGN_MODE_DIRECT signature over the FINAL body + A.
	classicalSig, err := signDirect(params.Account.PrivateKey, bodyBytesFinal, authInfoBytes, params.ChainID, params.AccountNumber)
	if err != nil {
		return nil, err
	}

	// 6. Assemble TxRaw.
	txRaw := &sdktx.TxRaw{
		BodyBytes:     bodyBytesFinal,
		AuthInfoBytes: authInfoBytes,
		Signatures:    [][]byte{classicalSig},
	}
	txRawBytes, err := proto.Marshal(txRaw)
	if err != nil {
		return nil, fmt.Errorf("marshal TxRaw: %w", err)
	}

	return &BuiltTx{
		TxRaw:            txRaw,
		TxRawBytes:       txRawBytes,
		AuthInfoBytes:    authInfoBytes,
		PQCSignedMessage: pqcSignedMessage,
		PQCSignature:     pqcSignature,
	}, nil
}

// Broadcast POSTs signed TxRaw bytes to the REST /cosmos/tx/v1beta1/txs endpoint.
//
// It sends {"tx_bytes": <base64>, "mode": "BROADCAST_MODE_*"} and returns the
// raw JSON response. Broadcasting requires a live node; unit tests mock this
// POST. If httpClient is nil, http.DefaultClient is used.
func Broadcast(restURL string, txBytes []byte, mode BroadcastMode, httpClient *http.Client) (json.RawMessage, error) {
	protoMode, ok := broadcastModeMap[mode]
	if !ok {
		return nil, fmt.Errorf("unknown broadcast mode: %q", mode)
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	payload, err := json.Marshal(map[string]string{
		"tx_bytes": base64.StdEncoding.EncodeToString(txBytes),
		"mode":     protoMode,
	})
	if err != nil {
		return nil, err
	}
	u := strings.TrimRight(restURL, "/") + "/cosmos/tx/v1beta1/txs"
	req, err := http.NewRequest(http.MethodPost, u, strings.NewReader(string(payload)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("broadcast HTTP %d for %s: %s", resp.StatusCode, u, string(body))
	}
	return json.RawMessage(body), nil
}

// --- internal helpers ---

func frameSignBytes(b0, a []byte) []byte {
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

func toCoins(coins []Coin) (sdktypes.Coins, error) {
	out := make(sdktypes.Coins, 0, len(coins))
	for _, c := range coins {
		amt, ok := math.NewIntFromString(c.Amount)
		if !ok {
			return nil, fmt.Errorf("invalid coin amount: %q", c.Amount)
		}
		out = append(out, sdktypes.Coin{Denom: c.Denom, Amount: amt})
	}
	return out, nil
}

func feeToProto(fee Fee) (*sdktx.Fee, error) {
	amount, err := toCoins(fee.Amount)
	if err != nil {
		return nil, err
	}
	var gas uint64
	if fee.Gas != "" {
		g, ok := math.NewIntFromString(fee.Gas)
		if !ok {
			return nil, fmt.Errorf("invalid gas: %q", fee.Gas)
		}
		gas = g.Uint64()
	}
	return &sdktx.Fee{
		Amount:   amount,
		GasLimit: gas,
		Granter:  fee.Granter,
		Payer:    fee.Payer,
	}, nil
}

func buildAuthInfoBytes(compressedPubKey []byte, sequence uint64, fee Fee) ([]byte, error) {
	pubAny, err := codectypes.NewAnyWithValue(&secp256k1.PubKey{Key: compressedPubKey})
	if err != nil {
		return nil, fmt.Errorf("pack pubkey: %w", err)
	}
	feeProto, err := feeToProto(fee)
	if err != nil {
		return nil, err
	}
	authInfo := &sdktx.AuthInfo{
		SignerInfos: []*sdktx.SignerInfo{{
			PublicKey: pubAny,
			ModeInfo: &sdktx.ModeInfo{
				Sum: &sdktx.ModeInfo_Single_{
					Single: &sdktx.ModeInfo_Single{Mode: signingtypes.SignMode_SIGN_MODE_DIRECT},
				},
			},
			Sequence: sequence,
		}},
		Fee: feeProto,
	}
	authInfoBytes, err := proto.Marshal(authInfo)
	if err != nil {
		return nil, fmt.Errorf("marshal AuthInfo: %w", err)
	}
	return authInfoBytes, nil
}

func encodeMessages(messages []Message) ([]*codectypes.Any, error) {
	out := make([]*codectypes.Any, 0, len(messages))
	for _, m := range messages {
		raw, err := proto.Marshal(m.Value)
		if err != nil {
			return nil, fmt.Errorf("marshal message %s: %w", m.TypeURL, err)
		}
		out = append(out, &codectypes.Any{TypeUrl: m.TypeURL, Value: raw})
	}
	return out, nil
}

// signDirect produces a canonical 64-byte secp256k1 SIGN_MODE_DIRECT signature
// over the serialized SignDoc.
func signDirect(privKey, bodyBytes, authInfoBytes []byte, chainID string, accountNumber uint64) ([]byte, error) {
	signDoc := &sdktx.SignDoc{
		BodyBytes:     bodyBytes,
		AuthInfoBytes: authInfoBytes,
		ChainId:       chainID,
		AccountNumber: accountNumber,
	}
	signBytes, err := proto.Marshal(signDoc)
	if err != nil {
		return nil, fmt.Errorf("marshal SignDoc: %w", err)
	}
	priv := &secp256k1.PrivKey{Key: privKey}
	sig, err := priv.Sign(signBytes)
	if err != nil {
		return nil, fmt.Errorf("secp256k1 sign: %w", err)
	}
	return sig, nil
}
