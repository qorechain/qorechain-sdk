// Package unified derives a single eth-native secp256k1 keypair that renders as
// the SAME 20-byte account under all THREE QoreChain address encodings, so a
// wallet never "has funds on the native lane but not the EVM lane" again.
//
// The 20 bytes are the Ethereum derivation keccak256(uncompressedPubKey[1:])[12:],
// so the key is natively spendable on the EVM lane; the native ("qor1…") and SVM
// (base58) forms are just other encodings of those same 20 bytes — the chain
// reads one x/bank balance for the account, visible under all three:
//
//	UnifiedAccount{
//	  PrivateKey   ([]byte, 32B),
//	  PublicKey    ([]byte, 33B compressed),
//	  AddressBytes ([20]byte),
//	  Cosmos       "qor1…"        (bech32),
//	  Evm          "0x…"          (EIP-55),
//	  Svm          "<base58>"     (base58(20B ‖ 12 zero bytes) = 32-byte SVM addr),
//	  Pqc          {PublicKey, SecretKey}  // ML-DSA-87 (Dilithium-5) for the hybrid ante
//	}
//
// Eth-native accounts are fully supported by the chain: its ante SigVerification
// handles eth_secp256k1 and the PQC hybrid decorator keys off the address, so the
// same wallet signs EVM txs AND PQC-hybrid native txs.
//
// This is ADDITIVE. The classic coin-118 native derivation in the accounts
// package (m/44'/118'/0'/0/i, ripemd160(sha256(pubkey))) is unchanged.
package unified

import (
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/btcsuite/btcd/btcutil/bech32"
	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cosmos/go-bip39"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/mr-tron/base58"
	"golang.org/x/crypto/sha3"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
)

// NativePrefix is the bech32 human-readable prefix for QoreChain accounts.
const NativePrefix = "qor"

// coinTypeEVM is the Ethereum SLIP-0044 coin type; the unified account uses the
// eth HD path m/44'/60'/0'/0/{index} so the 20-byte address is EVM-native.
const coinTypeEVM uint32 = 60

// PQCKeypair is the ML-DSA-87 (Dilithium-5) half of a unified account. Treat
// SecretKey as a secret.
type PQCKeypair struct {
	PublicKey []byte // 2592 bytes
	SecretKey []byte // 4896 bytes
}

// UnifiedAccount is one eth-native secp256k1 identity rendered under all three
// QoreChain address encodings, plus its deterministic ML-DSA-87 hybrid key.
// Treat PrivateKey and Pqc.SecretKey as secrets.
type UnifiedAccount struct {
	PrivateKey   []byte     // 32-byte secp256k1 private key
	PublicKey    []byte     // 33-byte compressed secp256k1 public key
	AddressBytes [20]byte   // keccak256(uncompressedPubKey[1:])[12:]
	Cosmos       string     // bech32("qor", addr20)
	Evm          string     // EIP-55 mixed-case checksum "0x…"
	Svm          string     // base58(addr20 ‖ 12 zero bytes)
	Pqc          PQCKeypair // ML-DSA-87 hybrid key
}

// DeriveUnifiedAccount derives a unified eth-native account from a BIP-39
// mnemonic.
//
// HD path: m/44'/60'/0'/0/{index}, secp256k1. The 20-byte account address is
// keccak256(uncompressedPubKey[1:])[12:] (the Ethereum derivation). The PQC key
// is seeded from shake256("qorechain:pqc:v1|"+cosmos+"|"+mnemonic) so it is
// deterministic and recoverable from {address, mnemonic}.
func DeriveUnifiedAccount(mnemonic string, index uint32) (UnifiedAccount, error) {
	if !accounts.ValidateMnemonic(mnemonic) {
		return UnifiedAccount{}, errors.New("invalid mnemonic")
	}
	seed, err := bip39.NewSeedWithErrorChecking(mnemonic, "")
	if err != nil {
		return UnifiedAccount{}, err
	}
	privKey, compressed, addr20, err := deriveEth(seed, index)
	if err != nil {
		return UnifiedAccount{}, err
	}
	enc, err := AddressesFrom20(addr20)
	if err != nil {
		return UnifiedAccount{}, err
	}
	pqcSeed := shake256([]byte("qorechain:pqc:v1|"+enc.Cosmos+"|"+mnemonic), 32)
	pqc, err := pqcFromSeed(pqcSeed)
	if err != nil {
		return UnifiedAccount{}, err
	}
	return UnifiedAccount{
		PrivateKey:   privKey,
		PublicKey:    compressed,
		AddressBytes: addr20,
		Cosmos:       enc.Cosmos,
		Evm:          enc.Evm,
		Svm:          enc.Svm,
		Pqc:          pqc,
	}, nil
}

// UnifiedAccountFromSeed builds a unified account directly from a 32-byte seed
// used as the secp256k1 private key (no HD derivation).
//
// The PQC seed is shake256("qorechain:pqc:v1|"+cosmos+"|seed:"+hex(seed32)) —
// the literal "seed:" prefix plus the lowercase-hex 32-byte private key stands
// in for the mnemonic, matching the wallet adapter's walletFromSeed /
// fromPhantomSignature contract.
func UnifiedAccountFromSeed(seed32 []byte) (UnifiedAccount, error) {
	if len(seed32) != 32 {
		return UnifiedAccount{}, fmt.Errorf("seed must be 32 bytes, got %d", len(seed32))
	}
	priv := secp256k1.PrivKeyFromBytes(seed32)
	compressed := priv.PubKey().SerializeCompressed()
	uncompressed := priv.PubKey().SerializeUncompressed()
	var addr20 [20]byte
	copy(addr20[:], keccak(uncompressed[1:])[12:])

	enc, err := AddressesFrom20(addr20)
	if err != nil {
		return UnifiedAccount{}, err
	}
	pqcSeed := shake256([]byte("qorechain:pqc:v1|"+enc.Cosmos+"|seed:"+hex.EncodeToString(seed32)), 32)
	pqc, err := pqcFromSeed(pqcSeed)
	if err != nil {
		return UnifiedAccount{}, err
	}
	privCopy := make([]byte, 32)
	copy(privCopy, seed32)
	return UnifiedAccount{
		PrivateKey:   privCopy,
		PublicKey:    compressed,
		AddressBytes: addr20,
		Cosmos:       enc.Cosmos,
		Evm:          enc.Evm,
		Svm:          enc.Svm,
		Pqc:          pqc,
	}, nil
}

// Addresses holds the three address encodings of a single 20-byte account.
type Addresses struct {
	AddressBytes [20]byte
	Cosmos       string // bech32("qor", addr20)
	Evm          string // EIP-55 "0x…"
	Svm          string // base58(addr20 ‖ 12 zero bytes)
}

// AddressesFrom20 renders the three encodings of a known 20-byte account
// address. Exposed so SDKs/backends can render all three from an account too.
func AddressesFrom20(addr20 [20]byte) (Addresses, error) {
	words, err := bech32.ConvertBits(addr20[:], 8, 5, true)
	if err != nil {
		return Addresses{}, fmt.Errorf("convert bech32 words: %w", err)
	}
	cosmos, err := bech32.Encode(NativePrefix, words)
	if err != nil {
		return Addresses{}, fmt.Errorf("encode bech32: %w", err)
	}
	svmBytes := make([]byte, 32)
	copy(svmBytes, addr20[:]) // right-pad with 12 zero bytes → unified 32-byte SVM address
	return Addresses{
		AddressBytes: addr20,
		Cosmos:       cosmos,
		Evm:          toEIP55(addr20[:]),
		Svm:          base58.Encode(svmBytes),
	}, nil
}

// QoreAddresses returns the three encodings of an existing account, given
// exactly one of a bech32 cosmos address, an EVM hex address, or a raw hex
// address (all forms of the same 20 bytes).
func QoreAddresses(cosmos, evm, hexAddr string) (Addresses, error) {
	var addr20 [20]byte
	switch {
	case evm != "":
		b, err := decodeHex20(evm)
		if err != nil {
			return Addresses{}, err
		}
		addr20 = b
	case hexAddr != "":
		b, err := decodeHex20(hexAddr)
		if err != nil {
			return Addresses{}, err
		}
		addr20 = b
	case cosmos != "":
		_, words, err := bech32.Decode(cosmos)
		if err != nil {
			return Addresses{}, fmt.Errorf("invalid bech32 address: %w", err)
		}
		data, err := bech32.ConvertBits(words, 5, 8, false)
		if err != nil {
			return Addresses{}, fmt.Errorf("invalid bech32 payload: %w", err)
		}
		if len(data) != 20 {
			return Addresses{}, fmt.Errorf("bech32 payload must be 20 bytes, got %d", len(data))
		}
		copy(addr20[:], data)
	default:
		return Addresses{}, errors.New("provide one of {cosmos, evm, hex}")
	}
	return AddressesFrom20(addr20)
}

// --- internal helpers ---

// deriveEth derives the eth-path secp256k1 key and its 20-byte address from a
// BIP-39 seed. Path: m/44'/60'/0'/0/{index}.
func deriveEth(seed []byte, index uint32) (privKey, compressed []byte, addr20 [20]byte, err error) {
	master, err := newSecp256k1Master(seed)
	if err != nil {
		return nil, nil, addr20, err
	}
	node, err := master.derivePath([]uint32{
		44 + hardenedOffset,
		coinTypeEVM + hardenedOffset,
		0 + hardenedOffset,
		0,
		index,
	})
	if err != nil {
		return nil, nil, addr20, err
	}
	priv := secp256k1.PrivKeyFromBytes(node.key)
	compressed = priv.PubKey().SerializeCompressed()
	uncompressed := priv.PubKey().SerializeUncompressed()
	copy(addr20[:], keccak(uncompressed[1:])[12:])
	privKey = make([]byte, 32)
	copy(privKey, node.key)
	return privKey, compressed, addr20, nil
}

// pqcFromSeed runs ML-DSA-87 (Dilithium-5) seeded keygen from a 32-byte seed.
func pqcFromSeed(seed []byte) (PQCKeypair, error) {
	if len(seed) != 32 {
		return PQCKeypair{}, fmt.Errorf("pqc seed must be 32 bytes, got %d", len(seed))
	}
	var s [mldsa87.SeedSize]byte
	copy(s[:], seed)
	pub, priv := mldsa87.NewKeyFromSeed(&s)
	pubBytes, err := pub.MarshalBinary()
	if err != nil {
		return PQCKeypair{}, err
	}
	privBytes, err := priv.MarshalBinary()
	if err != nil {
		return PQCKeypair{}, err
	}
	return PQCKeypair{PublicKey: pubBytes, SecretKey: privBytes}, nil
}

func decodeHex20(s string) ([20]byte, error) {
	var out [20]byte
	body := s
	if len(body) >= 2 && (body[:2] == "0x" || body[:2] == "0X") {
		body = body[2:]
	}
	b, err := hex.DecodeString(body)
	if err != nil {
		return out, fmt.Errorf("invalid hex address: %w", err)
	}
	if len(b) != 20 {
		return out, fmt.Errorf("address must be 20 bytes, got %d", len(b))
	}
	copy(out[:], b)
	return out, nil
}

func keccak(data []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	h.Write(data)
	return h.Sum(nil)
}

func shake256(data []byte, n int) []byte {
	out := make([]byte, n)
	sha3.ShakeSum256(out, data)
	return out
}

// toEIP55 renders 20 address bytes as a 0x-prefixed EIP-55 mixed-case checksum.
func toEIP55(addr []byte) string {
	lower := hex.EncodeToString(addr)
	hash := keccak([]byte(lower))
	out := make([]byte, 0, 42)
	out = append(out, '0', 'x')
	for i := 0; i < len(lower); i++ {
		c := lower[i]
		if c >= '0' && c <= '9' {
			out = append(out, c)
			continue
		}
		nibble := hash[i/2]
		if i%2 == 0 {
			nibble >>= 4
		} else {
			nibble &= 0x0f
		}
		if nibble >= 8 {
			out = append(out, c-'a'+'A')
		} else {
			out = append(out, c)
		}
	}
	return string(out)
}
