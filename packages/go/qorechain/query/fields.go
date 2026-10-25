package query

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"cosmossdk.io/math"
)

// Field readers for the v3.2.4 REST answers. Each takes the route name for its
// error message, reads a number spelled as a JSON string (as the chain sends
// int64, uint64 and amount fields) or as a bare number, and reads an absent or
// null field as zero / false.

// restString unquotes a JSON string or returns a bare token verbatim; "" for
// an absent or null field.
func restString(raw json.RawMessage, route, field string) (string, error) {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return "", nil
	}
	if strings.HasPrefix(s, `"`) {
		var str string
		if err := json.Unmarshal(raw, &str); err != nil {
			return "", fmt.Errorf("%s: field %s: %w", route, field, err)
		}
		return strings.TrimSpace(str), nil
	}
	return s, nil
}

func restBool(raw json.RawMessage, route, field string) (bool, error) {
	s, err := restString(raw, route, field)
	if err != nil {
		return false, err
	}
	switch s {
	case "", "false":
		return false, nil
	case "true":
		return true, nil
	default:
		return false, fmt.Errorf("%s: field %s is not a boolean: %q", route, field, s)
	}
}

func restUint(raw json.RawMessage, route, field string, bits int) (uint64, error) {
	s, err := restString(raw, route, field)
	if err != nil || s == "" {
		return 0, err
	}
	n, err := strconv.ParseUint(s, 10, bits)
	if err != nil {
		return 0, fmt.Errorf("%s: field %s is not an unsigned integer: %q", route, field, s)
	}
	return n, nil
}

func restInt64(raw json.RawMessage, route, field string) (int64, error) {
	s, err := restString(raw, route, field)
	if err != nil || s == "" {
		return 0, err
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: field %s is not an integer: %q", route, field, s)
	}
	return n, nil
}

func restAmount(raw json.RawMessage, route, field string) (math.Int, error) {
	s, err := restString(raw, route, field)
	if err != nil {
		return math.Int{}, err
	}
	if s == "" {
		return math.ZeroInt(), nil
	}
	v, ok := math.NewIntFromString(s)
	if !ok {
		return math.Int{}, fmt.Errorf("%s: field %s is not an integer amount: %q", route, field, s)
	}
	return v, nil
}

// rawFields is one JSON object with its fields left undecoded.
type rawFields map[string]json.RawMessage

func decodeFields(raw []byte, route string) (rawFields, error) {
	var f rawFields
	if err := json.Unmarshal(raw, &f); err != nil {
		return nil, fmt.Errorf("%s: decoding response: %w", route, err)
	}
	return f, nil
}

func decodeFieldList(raw json.RawMessage, route, field string) ([]rawFields, error) {
	var list []rawFields
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("%s: field %s: %w", route, field, err)
	}
	return list, nil
}

// fieldReader reads the fields of one JSON object and keeps the first error,
// so a decoder can read every field and check once.
type fieldReader struct {
	f     rawFields
	route string
	err   error
}

func (r *fieldReader) u32(name string) uint32 {
	n, err := restUint(r.f[name], r.route, name, 32)
	r.keep(err)
	return uint32(n)
}

func (r *fieldReader) u64(name string) uint64 {
	n, err := restUint(r.f[name], r.route, name, 64)
	r.keep(err)
	return n
}

func (r *fieldReader) i64(name string) int64 {
	n, err := restInt64(r.f[name], r.route, name)
	r.keep(err)
	return n
}

func (r *fieldReader) amount(name string) math.Int {
	v, err := restAmount(r.f[name], r.route, name)
	r.keep(err)
	return v
}

func (r *fieldReader) boolean(name string) bool {
	v, err := restBool(r.f[name], r.route, name)
	r.keep(err)
	return v
}

func (r *fieldReader) str(name string) string {
	v, err := restString(r.f[name], r.route, name)
	r.keep(err)
	return v
}

func (r *fieldReader) keep(err error) {
	if r.err == nil {
		r.err = err
	}
}
