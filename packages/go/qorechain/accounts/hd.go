package accounts

import (
	"crypto/hmac"
	"crypto/sha512"
	"encoding/binary"
	"errors"
	"math/big"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// hardenedOffset is added to a child index to mark a hardened derivation.
const hardenedOffset uint32 = 0x80000000

// secp256k1Node is a minimal BIP-32 HD node over the secp256k1 curve. Only the
// operations the SDK needs (seed master key + hardened/normal CKD) are
// implemented; this is sufficient for BIP-44 paths such as m/44'/118'/0'/0/i.
type secp256k1Node struct {
	key       []byte // 32-byte private key
	chainCode []byte // 32-byte chain code
}

var secp256k1Order = secp256k1.S256().N

// newSecp256k1Master derives the BIP-32 master node from a seed.
func newSecp256k1Master(seed []byte) (*secp256k1Node, error) {
	mac := hmac.New(sha512.New, []byte("Bitcoin seed"))
	mac.Write(seed)
	sum := mac.Sum(nil)
	il := sum[:32]
	ir := sum[32:]
	if isZeroOrGEOrder(il) {
		return nil, errors.New("invalid master key derived from seed")
	}
	return &secp256k1Node{key: il, chainCode: ir}, nil
}

func isZeroOrGEOrder(k []byte) bool {
	x := new(big.Int).SetBytes(k)
	return x.Sign() == 0 || x.Cmp(secp256k1Order) >= 0
}

// compressedPubKey returns the 33-byte compressed public key for this node.
func (n *secp256k1Node) compressedPubKey() []byte {
	priv := secp256k1.PrivKeyFromBytes(n.key)
	return priv.PubKey().SerializeCompressed()
}

// uncompressedPubKey returns the 65-byte uncompressed public key (0x04 || X || Y).
func (n *secp256k1Node) uncompressedPubKey() []byte {
	priv := secp256k1.PrivKeyFromBytes(n.key)
	return priv.PubKey().SerializeUncompressed()
}

// deriveChild performs BIP-32 child key derivation (CKDpriv) for the given
// index (add hardenedOffset for hardened children).
func (n *secp256k1Node) deriveChild(index uint32) (*secp256k1Node, error) {
	data := make([]byte, 0, 37)
	if index >= hardenedOffset {
		// Hardened: 0x00 || ser256(kpar) || ser32(i)
		data = append(data, 0x00)
		data = append(data, leftPad32(n.key)...)
	} else {
		// Normal: serP(point(kpar)) || ser32(i)
		data = append(data, n.compressedPubKey()...)
	}
	var idx [4]byte
	binary.BigEndian.PutUint32(idx[:], index)
	data = append(data, idx[:]...)

	mac := hmac.New(sha512.New, n.chainCode)
	mac.Write(data)
	sum := mac.Sum(nil)
	il := sum[:32]
	ir := sum[32:]

	ilInt := new(big.Int).SetBytes(il)
	if ilInt.Cmp(secp256k1Order) >= 0 {
		return nil, errors.New("derived key is invalid (IL >= n), try next index")
	}

	kpar := new(big.Int).SetBytes(n.key)
	childKey := new(big.Int).Add(ilInt, kpar)
	childKey.Mod(childKey, secp256k1Order)
	if childKey.Sign() == 0 {
		return nil, errors.New("derived key is zero, try next index")
	}

	return &secp256k1Node{
		key:       leftPad32(childKey.Bytes()),
		chainCode: ir,
	}, nil
}

// derivePath derives a sequence of children from this node. Each segment is a
// child index; hardened segments must already include hardenedOffset.
func (n *secp256k1Node) derivePath(segments []uint32) (*secp256k1Node, error) {
	cur := n
	for _, seg := range segments {
		next, err := cur.deriveChild(seg)
		if err != nil {
			return nil, err
		}
		cur = next
	}
	return cur, nil
}

func leftPad32(b []byte) []byte {
	if len(b) >= 32 {
		return b[len(b)-32:]
	}
	out := make([]byte, 32)
	copy(out[32-len(b):], b)
	return out
}

// ed25519Node is a minimal SLIP-0010 HD node over the ed25519 curve. ed25519
// SLIP-0010 supports hardened derivation only.
type ed25519Node struct {
	key       []byte // 32-byte private seed
	chainCode []byte // 32-byte chain code
}

// newEd25519Master derives the SLIP-0010 ed25519 master node from a seed.
func newEd25519Master(seed []byte) *ed25519Node {
	mac := hmac.New(sha512.New, []byte("ed25519 seed"))
	mac.Write(seed)
	sum := mac.Sum(nil)
	return &ed25519Node{key: sum[:32], chainCode: sum[32:]}
}

// deriveChild performs SLIP-0010 hardened child derivation for ed25519.
func (n *ed25519Node) deriveChild(index uint32) *ed25519Node {
	// ed25519 only supports hardened keys.
	hardened := index | hardenedOffset
	data := make([]byte, 0, 37)
	data = append(data, 0x00)
	data = append(data, n.key...)
	var idx [4]byte
	binary.BigEndian.PutUint32(idx[:], hardened)
	data = append(data, idx[:]...)

	mac := hmac.New(sha512.New, n.chainCode)
	mac.Write(data)
	sum := mac.Sum(nil)
	return &ed25519Node{key: sum[:32], chainCode: sum[32:]}
}

// derivePath derives a sequence of hardened children. Each segment is the
// unhardened index (hardening is applied automatically).
func (n *ed25519Node) derivePath(segments []uint32) *ed25519Node {
	cur := n
	for _, seg := range segments {
		cur = cur.deriveChild(seg)
	}
	return cur
}
