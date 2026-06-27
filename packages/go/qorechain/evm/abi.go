package evm

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/utils"
)

// wordSize is the EVM ABI word size in bytes.
const wordSize = 32

func hexEncode(b []byte) string { return hex.EncodeToString(b) }

func stripHexPrefix(s string) string {
	if len(s) >= 2 && (s[:2] == "0x" || s[:2] == "0X") {
		return s[2:]
	}
	return s
}

// hexDecode decodes a "0x"-prefixed (or bare) hex string to bytes. An empty
// string or "0x" decodes to an empty slice.
func hexDecode(s string) ([]byte, error) {
	body := stripHexPrefix(s)
	if body == "" {
		return []byte{}, nil
	}
	if len(body)%2 != 0 {
		body = "0" + body
	}
	b, err := hex.DecodeString(body)
	if err != nil {
		return nil, fmt.Errorf("invalid hex: %q", s)
	}
	return b, nil
}

// selector returns the 4-byte function selector: the first 4 bytes of
// keccak256(signature), e.g. selector("aiRiskScore(bytes)").
func selector(signature string) []byte {
	return utils.Keccak256([]byte(signature))[:4]
}

// leftPad32 left-pads b to a 32-byte ABI word (for fixed-size types: uint, address).
func leftPad32(b []byte) []byte {
	if len(b) >= wordSize {
		return b[len(b)-wordSize:]
	}
	out := make([]byte, wordSize)
	copy(out[wordSize-len(b):], b)
	return out
}

// rightPad32 right-pads b to a multiple of 32 bytes (for dynamic-bytes data).
func rightPad32(b []byte) []byte {
	if len(b)%wordSize == 0 {
		return b
	}
	padded := make([]byte, (len(b)/wordSize+1)*wordSize)
	copy(padded, b)
	return padded
}

// encodeUint encodes a non-negative big.Int as a 32-byte ABI word.
func encodeUint(n *big.Int) []byte {
	if n == nil {
		return make([]byte, wordSize)
	}
	return leftPad32(n.Bytes())
}

// encodeAddress encodes a "0x"-prefixed 20-byte hex address as a 32-byte
// left-padded ABI word. Addresses longer than 20 bytes are truncated to their
// low 20 bytes; shorter ones are accepted as-is.
func encodeAddress(addr string) ([]byte, error) {
	b, err := hex.DecodeString(stripHexPrefix(addr))
	if err != nil {
		return nil, fmt.Errorf("invalid address hex: %q", addr)
	}
	if len(b) > 20 {
		b = b[len(b)-20:]
	}
	return leftPad32(b), nil
}

// encodeBytesArg ABI-encodes a single dynamic `bytes` argument as the body of a
// call with one parameter: head (offset 0x20) + length word + right-padded data.
func encodeBytesArg(data []byte) []byte {
	out := make([]byte, 0, wordSize*2+len(rightPad32(data)))
	out = append(out, leftPad32(big.NewInt(wordSize).Bytes())...)  // offset = 0x20
	out = append(out, encodeUint(big.NewInt(int64(len(data))))...) // length
	out = append(out, rightPad32(data)...)                         // data, right-padded
	return out
}

// decodeWord returns the 32-byte word at index i of ret (or an error if ret is
// too short).
func decodeWord(ret []byte, i int) ([]byte, error) {
	start := i * wordSize
	if len(ret) < start+wordSize {
		return nil, fmt.Errorf("return data too short: have %d bytes, need word %d", len(ret), i)
	}
	return ret[start : start+wordSize], nil
}

// decodeUint reads return word i as a big.Int.
func decodeUint(ret []byte, i int) (*big.Int, error) {
	w, err := decodeWord(ret, i)
	if err != nil {
		return nil, err
	}
	return new(big.Int).SetBytes(w), nil
}

// decodeBool reads return word i as a bool (any non-zero word is true).
func decodeBool(ret []byte, i int) (bool, error) {
	n, err := decodeUint(ret, i)
	if err != nil {
		return false, err
	}
	return n.Sign() != 0, nil
}

// decodeUint8 reads return word i as a uint8 (the low byte of the word).
func decodeUint8(ret []byte, i int) (uint8, error) {
	w, err := decodeWord(ret, i)
	if err != nil {
		return 0, err
	}
	return w[wordSize-1], nil
}

// normalizeHexAddr lowercases and 0x-prefixes a hex address string for params.
func normalizeHexAddr(addr string) string {
	return "0x" + strings.ToLower(stripHexPrefix(addr))
}
