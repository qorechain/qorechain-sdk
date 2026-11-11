package authenticator

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"strconv"

	sdk "github.com/cosmos/cosmos-sdk/types"
	dcrsecp "github.com/decred/dcrd/dcrec/secp256k1/v4"
	dcrecdsa "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
)

// Possession proofs for MsgRegisterAuthenticator (chain v3.2.8). The linked key
// signs messages.AuthenticatorLinkMessage; how depends on the key:
//
//   - ed25519 (32-byte key): ed25519 over the raw text (Phantom signMessage).
//   - secp256k1, 33-byte compressed key: 64-byte r||s low-S ECDSA over
//     sha256(text).
//   - secp256k1 with a 20-byte Ethereum address as the key: EIP-191
//     personal_sign of the text, 65-byte r||s||v with v = 27/28.
//
// A 65-byte uncompressed secp256k1 key is refused by the chain.

// SignLinkEd25519 signs the link message with an ed25519 key. privateKey is the
// 32-byte seed or the 64-byte ed25519 private key. It returns the 32-byte
// public key to put in the message and the 64-byte proof.
func SignLinkEd25519(privateKey []byte, chainID, accountAddress string) (pubkey, proof []byte, err error) {
	var priv ed25519.PrivateKey
	switch len(privateKey) {
	case ed25519.SeedSize:
		priv = ed25519.NewKeyFromSeed(privateKey)
	case ed25519.PrivateKeySize:
		priv = ed25519.PrivateKey(privateKey)
	default:
		return nil, nil, fmt.Errorf("authenticator link: ed25519 key must be a 32-byte seed or a 64-byte private key, got %d bytes", len(privateKey))
	}
	pub := priv.Public().(ed25519.PublicKey)
	text := messages.AuthenticatorLinkMessage(chainID, accountAddress, messages.SchemeEd25519, pub)
	return []byte(pub), ed25519.Sign(priv, []byte(text)), nil
}

// SignLinkSecp256k1 signs the link message with a secp256k1 private key (32
// bytes) for a 33-byte compressed-key link. It returns the compressed public
// key and the 64-byte r||s (low-S) proof over sha256(text).
func SignLinkSecp256k1(privateKey []byte, chainID, accountAddress string) (pubkey, proof []byte, err error) {
	if len(privateKey) != 32 {
		return nil, nil, fmt.Errorf("authenticator link: secp256k1 private key must be 32 bytes, got %d", len(privateKey))
	}
	priv := dcrsecp.PrivKeyFromBytes(privateKey)
	pub := priv.PubKey().SerializeCompressed()
	text := messages.AuthenticatorLinkMessage(chainID, accountAddress, messages.SchemeSecp256k1, pub)
	digest := sha256.Sum256([]byte(text))
	sig := dcrecdsa.Sign(priv, digest[:]) // RFC 6979, low-S
	r, s := sig.R(), sig.S()
	out := make([]byte, 64)
	rb, sb := r.Bytes(), s.Bytes()
	copy(out[:32], rb[:])
	copy(out[32:], sb[:])
	return pub, out, nil
}

// SignLinkEIP191 signs the link message the way MetaMask personal_sign does,
// for a link whose key is the 20-byte Ethereum address of privateKey. It
// returns the address bytes and the 65-byte r||s||v proof (v = 27 or 28).
func SignLinkEIP191(privateKey []byte, chainID, accountAddress string) (ethAddress, proof []byte, err error) {
	if len(privateKey) != 32 {
		return nil, nil, fmt.Errorf("authenticator link: secp256k1 private key must be 32 bytes, got %d", len(privateKey))
	}
	priv := dcrsecp.PrivKeyFromBytes(privateKey)
	addr := ethAddressOf(priv.PubKey())
	text := messages.AuthenticatorLinkMessage(chainID, accountAddress, messages.SchemeSecp256k1, addr)
	compact := dcrecdsa.SignCompact(priv, eip191Digest([]byte(text)), false) // [27+recid] || r || s
	out := make([]byte, 65)
	copy(out[:64], compact[1:])
	out[64] = compact[0]
	return addr, out, nil
}

// VerifyPossessionProof checks proof the way the chain does (v3.2.8). pubkey
// is the message's pubkey: 32 bytes for ed25519; 33 (compressed key) or 20
// (Ethereum address, EIP-191) for secp256k1.
func VerifyPossessionProof(chainID, accountAddress, scheme string, pubkey, proof []byte) error {
	if len(proof) == 0 {
		return errors.New("authenticator link: possession proof is empty")
	}
	text := []byte(messages.AuthenticatorLinkMessage(chainID, accountAddress, scheme, pubkey))
	switch scheme {
	case messages.SchemeEd25519:
		if len(pubkey) != ed25519.PublicKeySize {
			return fmt.Errorf("authenticator link: ed25519 key must be 32 bytes, got %d", len(pubkey))
		}
		if !ed25519.Verify(ed25519.PublicKey(pubkey), text, proof) {
			return errors.New("authenticator link: ed25519 possession proof does not verify")
		}
		return nil
	case messages.SchemeSecp256k1:
		switch len(pubkey) {
		case 33:
			pk, err := dcrsecp.ParsePubKey(pubkey)
			if err != nil {
				return fmt.Errorf("authenticator link: bad secp256k1 key: %w", err)
			}
			if len(proof) != 64 {
				return fmt.Errorf("authenticator link: secp256k1 proof must be 64 bytes r||s, got %d", len(proof))
			}
			var r, s dcrsecp.ModNScalar
			if r.SetByteSlice(proof[:32]) || s.SetByteSlice(proof[32:]) || r.IsZero() || s.IsZero() || s.IsOverHalfOrder() {
				return errors.New("authenticator link: secp256k1 proof is not a canonical low-S signature")
			}
			digest := sha256.Sum256(text)
			if !dcrecdsa.NewSignature(&r, &s).Verify(digest[:], pk) {
				return errors.New("authenticator link: secp256k1 possession proof does not verify")
			}
			return nil
		case 20:
			if len(proof) != 65 {
				return fmt.Errorf("authenticator link: EIP-191 proof must be 65 bytes r||s||v, got %d", len(proof))
			}
			v := proof[64]
			if v < 27 {
				v += 27
			}
			if v != 27 && v != 28 {
				return fmt.Errorf("authenticator link: EIP-191 proof has v = %d (want 27/28 or 0/1)", proof[64])
			}
			compact := append([]byte{v}, proof[:64]...)
			pk, _, err := dcrecdsa.RecoverCompact(compact, eip191Digest(text))
			if err != nil {
				return fmt.Errorf("authenticator link: EIP-191 proof does not recover a key: %w", err)
			}
			if !bytes.Equal(ethAddressOf(pk), pubkey) {
				return errors.New("authenticator link: EIP-191 possession proof was signed by a different address")
			}
			return nil
		case 65:
			return errors.New("authenticator link: uncompressed 65-byte secp256k1 keys are refused; use the 33-byte compressed key")
		default:
			return fmt.Errorf("authenticator link: secp256k1 key must be 33 bytes (compressed) or a 20-byte Ethereum address, got %d", len(pubkey))
		}
	default:
		return fmt.Errorf("authenticator link: unknown scheme %q (ed25519 or secp256k1)", scheme)
	}
}

func eip191Digest(text []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	h.Write([]byte("\x19Ethereum Signed Message:\n" + strconv.Itoa(len(text))))
	h.Write(text)
	return h.Sum(nil)
}

func ethAddressOf(pk *dcrsecp.PublicKey) []byte {
	h := sha3.NewLegacyKeccak256()
	h.Write(pk.SerializeUncompressed()[1:])
	return h.Sum(nil)[12:]
}

// LinkParams are the inputs to LinkAuthenticatorMsgs.
type LinkParams struct {
	// Owner signs both messages (top-level, not through authz).
	Owner string
	// AccountAddress is the account the key is linked to; empty means Owner.
	// When it equals Owner, MsgUpdateSpendingRules creates the account if it
	// does not exist yet.
	AccountAddress string
	// ChainID is the chain the proof was made for; the proof is checked
	// locally against it.
	ChainID     string
	Scheme      string
	Pubkey      []byte
	Permissions []string
	// ExpiryUnix is the key's expiry in unix seconds (0 = none).
	ExpiryUnix int64
	Label      string
	// PossessionProof is the linked key's signature over
	// messages.AuthenticatorLinkMessage (SignLinkEd25519, SignLinkSecp256k1,
	// SignLinkEIP191, or the wallet's own signature).
	PossessionProof []byte
	// SpendingRules are the account's spending rules. They REPLACE the
	// account's rules wholesale, so include every rule to keep. Required when
	// Permissions carry a value permission (send, evm, deploy, svm, all); the
	// first enabled rule must then bound every denom. Nil sends no
	// MsgUpdateSpendingRules (only allowed without a value permission).
	SpendingRules []abstractaccountv1.SpendingRule
}

// LinkAuthenticatorMsgs builds the transaction that links a key on chain
// v3.2.8: [MsgUpdateSpendingRules, MsgRegisterAuthenticator], both signed by
// the owner as top-level messages, in ONE transaction. It checks the
// possession proof locally (VerifyPossessionProof), the spending rules
// (messages.ValidateSpendingRules) and, for a value permission, that the first
// enabled rule bounds every denom (messages.CheckSpendingRuleBoundsValueKeys).
// Without a value permission and without SpendingRules it returns only the
// MsgRegisterAuthenticator.
func LinkAuthenticatorMsgs(p LinkParams) ([]sdk.Msg, error) {
	if p.Owner == "" {
		return nil, errors.New("authenticator link: owner is required")
	}
	account := p.AccountAddress
	if account == "" {
		account = p.Owner
	}
	if err := VerifyPossessionProof(p.ChainID, account, p.Scheme, p.Pubkey, p.PossessionProof); err != nil {
		return nil, fmt.Errorf("%w (sign messages.AuthenticatorLinkMessage(chainID, account, scheme, pubkey) with the key being linked)", err)
	}
	value := messages.HasValuePermission(p.Permissions)
	if value && p.SpendingRules == nil {
		return nil, fmt.Errorf("authenticator link: permissions %v move value, so the account needs a spending rule that bounds "+
			"every denom (from chain v3.2.8); pass SpendingRules", p.Permissions)
	}
	var out []sdk.Msg
	if p.SpendingRules != nil {
		if value {
			if err := messages.CheckSpendingRuleBoundsValueKeys(p.SpendingRules); err != nil {
				return nil, fmt.Errorf("authenticator link: %w", err)
			}
		}
		rules, err := messages.NewUpdateSpendingRules(p.Owner, account, p.SpendingRules)
		if err != nil {
			return nil, fmt.Errorf("authenticator link: %w", err)
		}
		out = append(out, rules)
	}
	reg, err := messages.AbstractAccount.RegisterAuthenticator(p.Owner, account, p.Scheme, p.Pubkey, p.Permissions, p.ExpiryUnix, p.Label, p.PossessionProof)
	if err != nil {
		return nil, err
	}
	return append(out, reg), nil
}
