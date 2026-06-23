// Package accounts handles BIP-39 mnemonic generation/validation and
// hierarchical-deterministic (HD) derivation of QoreChain accounts in all three
// supported schemes:
//
//  1. native — Cosmos-style secp256k1, BIP-44 path m/44'/118'/0'/0/{index},
//     address = bech32("qor", ripemd160(sha256(compressedPubKey))).
//  2. evm    — secp256k1, BIP-44 path m/44'/60'/0'/0/{index},
//     address = "0x" + last 20 bytes of keccak256(uncompressedPubKey[1:]),
//     rendered with an EIP-55 mixed-case checksum.
//  3. svm    — ed25519, SLIP-0010 path m/44'/501'/{index}'/0' (all hardened,
//     the Solana standard), address = base58(32-byte ed25519 public key).
//
// Secret material is returned explicitly from the derive functions and is never
// logged.
package accounts

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/btcsuite/btcd/btcutil/bech32"
	"github.com/cosmos/go-bip39"
	"github.com/mr-tron/base58"
	"golang.org/x/crypto/ripemd160" //nolint:staticcheck // ripemd160 is required by the Cosmos address scheme.
	"golang.org/x/crypto/sha3"
)

// NativePrefix is the bech32 human-readable prefix for native QoreChain
// account addresses.
const NativePrefix = "qor"

// Coin types per SLIP-0044.
const (
	coinTypeNative uint32 = 118 // Cosmos
	coinTypeEVM    uint32 = 60  // Ethereum
	coinTypeSVM    uint32 = 501 // Solana
)

// Secp256k1Account is a secp256k1-based account (native or EVM). Treat
// PrivateKey as a secret.
type Secp256k1Account struct {
	Type       string
	Address    string
	PublicKey  []byte // 33-byte compressed public key
	PrivateKey []byte // 32-byte private key
}

// Ed25519Account is an ed25519-based (SVM/Solana) account. Treat SecretKey as a
// secret.
type Ed25519Account struct {
	Type      string
	Address   string
	PublicKey []byte // 32-byte ed25519 public key
	// SecretKey is the 64-byte Solana-style secret key (privateSeed32 || publicKey32).
	SecretKey []byte
}

// GenerateMnemonic generates a fresh BIP-39 mnemonic.
//
// strength is entropy in bits: 128 -> 12 words, 256 -> 24 words.
func GenerateMnemonic(strength int) (string, error) {
	if strength != 128 && strength != 256 {
		return "", fmt.Errorf("unsupported strength: %d (use 128 or 256)", strength)
	}
	entropy, err := bip39.NewEntropy(strength)
	if err != nil {
		return "", err
	}
	return bip39.NewMnemonic(entropy)
}

// ValidateMnemonic validates a BIP-39 mnemonic against the English wordlist AND
// the checksum. It never returns an error.
//
// Note: go-bip39's IsMnemonicValid only checks word membership and length, not
// the checksum bits — so a phrase of all valid words with a wrong checksum
// passes it. MnemonicToByteArray decodes and verifies the checksum, which is
// the guarantee callers need to avoid the fund-loss footgun of deriving from a
// typo'd phrase.
func ValidateMnemonic(mnemonic string) bool {
	if !bip39.IsMnemonicValid(mnemonic) {
		return false
	}
	_, err := bip39.MnemonicToByteArray(mnemonic)
	return err == nil
}

// seedFromMnemonic validates a mnemonic and derives its BIP-39 seed.
//
// Centralizing this guards against the fund-loss footgun where a typo'd phrase
// (valid words, wrong checksum) would silently derive a valid-looking but WRONG
// account. The error deliberately omits the mnemonic text.
func seedFromMnemonic(mnemonic string) ([]byte, error) {
	if !ValidateMnemonic(mnemonic) {
		return nil, errors.New("invalid mnemonic")
	}
	return bip39.NewSeedWithErrorChecking(mnemonic, "")
}

// DeriveNativeAccount derives a native QoreChain account (Cosmos-style
// secp256k1).
//
// Path: m/44'/118'/0'/0/{index}. The address is the bech32 ("qor") encoding of
// ripemd160(sha256(compressedPublicKey)).
func DeriveNativeAccount(mnemonic string, index uint32) (Secp256k1Account, error) {
	seed, err := seedFromMnemonic(mnemonic)
	if err != nil {
		return Secp256k1Account{}, err
	}
	master, err := newSecp256k1Master(seed)
	if err != nil {
		return Secp256k1Account{}, err
	}
	node, err := master.derivePath([]uint32{
		44 + hardenedOffset,
		coinTypeNative + hardenedOffset,
		0 + hardenedOffset,
		0,
		index,
	})
	if err != nil {
		return Secp256k1Account{}, err
	}
	compressed := node.compressedPubKey()
	sha := sha256.Sum256(compressed)
	r := ripemd160.New()
	r.Write(sha[:])
	hash := r.Sum(nil)

	words, err := bech32.ConvertBits(hash, 8, 5, true)
	if err != nil {
		return Secp256k1Account{}, err
	}
	address, err := bech32.Encode(NativePrefix, words)
	if err != nil {
		return Secp256k1Account{}, err
	}
	return Secp256k1Account{
		Type:       "native",
		Address:    address,
		PublicKey:  compressed,
		PrivateKey: append([]byte(nil), node.key...),
	}, nil
}

// DeriveEVMAccount derives an EVM account from a mnemonic.
//
// Path: m/44'/60'/0'/0/{index}. The address is the last 20 bytes of
// keccak256(uncompressedPublicKey[1:]), EIP-55 checksummed.
func DeriveEVMAccount(mnemonic string, index uint32) (Secp256k1Account, error) {
	seed, err := seedFromMnemonic(mnemonic)
	if err != nil {
		return Secp256k1Account{}, err
	}
	master, err := newSecp256k1Master(seed)
	if err != nil {
		return Secp256k1Account{}, err
	}
	node, err := master.derivePath([]uint32{
		44 + hardenedOffset,
		coinTypeEVM + hardenedOffset,
		0 + hardenedOffset,
		0,
		index,
	})
	if err != nil {
		return Secp256k1Account{}, err
	}
	uncompressed := node.uncompressedPubKey()
	h := sha3.NewLegacyKeccak256()
	h.Write(uncompressed[1:]) // drop the 0x04 prefix
	digest := h.Sum(nil)
	addrBytes := digest[len(digest)-20:]

	return Secp256k1Account{
		Type:       "evm",
		Address:    toEIP55(addrBytes),
		PublicKey:  node.compressedPubKey(),
		PrivateKey: append([]byte(nil), node.key...),
	}, nil
}

// DeriveSVMAccount derives an SVM (Solana-style ed25519) account from a
// mnemonic.
//
// Path: m/44'/501'/{index}'/0' — the conventional Solana derivation, all
// segments hardened (SLIP-0010 for ed25519 supports hardened keys only). The
// address is the base58 encoding of the 32-byte public key. The returned
// SecretKey is the 64-byte Solana form (privateSeed32 || publicKey32).
func DeriveSVMAccount(mnemonic string, index uint32) (Ed25519Account, error) {
	seed, err := seedFromMnemonic(mnemonic)
	if err != nil {
		return Ed25519Account{}, err
	}
	master := newEd25519Master(seed)
	node := master.derivePath([]uint32{44, coinTypeSVM, index, 0})

	priv := ed25519.NewKeyFromSeed(node.key)
	pub := priv.Public().(ed25519.PublicKey)
	publicKey := append([]byte(nil), pub...)
	secretKey := append([]byte(nil), node.key...)
	secretKey = append(secretKey, publicKey...)

	return Ed25519Account{
		Type:      "svm",
		Address:   base58.Encode(publicKey),
		PublicKey: publicKey,
		SecretKey: secretKey,
	}, nil
}

// toEIP55 renders 20 address bytes as a 0x-prefixed EIP-55 mixed-case checksum
// address.
func toEIP55(addr []byte) string {
	lower := hex.EncodeToString(addr)
	h := sha3.NewLegacyKeccak256()
	h.Write([]byte(lower))
	hash := h.Sum(nil)

	out := make([]byte, 0, 42)
	out = append(out, '0', 'x')
	for i := 0; i < len(lower); i++ {
		c := lower[i]
		if c >= '0' && c <= '9' {
			out = append(out, c)
			continue
		}
		// nibble of the keccak hash at position i
		nibble := hash[i/2]
		if i%2 == 0 {
			nibble >>= 4
		} else {
			nibble &= 0x0f
		}
		if nibble >= 8 {
			out = append(out, c-'a'+'A') // uppercase
		} else {
			out = append(out, c)
		}
	}
	return string(out)
}
