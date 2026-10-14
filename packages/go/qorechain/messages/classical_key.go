package messages

import (
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/address"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/utils"
)

// CompressedSecp256k1Length is the size of a compressed secp256k1 public key.
const CompressedSecp256k1Length = 33

// ClassicalKeyMatch says how a registration's ecdsa_pubkey relates to its sender.
type ClassicalKeyMatch string

const (
	// ClassicalKeyEmpty: no classical key is given, which the chain accepts.
	ClassicalKeyEmpty ClassicalKeyMatch = "empty"
	// ClassicalKeyEth: keccak256(uncompressed[1:])[12:] is the sender
	// (eth_secp256k1 accounts).
	ClassicalKeyEth ClassicalKeyMatch = "eth"
	// ClassicalKeyCosmos: ripemd160(sha256(compressed)) is the sender
	// (secp256k1 accounts).
	ClassicalKeyCosmos ClassicalKeyMatch = "cosmos"
)

// ValidateClassicalKeyForSender applies the ecdsa_pubkey rule of PQC key
// registration (chain v3.2.2): the key must be empty, or a 33-byte compressed
// secp256k1 key that derives to the sender by either address derivation the
// chain uses. Anything else is refused after the registration fee is charged;
// checking here turns that into an error before broadcast.
func ValidateClassicalKeyForSender(sender string, pubkey []byte) (ClassicalKeyMatch, error) {
	if len(pubkey) == 0 {
		return ClassicalKeyEmpty, nil
	}
	if len(pubkey) != CompressedSecp256k1Length || (pubkey[0] != 0x02 && pubkey[0] != 0x03) {
		return "", fmt.Errorf("ecdsa_pubkey must be a %d-byte compressed secp256k1 key, got %d bytes", CompressedSecp256k1Length, len(pubkey))
	}
	point, err := secp256k1.ParsePubKey(pubkey)
	if err != nil {
		return "", fmt.Errorf("ecdsa_pubkey is not a point on secp256k1: %w", err)
	}
	accountHex, err := address.Bech32ToHex(sender)
	if err != nil {
		return "", fmt.Errorf("sender %q is not a bech32 address: %w", sender, err)
	}
	account, err := hex.DecodeString(strings.TrimPrefix(accountHex, "0x"))
	if err != nil {
		return "", fmt.Errorf("sender %q: %w", sender, err)
	}
	eth := utils.Keccak256(point.SerializeUncompressed()[1:])[12:]
	if subtle.ConstantTimeCompare(eth, account) == 1 {
		return ClassicalKeyEth, nil
	}
	if subtle.ConstantTimeCompare(utils.Hash160(pubkey), account) == 1 {
		return ClassicalKeyCosmos, nil
	}
	return "", fmt.Errorf("ecdsa_pubkey does not belong to %s under either address derivation", sender)
}
