package unified

import (
	"fmt"

	"cosmossdk.io/math"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdktypes "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"
)

// OnChainPubKey is a decoded on-chain signer public key: the 33-byte compressed
// secp256k1 key plus the address encodings it resolves to.
type OnChainPubKey struct {
	// TypeURL is the pubkey Any type URL as stored on-chain.
	TypeURL string
	// CompressedPubKey is the 33-byte compressed secp256k1 public key.
	CompressedPubKey []byte
	// Addresses are the three encodings of the account (derived eth-native from
	// the pubkey).
	Addresses Addresses
}

// ParseOnChainPubKey decodes an on-chain pubkey Any whose type URL is either the
// standard cosmos secp256k1 PubKey or ETHSECP256K1PubKeyType. Both share the
// wire shape {1: bytes key}, so the value decodes as a secp256k1 PubKey either
// way; only the type URL distinguishes them.
//
// The returned Addresses are computed eth-native (keccak(pubkey)[12:]), matching
// how an eth_secp256k1 account is addressed on-chain.
func ParseOnChainPubKey(typeURL string, value []byte) (OnChainPubKey, error) {
	switch typeURL {
	case ETHSECP256K1PubKeyType, "/cosmos.crypto.secp256k1.PubKey":
	default:
		return OnChainPubKey{}, fmt.Errorf("unsupported pubkey type: %s", typeURL)
	}
	var pk secp256k1.PubKey
	if err := proto.Unmarshal(value, &pk); err != nil {
		return OnChainPubKey{}, fmt.Errorf("decode secp256k1 pubkey: %w", err)
	}
	if len(pk.Key) != 33 {
		return OnChainPubKey{}, fmt.Errorf("compressed secp256k1 pubkey must be 33 bytes, got %d", len(pk.Key))
	}
	addr20, err := addr20FromCompressed(pk.Key)
	if err != nil {
		return OnChainPubKey{}, err
	}
	enc, err := AddressesFrom20(addr20)
	if err != nil {
		return OnChainPubKey{}, err
	}
	return OnChainPubKey{
		TypeURL:          typeURL,
		CompressedPubKey: pk.Key,
		Addresses:        enc,
	}, nil
}

// ParseOnChainPubKeyAny is the codectypes.Any convenience wrapper for
// ParseOnChainPubKey.
func ParseOnChainPubKeyAny(any *codectypes.Any) (OnChainPubKey, error) {
	if any == nil {
		return OnChainPubKey{}, fmt.Errorf("nil pubkey Any")
	}
	return ParseOnChainPubKey(any.TypeUrl, any.Value)
}

// addr20FromCompressed recovers the 20-byte eth-native address from a 33-byte
// compressed secp256k1 public key.
func addr20FromCompressed(compressed []byte) ([20]byte, error) {
	var out [20]byte
	pub, err := parseCompressedPub(compressed)
	if err != nil {
		return out, err
	}
	uncompressed := pub.SerializeUncompressed()
	copy(out[:], keccak(uncompressed[1:])[12:])
	return out, nil
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
