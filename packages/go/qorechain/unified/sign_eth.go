package unified

// Eth-native (eth_secp256k1) native-lane signing.
//
// A QoreChain account created eth-native (address = keccak(pubkey)[12:]) signs
// native-lane txs with the eth_secp256k1 scheme: the classical signature is
// secp256k1 over the KECCAK-256 of the SignDoc (NOT sha256), and the account's
// pubkey Any uses the typeUrl ETHSECP256K1PubKeyType with the STANDARD
// secp256k1 PubKey proto value (wire shape {1: bytes key}, only the typeUrl
// differs). This is the same account that spends on the EVM lane, so its
// qor1/0x/svm forms are one identity.
//
// Mainnet requires the ML-DSA-87 hybrid extension in the tx body; SignHybridEth
// adds it. SignClassicalEth omits it (used for the one-time PQC key
// registration, which is bootstrap-exempt from the hybrid requirement).
//
// The hybrid sign-bytes (package signbytes: v1 = BE32(len B0)||B0||BE32(len A)||A,
// v2 = "qorechain-pqc-hybrid-v2"||BE64(len chainID)||chainID||v1-body, chosen
// per network) and the protobuf-encoded PQCHybridSignature extension Any are
// IDENTICAL to the native-derivation hybrid tx in the tx package; only the
// classical hash (keccak vs sha256) and the pubkey typeUrl change here.

import (
	"errors"
	"fmt"

	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdktx "github.com/cosmos/cosmos-sdk/types/tx"
	signingtypes "github.com/cosmos/cosmos-sdk/types/tx/signing"
	"github.com/cosmos/gogoproto/proto"
	dcrsecp "github.com/decred/dcrd/dcrec/secp256k1/v4"
	dcrecdsa "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
)

// ETHSECP256K1PubKeyType is the cosmos/evm eth_secp256k1 pubkey type URL. Its
// wire shape is identical to the cosmos secp256k1 PubKey ({1: bytes key}); only
// the typeUrl differs.
const ETHSECP256K1PubKeyType = "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey"

// Coin is a native-lane coin amount (denom + integer base amount as a string).
type Coin struct {
	Denom  string
	Amount string
}

// Fee is the transaction fee: coin amounts, a gas limit, and optional
// payer/granter.
type Fee struct {
	Amount  []Coin
	Gas     uint64
	Granter string
	Payer   string
}

// Message is a transaction message: a type URL plus a gogoproto message value.
type Message struct {
	TypeURL string
	Value   proto.Message
}

// EthSignParams are the inputs to SignClassicalEth / SignHybridEth.
type EthSignParams struct {
	// Account is the unified eth-native signer (from DeriveUnifiedAccount).
	Account UnifiedAccount
	// ChainID is the chain id (e.g. "qorechain-vladi").
	ChainID string
	// AccountNumber is the signer's on-chain account number.
	AccountNumber uint64
	// Sequence is the signer's current account sequence (nonce).
	Sequence uint64
	// Messages are the tx messages as {TypeURL, Value} pairs.
	Messages []Message
	// Fee is the fee to pay.
	Fee Fee
	// Memo is an optional tx memo.
	Memo string
	// TimeoutHeight is an optional tx timeout height (0 = none).
	TimeoutHeight uint64
	// SignBytesVersion is the hybrid sign-bytes form SignHybridEth signs (see
	// package signbytes). signbytes.V1 / signbytes.V2 are used as given. Empty
	// or signbytes.Auto is decided from ChainID alone: a non-legacy chain is
	// V2, while a legacy network (qorechain-vladi, qorechain-diana) makes
	// SignHybridEth FAIL, because its form depends on whether one of the
	// signbytes.V2Upgrades plans is applied there; resolve it first with a signbytes.Resolver.
	// Ignored by SignClassicalEth.
	SignBytesVersion signbytes.Version
}

// SignClassicalEth builds a classical-only eth_secp256k1 native tx (no PQC
// extension). Use for the one-time MsgRegisterPQCKey (bootstrap-exempt).
//
// Returns the broadcast-ready TxRaw bytes.
func SignClassicalEth(params EthSignParams) ([]byte, error) {
	authInfoBytes, err := buildEthAuthInfoBytes(params.Account.PublicKey, params.Sequence, params.Fee)
	if err != nil {
		return nil, err
	}
	encoded, err := encodeMessages(params.Messages)
	if err != nil {
		return nil, err
	}
	bodyBytes, err := proto.Marshal(&sdktx.TxBody{
		Messages:      encoded,
		Memo:          params.Memo,
		TimeoutHeight: params.TimeoutHeight,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal TxBody: %w", err)
	}
	sig, err := ethSignDirect(params.Account.PrivateKey, bodyBytes, authInfoBytes, params.ChainID, params.AccountNumber)
	if err != nil {
		return nil, err
	}
	return marshalTxRaw(bodyBytes, authInfoBytes, sig)
}

// SignHybridEth builds a hybrid eth_secp256k1 + ML-DSA-87 native tx.
//
// Sequence:
//  1. B0 — body WITHOUT the PQC extension.
//  2. A  — single-signer eth_secp256k1 SIGN_MODE_DIRECT AuthInfo.
//  3. ML-DSA-87 sign over signbytes.Hybrid(version, ChainID, B0, A) — v1 or
//     v2 per SignBytesVersion (see EthSignParams).
//  4. Attach the protobuf-encoded PQCHybridSignature extension Any → final body.
//  5. Classical eth_secp256k1 signature over SignDoc(finalBody, A, …) — secp256k1
//     of keccak256(SignDoc).
//  6. Assemble TxRaw(finalBody, A, [classicalSig]).
//
// Returns the broadcast-ready TxRaw bytes.
func SignHybridEth(params EthSignParams) ([]byte, error) {
	version, err := signbytes.ResolveOffline(params.ChainID, params.SignBytesVersion)
	if err != nil {
		return nil, fmt.Errorf("SignHybridEth: %w", err)
	}
	authInfoBytes, err := buildEthAuthInfoBytes(params.Account.PublicKey, params.Sequence, params.Fee)
	if err != nil {
		return nil, err
	}
	encoded, err := encodeMessages(params.Messages)
	if err != nil {
		return nil, err
	}
	// 1. B0 — body without the PQC extension.
	b0, err := proto.Marshal(&sdktx.TxBody{
		Messages:      encoded,
		Memo:          params.Memo,
		TimeoutHeight: params.TimeoutHeight,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal base TxBody: %w", err)
	}
	// 3. ML-DSA-87 over the hybrid sign-bytes of the resolved version.
	msg, err := signbytes.Hybrid(version, params.ChainID, b0, authInfoBytes)
	if err != nil {
		return nil, err
	}
	pqcSig, err := pqc.PQCSign(params.Account.Pqc.SecretKey, msg)
	if err != nil {
		return nil, fmt.Errorf("PQC sign: %w", err)
	}
	// 4. Build the extension Any (protobuf-encoded PQCHybridSignature value) and
	//    attach to the final body.
	extValue, err := pqc.EncodeHybridSignatureExtension(pqc.AlgorithmDilithium5, pqcSig, nil)
	if err != nil {
		return nil, fmt.Errorf("build hybrid extension: %w", err)
	}
	extAny := &codectypes.Any{TypeUrl: pqc.HybridSigTypeURL, Value: extValue}
	bodyWithExt, err := proto.Marshal(&sdktx.TxBody{
		Messages:         encoded,
		Memo:             params.Memo,
		TimeoutHeight:    params.TimeoutHeight,
		ExtensionOptions: []*codectypes.Any{extAny},
	})
	if err != nil {
		return nil, fmt.Errorf("marshal final TxBody: %w", err)
	}
	// 5. Classical eth_secp256k1 signature over the final body + A.
	sig, err := ethSignDirect(params.Account.PrivateKey, bodyWithExt, authInfoBytes, params.ChainID, params.AccountNumber)
	if err != nil {
		return nil, err
	}
	return marshalTxRaw(bodyWithExt, authInfoBytes, sig)
}

// UnifiedAccountFromPhantomSignature is REMOVED as of v0.8.0 and always returns
// an error; it derives no account.
//
// It used to turn an external wallet's signature into the account's spend key.
// That is not a key-derivation input: the signature is a bearer secret the
// wallet hands to any page that asks for it, so anyone who obtains it controls
// the account.
//
// Replacement: keep the external wallet key external. Register it with
// MsgRegisterAuthenticator and spend from the canonical PQC account through
// MsgExecuteCosmos / MsgExecuteEVM (see the authenticator package), where the
// chain enforces the permission set and the SpendingRule.
//
// Deprecated: removed in v0.8.0; always returns an error. Use the authenticator
// lanes instead.
func UnifiedAccountFromPhantomSignature(_ []byte) (UnifiedAccount, error) {
	return UnifiedAccount{}, errors.New(removedPhantomDerivationMsg)
}

// removedPhantomDerivationMsg is the error returned by the removed
// signature-derived account constructor.
const removedPhantomDerivationMsg = "UnifiedAccountFromPhantomSignature was removed in v0.8.0: " +
	"deriving a spend key from a wallet signature is unsafe — the signature is a bearer secret that any page " +
	"can request from the wallet, so whoever obtains it controls the account. Use the authenticator lanes " +
	"instead: register the external key with MsgRegisterAuthenticator and spend via MsgExecuteCosmos / " +
	"MsgExecuteEVM. Any account previously derived this way must be treated as exposed — move its funds."

// --- internal helpers ---

// buildEthAuthInfoBytes encodes a single-signer eth_secp256k1 SIGN_MODE_DIRECT
// AuthInfo. The pubkey Any uses ETHSECP256K1PubKeyType with the standard
// secp256k1 PubKey proto value.
func buildEthAuthInfoBytes(compressedPubKey []byte, sequence uint64, fee Fee) ([]byte, error) {
	pubValue, err := proto.Marshal(&secp256k1.PubKey{Key: compressedPubKey})
	if err != nil {
		return nil, fmt.Errorf("marshal pubkey: %w", err)
	}
	pubAny := &codectypes.Any{TypeUrl: ETHSECP256K1PubKeyType, Value: pubValue}

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
	return proto.Marshal(authInfo)
}

// ethSignDirect produces the eth_secp256k1 classical signature over a SignDoc:
// secp256k1 of keccak256(signBytes), serialized as the 64-byte r‖s (low-s).
func ethSignDirect(privKey, bodyBytes, authInfoBytes []byte, chainID string, accountNumber uint64) ([]byte, error) {
	signBytes, err := proto.Marshal(&sdktx.SignDoc{
		BodyBytes:     bodyBytes,
		AuthInfoBytes: authInfoBytes,
		ChainId:       chainID,
		AccountNumber: accountNumber,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal SignDoc: %w", err)
	}
	return EthSecp256k1Sign(privKey, signBytes), nil
}

// EthSecp256k1Sign returns the eth_secp256k1 classical signature over message:
// secp256k1 ECDSA of keccak256(message), serialized as the 64-byte r‖s with a
// low-s (canonical) scalar. This matches cosmjs Secp256k1.createSignature +
// r(32)‖s(32) over a keccak digest.
func EthSecp256k1Sign(privKey, message []byte) []byte {
	priv := dcrsecp.PrivKeyFromBytes(privKey)
	hash := keccak(message)
	// dcrd's ecdsa.Sign is RFC6979 deterministic and produces a low-S signature.
	sig := dcrecdsa.Sign(priv, hash)
	r := sig.R()
	s := sig.S()
	out := make([]byte, 64)
	rb := r.Bytes()
	sb := s.Bytes()
	copy(out[0:32], rb[:])
	copy(out[32:64], sb[:])
	return out
}

func marshalTxRaw(bodyBytes, authInfoBytes, sig []byte) ([]byte, error) {
	txRaw := &sdktx.TxRaw{
		BodyBytes:     bodyBytes,
		AuthInfoBytes: authInfoBytes,
		Signatures:    [][]byte{sig},
	}
	b, err := proto.Marshal(txRaw)
	if err != nil {
		return nil, fmt.Errorf("marshal TxRaw: %w", err)
	}
	return b, nil
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

func feeToProto(fee Fee) (*sdktx.Fee, error) {
	amount, err := toCoins(fee.Amount)
	if err != nil {
		return nil, err
	}
	return &sdktx.Fee{
		Amount:   amount,
		GasLimit: fee.Gas,
		Granter:  fee.Granter,
		Payer:    fee.Payer,
	}, nil
}
