// Package authenticator rebuilds — BYTE-FOR-BYTE — the sign-bytes that
// QoreChain's x/abstractaccount and x/pqc modules re-derive on-chain for the
// v3.1.85 authenticator lanes and same-algorithm PQC key rotation.
//
// v3.1.84 introduced the SVM authenticator lane; v3.1.85 adds two more lanes so a
// linked external key (a Phantom ed25519 key or an EVM secp256k1 key) can spend
// from the ONE unified PQC-required account under least-privilege, spend-limited,
// revocable terms — via a relayer, WITHOUT the external key ever producing an
// ML-DSA co-signature:
//
//   - EVM lane    — MsgExecuteEVM:    an EVM call/transfer from the account's 0x addr.
//   - Native lane — MsgExecuteCosmos: a bank send from the account (Cosmos).
//
// The relayer submits + pays fees (its own hybrid-PQC signature satisfies the ante
// on the envelope); the authenticator's signature over the domain-separated,
// replay-bound sign-bytes IS the authorization. The digests here are rebuilt
// byte-for-byte from the chain (x/abstractaccount/types/{evm,cosmos}_sign.go) — a
// mismatch is rejected on-chain (codespace abstractaccount, code 11 replay / 10
// permission / 5 spending-limit / 6 session-expired).
//
// The composers that carry these signatures live in the messages package
// (messages.AbstractAccount.ExecuteEVM / ExecuteCosmos, messages.Pqc.RotatePQCKey).
package authenticator

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"golang.org/x/crypto/sha3"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/unified"
)

// Sign-bytes domain-separation prefixes (must match the chain byte-for-byte).
const (
	evmAuthPrefix    = "qorechain-evm-auth-v1"
	cosmosAuthPrefix = "qorechain-cosmos-auth-v1"
	rotatePrefix     = "qorechain-pqc-rotate-v1"
)

// Derivation scheme identifiers for RotatePQCKeyMsgFromMnemonic.
const (
	// DerivationCanonical is the SDK/wallet-adapter address-bound derivation:
	// ML-DSA-87 seeded keygen of shake256("qorechain:pqc:v1|"+account+"|"+mnemonic).
	DerivationCanonical = "adapter"
	// DerivationLegacy is the chain-bridge/faucet-api derivation: ML-DSA-87 seeded
	// keygen of shake256(mnemonic, 32).
	DerivationLegacy = "bridge"
)

// be64 returns the 8-byte big-endian encoding of n (chain's binary.BigEndian).
func be64(n uint64) []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, n)
	return b
}

// lp returns the length-prefixed field BE64(len(b)) ‖ b.
func lp(b []byte) []byte {
	out := make([]byte, 0, 8+len(b))
	out = append(out, be64(uint64(len(b)))...)
	out = append(out, b...)
	return out
}

func hexLower(b []byte) string { return hex.EncodeToString(b) }

// EVMAuthSignBytes rebuilds the 32-byte digest the chain re-derives for a
// MsgExecuteEVM (types.EVMAuthSignBytes):
//
//	sha256( "qorechain-evm-auth-v1"
//	        ‖ LP(chainID) ‖ LP(account) ‖ LP(pubkey)
//	        ‖ LP(to) ‖ LP(value) ‖ LP(data) ‖ BE64(nonce) )
//
// to is the 0x-hex recipient string, value the decimal wei (aqor) string, data
// the raw calldata, pubkey the authenticator's raw public key (32 bytes for
// ed25519). Returns the 32-byte digest the wallet signs.
//
// NONCE: the account's CURRENT EVM nonce. In production the relayer is a DIFFERENT
// account than the owner, so the relayer envelope does NOT bump the account's
// nonce — use the current value as-is (no +1).
func EVMAuthSignBytes(chainID, account string, pubkey []byte, to, value string, data []byte, nonce uint64) [32]byte {
	body := make([]byte, 0, 256)
	body = append(body, []byte(evmAuthPrefix)...)
	body = append(body, lp([]byte(chainID))...)
	body = append(body, lp([]byte(account))...)
	body = append(body, lp(pubkey)...)
	body = append(body, lp([]byte(to))...)
	body = append(body, lp([]byte(value))...)
	body = append(body, lp(data)...)
	body = append(body, be64(nonce)...)
	return sha256.Sum256(body)
}

// CosmosAuthSignBytes rebuilds the 32-byte digest the chain re-derives for a
// MsgExecuteCosmos (types.CosmosAuthSignBytes):
//
//	sha256( "qorechain-cosmos-auth-v1"
//	        ‖ LP(chainID) ‖ LP(account) ‖ LP(pubkey)
//	        ‖ LP(to) ‖ LP(amount) ‖ BE64(nonce) )
//
// to is the bech32 recipient, amount the canonical sdk.Coins string (sorted, e.g.
// "100uqor"). Returns the 32-byte digest.
//
// NONCE: the per-authenticator sequence for (account, pubkey) — a store counter
// distinct from the account's own sequence, incremented on each Native-lane spend.
func CosmosAuthSignBytes(chainID, account string, pubkey []byte, to, amount string, nonce uint64) [32]byte {
	body := make([]byte, 0, 256)
	body = append(body, []byte(cosmosAuthPrefix)...)
	body = append(body, lp([]byte(chainID))...)
	body = append(body, lp([]byte(account))...)
	body = append(body, lp(pubkey)...)
	body = append(body, lp([]byte(to))...)
	body = append(body, lp([]byte(amount))...)
	body = append(body, be64(nonce)...)
	return sha256.Sum256(body)
}

// RotationSignBytes returns the domain-separated STRING both the old and the new
// key sign for a MsgRotatePQCKey (types.RotationSignBytes):
//
//	"qorechain-pqc-rotate-v1|<chainID>|<algorithmID>|<account>|<oldHex>|<newHex>"
//
// oldPub/newPub are rendered as lowercase hex. Sign utf8(this string).
func RotationSignBytes(chainID string, algorithmID uint32, account string, oldPub, newPub []byte) string {
	return rotatePrefix + "|" + chainID + "|" + strconv.FormatUint(uint64(algorithmID), 10) + "|" +
		account + "|" + hexLower(oldPub) + "|" + hexLower(newPub)
}

// RotationResult is the output of RotatePQCKeyMsgFromMnemonic: the dual-signed
// MsgRotatePQCKey plus both derived keypairs (the new keypair is what the wallet
// signs with AFTER the rotation lands). Treat the SecretKeys as secrets.
type RotationResult struct {
	Msg        *pqcv1.MsgRotatePQCKey
	OldKeypair pqc.Keypair
	NewKeypair pqc.Keypair
}

// RotatePQCKeyMsgFromMnemonic builds a MsgRotatePQCKey that rotates an account's
// ML-DSA-87 key (SAME algorithm) from one derivation to another — the canonical
// use is migrating a LEGACY chain-bridge key (shake256(mnemonic)) to the canonical
// address-bound key (shake256("qorechain:pqc:v1|"+account+"|"+mnemonic)), so a
// wallet whose key was registered by a backend can move to the standard
// derivation. Both keys dual-sign the domain-separated rotation bytes.
//
// The returned message must be broadcast BY the account, hybrid-cosigned with the
// OLD key (still the registered key until the rotation lands). oldDerivation /
// newDerivation are DerivationLegacy ("bridge") or DerivationCanonical ("adapter").
func RotatePQCKeyMsgFromMnemonic(account, mnemonic, chainID string, algorithmID uint32, oldDerivation, newDerivation string) (RotationResult, error) {
	oldKp, err := derivePQCByScheme(oldDerivation, account, mnemonic)
	if err != nil {
		return RotationResult{}, err
	}
	newKp, err := derivePQCByScheme(newDerivation, account, mnemonic)
	if err != nil {
		return RotationResult{}, err
	}
	if hexLower(oldKp.PublicKey) == hexLower(newKp.PublicKey) {
		return RotationResult{}, errors.New("old and new derivations produce the same key — rotation would be a no-op")
	}
	sb := []byte(RotationSignBytes(chainID, algorithmID, account, oldKp.PublicKey, newKp.PublicKey))
	oldSig, err := pqc.PQCSign(oldKp.SecretKey, sb)
	if err != nil {
		return RotationResult{}, fmt.Errorf("sign with old key: %w", err)
	}
	newSig, err := pqc.PQCSign(newKp.SecretKey, sb)
	if err != nil {
		return RotationResult{}, fmt.Errorf("sign with new key: %w", err)
	}
	msg := messages.Pqc.RotatePQCKey(account, oldKp.PublicKey, newKp.PublicKey, oldSig, newSig)
	return RotationResult{Msg: msg, OldKeypair: oldKp, NewKeypair: newKp}, nil
}

// DerivePQCLegacy exposes the LEGACY (chain-bridge) PQC derivation for a mnemonic:
// ML-DSA-87 seeded keygen of shake256([]byte(mnemonic), 32).
func DerivePQCLegacy(mnemonic string) (pqc.Keypair, error) {
	return pqcFromSeed(shake256([]byte(mnemonic), 32))
}

// derivePQCByScheme resolves the requested derivation. Canonical ("adapter", "")
// is the SDK's address-bound derivation; legacy ("bridge", "mnemonic-only") is the
// chain-bridge derivation.
func derivePQCByScheme(scheme, account, mnemonic string) (pqc.Keypair, error) {
	switch scheme {
	case DerivationLegacy, "mnemonic-only":
		return DerivePQCLegacy(mnemonic)
	case DerivationCanonical, "":
		return derivePQCCanonical(account, mnemonic)
	default:
		return pqc.Keypair{}, fmt.Errorf("unknown derivation %q (use adapter|bridge)", scheme)
	}
}

// derivePQCCanonical is the SDK/wallet-adapter address-bound derivation. It
// resolves account (any of the three address encodings) to its canonical bech32
// form, then seeds ML-DSA-87 keygen from shake256("qorechain:pqc:v1|"+cosmos+"|"+mnemonic),
// matching qorechain/unified.DeriveUnifiedAccount.
func derivePQCCanonical(account, mnemonic string) (pqc.Keypair, error) {
	cosmos, err := toCosmos(account)
	if err != nil {
		return pqc.Keypair{}, err
	}
	return pqcFromSeed(shake256([]byte("qorechain:pqc:v1|"+cosmos+"|"+mnemonic), 32))
}

// toCosmos normalizes an account address (bech32 "qor1…" or 0x EVM) to its
// canonical bech32 cosmos form so the canonical derivation domain matches the
// unified account. A 0x EVM address is re-encoded to its bech32 form; any other
// form is validated (and normalized) through unified.QoreAddresses.
func toCosmos(account string) (string, error) {
	if len(account) >= 2 && (account[:2] == "0x" || account[:2] == "0X") {
		enc, err := unified.QoreAddresses("", account, "")
		if err != nil {
			return "", err
		}
		return enc.Cosmos, nil
	}
	enc, err := unified.QoreAddresses(account, "", "")
	if err != nil {
		return "", fmt.Errorf("cannot resolve account %q to a bech32 cosmos address: %w", account, err)
	}
	return enc.Cosmos, nil
}

// pqcFromSeed runs ML-DSA-87 (Dilithium-5) seeded keygen from a 32-byte seed —
// identical to qorechain/unified.pqcFromSeed.
func pqcFromSeed(seed []byte) (pqc.Keypair, error) {
	if len(seed) != mldsa87.SeedSize {
		return pqc.Keypair{}, fmt.Errorf("pqc seed must be %d bytes, got %d", mldsa87.SeedSize, len(seed))
	}
	var s [mldsa87.SeedSize]byte
	copy(s[:], seed)
	pub, priv := mldsa87.NewKeyFromSeed(&s)
	pubBytes, err := pub.MarshalBinary()
	if err != nil {
		return pqc.Keypair{}, err
	}
	privBytes, err := priv.MarshalBinary()
	if err != nil {
		return pqc.Keypair{}, err
	}
	return pqc.Keypair{PublicKey: pubBytes, SecretKey: privBytes}, nil
}

func shake256(data []byte, n int) []byte {
	out := make([]byte, n)
	sha3.ShakeSum256(out, data)
	return out
}
