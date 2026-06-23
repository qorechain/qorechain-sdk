package address

import "testing"

func TestRoundTripBech32Hex(t *testing.T) {
	// 20-byte payload.
	hexIn := "0x751b55e784182517944356edb2cf6d011c60c344"
	addr, err := HexToBech32(hexIn, "qor")
	if err != nil {
		t.Fatalf("HexToBech32 error: %v", err)
	}
	if !IsValidBech32(addr, "qor") {
		t.Errorf("address %q should be valid with prefix qor", addr)
	}
	back, err := Bech32ToHex(addr)
	if err != nil {
		t.Fatalf("Bech32ToHex error: %v", err)
	}
	if back != hexIn {
		t.Errorf("round trip: %q -> %q -> %q", hexIn, addr, back)
	}
}

func TestBytesToBech32(t *testing.T) {
	data := []byte{0x01, 0x02, 0x03, 0x04, 0x05}
	addr, err := BytesToBech32(data, "qor")
	if err != nil {
		t.Fatal(err)
	}
	hexStr, err := Bech32ToHex(addr)
	if err != nil {
		t.Fatal(err)
	}
	if hexStr != "0x0102030405" {
		t.Errorf("decoded payload = %q", hexStr)
	}
}

func TestHexToBech32RejectsBadHex(t *testing.T) {
	for _, bad := range []string{"0xZZ", "0x123", "", "0x"} {
		if _, err := HexToBech32(bad, "qor"); err == nil {
			t.Errorf("HexToBech32(%q) expected error", bad)
		}
	}
}

func TestBech32ToHexRejectsBad(t *testing.T) {
	for _, bad := range []string{"notbech32", "qor1invalidchecksum", ""} {
		if _, err := Bech32ToHex(bad); err == nil {
			t.Errorf("Bech32ToHex(%q) expected error", bad)
		}
	}
}

func TestIsValidBech32(t *testing.T) {
	addr, err := HexToBech32("0x0102030405", "qor")
	if err != nil {
		t.Fatal(err)
	}
	if !IsValidBech32(addr, "") {
		t.Error("should be valid with no prefix requirement")
	}
	if !IsValidBech32(addr, "qor") {
		t.Error("should be valid with prefix qor")
	}
	if IsValidBech32(addr, "cosmos") {
		t.Error("should be invalid with prefix cosmos")
	}
	if IsValidBech32("garbage", "qor") {
		t.Error("garbage should be invalid")
	}
}

func TestHexPrefixOptional(t *testing.T) {
	a, err := HexToBech32("0102030405", "qor")
	if err != nil {
		t.Fatal(err)
	}
	b, err := HexToBech32("0x0102030405", "qor")
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("prefix should be optional: %q != %q", a, b)
	}
}
