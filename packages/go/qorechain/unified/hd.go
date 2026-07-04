package unified

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

// secp256k1Node is a minimal BIP-32 HD node over the secp256k1 curve, matching
// the accounts package. Only master + hardened/normal CKD are implemented,
// sufficient for the eth BIP-44 path m/44'/60'/0'/0/i.
type secp256k1Node struct {
	key       []byte // 32-byte private key
	chainCode []byte // 32-byte chain code
}

var secp256k1Order = secp256k1.S256().N

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

func (n *secp256k1Node) compressedPubKey() []byte {
	priv := secp256k1.PrivKeyFromBytes(n.key)
	return priv.PubKey().SerializeCompressed()
}

func (n *secp256k1Node) deriveChild(index uint32) (*secp256k1Node, error) {
	data := make([]byte, 0, 37)
	if index >= hardenedOffset {
		data = append(data, 0x00)
		data = append(data, leftPad32(n.key)...)
	} else {
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
	return &secp256k1Node{key: leftPad32(childKey.Bytes()), chainCode: ir}, nil
}

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

// parseCompressedPub parses a 33-byte compressed secp256k1 public key.
func parseCompressedPub(compressed []byte) (*secp256k1.PublicKey, error) {
	return secp256k1.ParsePubKey(compressed)
}
