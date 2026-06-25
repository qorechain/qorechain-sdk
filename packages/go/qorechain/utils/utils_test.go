package utils

import (
	"encoding/hex"
	"testing"
)

func TestSHA256Vector(t *testing.T) {
	// SHA-256("abc")
	got := hex.EncodeToString(SHA256([]byte("abc")))
	want := "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got != want {
		t.Fatalf("SHA256(abc) = %s, want %s", got, want)
	}
}

func TestKeccak256Vector(t *testing.T) {
	// Keccak-256("") — the canonical empty-input EVM hash.
	got := hex.EncodeToString(Keccak256([]byte{}))
	want := "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
	if got != want {
		t.Fatalf("Keccak256() = %s, want %s", got, want)
	}
	// Keccak-256("abc")
	got = hex.EncodeToString(Keccak256([]byte("abc")))
	want = "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
	if got != want {
		t.Fatalf("Keccak256(abc) = %s, want %s", got, want)
	}
}

func TestRIPEMD160Vector(t *testing.T) {
	// RIPEMD-160("abc")
	got := hex.EncodeToString(RIPEMD160([]byte("abc")))
	want := "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc"
	if got != want {
		t.Fatalf("RIPEMD160(abc) = %s, want %s", got, want)
	}
}

func TestParseFormatUnitsRoundTrip(t *testing.T) {
	cases := []struct {
		display  string
		decimals int
		base     string
	}{
		{"1.5", 18, "1500000000000000000"},
		{"0.1", 6, "100000"},
		{"1", 6, "1000000"},
		{"0.000001", 6, "1"},
		{"0", 6, "0"},
		{"123", 0, "123"},
	}
	for _, tc := range cases {
		base, err := ParseUnits(tc.display, tc.decimals)
		if err != nil {
			t.Fatalf("ParseUnits(%q,%d): %v", tc.display, tc.decimals, err)
		}
		if base != tc.base {
			t.Fatalf("ParseUnits(%q,%d) = %s, want %s", tc.display, tc.decimals, base, tc.base)
		}
		display, err := FormatUnits(tc.base, tc.decimals)
		if err != nil {
			t.Fatalf("FormatUnits(%q,%d): %v", tc.base, tc.decimals, err)
		}
		// "0" display normalizes consistently.
		want := tc.display
		if want == "0" {
			want = "0"
		}
		if display != want {
			t.Fatalf("FormatUnits(%q,%d) = %s, want %s", tc.base, tc.decimals, display, want)
		}
	}
}

func TestParseUnitsRejects(t *testing.T) {
	for _, bad := range []string{"-1", "1.2345678", "1e9", "abc", ""} {
		if _, err := ParseUnits(bad, 6); err == nil {
			t.Errorf("ParseUnits(%q,6) should error", bad)
		}
	}
}

func TestIsValidEVMAddress(t *testing.T) {
	if !IsValidEVMAddress("0x52908400098527886E0F7030069857D2E4169EE7") {
		t.Fatal("valid EVM address rejected")
	}
	for _, bad := range []string{"52908400098527886E0F7030069857D2E4169EE7", "0xZZ", "0x123"} {
		if IsValidEVMAddress(bad) {
			t.Errorf("invalid EVM address accepted: %s", bad)
		}
	}
}

func TestToChecksumAddress(t *testing.T) {
	// EIP-55 reference vectors.
	cases := map[string]string{
		"0x52908400098527886e0f7030069857d2e4169ee7": "0x52908400098527886E0F7030069857D2E4169EE7",
		"0xde709f2102306220921060314715629080e2fb77": "0xde709f2102306220921060314715629080e2fb77",
		"0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
		"0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359": "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
	}
	for in, want := range cases {
		got, err := ToChecksumAddress(in)
		if err != nil {
			t.Fatalf("ToChecksumAddress(%q): %v", in, err)
		}
		if got != want {
			t.Fatalf("ToChecksumAddress(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestIsValidSVMAddress(t *testing.T) {
	// 32-byte base58 (system program id).
	if !IsValidSVMAddress("11111111111111111111111111111111") {
		t.Fatal("valid SVM address rejected")
	}
	if IsValidSVMAddress("not-base58-!!") {
		t.Error("invalid SVM address accepted")
	}
	if IsValidSVMAddress("abc") {
		t.Error("too-short SVM address accepted")
	}
}
