package svmv1

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// Bytes32 is the fixed-length 32-byte value referenced by the generated SVM
// messages via gogoproto's customtype option (SVM addresses / program ids).
//
// It implements the gogoproto customtype interface (Size / Marshal / MarshalTo /
// Unmarshal) so it encodes on the wire as a length-delimited bytes field —
// identical to a plain proto3 `bytes` field whose value is exactly 32 bytes,
// matching the chain's x/svm Bytes32. JSON marshals as a hex string for
// human-friendly tx inspection.
type Bytes32 [32]byte

// NewBytes32 builds a Bytes32 from a byte slice, requiring exactly 32 bytes.
func NewBytes32(b []byte) (Bytes32, error) {
	var out Bytes32
	if len(b) != 32 {
		return out, fmt.Errorf("svm Bytes32 must be 32 bytes, got %d", len(b))
	}
	copy(out[:], b)
	return out, nil
}

// Bytes32FromHex parses a hex string (with or without a 0x prefix) into a
// Bytes32.
func Bytes32FromHex(s string) (Bytes32, error) {
	if len(s) >= 2 && (s[0:2] == "0x" || s[0:2] == "0X") {
		s = s[2:]
	}
	raw, err := hex.DecodeString(s)
	if err != nil {
		return Bytes32{}, fmt.Errorf("svm Bytes32 hex decode: %w", err)
	}
	return NewBytes32(raw)
}

// Size reports the marshaled length (always 32) — part of the gogo customtype
// interface.
func (b Bytes32) Size() int { return len(b) }

// Marshal returns the 32 raw bytes — part of the gogo customtype interface.
func (b Bytes32) Marshal() ([]byte, error) {
	out := make([]byte, len(b))
	copy(out, b[:])
	return out, nil
}

// MarshalTo writes the 32 raw bytes into data — part of the gogo customtype
// interface.
func (b Bytes32) MarshalTo(data []byte) (int, error) {
	return copy(data, b[:]), nil
}

// Unmarshal reads exactly 32 bytes from data — part of the gogo customtype
// interface.
func (b *Bytes32) Unmarshal(data []byte) error {
	if len(data) != 32 {
		return fmt.Errorf("svm Bytes32 must be 32 bytes, got %d", len(data))
	}
	copy(b[:], data)
	return nil
}

// String renders the value as a hex string.
func (b Bytes32) String() string { return hex.EncodeToString(b[:]) }

// Equal reports byte-for-byte equality.
func (b Bytes32) Equal(other Bytes32) bool { return b == other }

// MarshalJSON encodes the value as a JSON hex string.
func (b Bytes32) MarshalJSON() ([]byte, error) {
	return json.Marshal(hex.EncodeToString(b[:]))
}

// UnmarshalJSON decodes a JSON hex string into the value.
func (b *Bytes32) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	parsed, err := Bytes32FromHex(s)
	if err != nil {
		return err
	}
	*b = parsed
	return nil
}
