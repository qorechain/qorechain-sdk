package unified

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

// Known-answer vectors shared with @qorechain/wallet-adapter and every SDK
// language.
const (
	katSeedAddress    = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj"
	katRecoveryCode   = "QRC1-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3X-19XK"
	katRecoveryPubSHA = "cf50dca6c9a0d86eeac9d6a50ee54e567e2126184143be694b8df1f31c8e23ef"
	katLegacyPubSHA   = "3710d198ff5d3206601e9dfd7e0e4bac0656de0fee28f5a20b39e05c81e46bd0"
)

func pubSHA(pub []byte) string {
	sum := sha256.Sum256(pub)
	return hex.EncodeToString(sum[:])
}

func TestPQCRecoveryCodeFromSecretKAT(t *testing.T) {
	code, err := PQCRecoveryCodeFromSecret(bytes.Repeat([]byte{0x07}, 32))
	if err != nil {
		t.Fatal(err)
	}
	if code != katRecoveryCode {
		t.Fatalf("code = %s, want %s", code, katRecoveryCode)
	}
	if _, err := PQCRecoveryCodeFromSecret(make([]byte, 31)); err == nil {
		t.Error("expected an error for a 31-byte secret")
	}
}

func TestUnifiedAccountFromSeedRecoveryCodeKAT(t *testing.T) {
	seed := bytes.Repeat([]byte{0x01}, 32)
	acc, err := UnifiedAccountFromSeed(seed, SeedPQCOptions{RecoveryCode: katRecoveryCode})
	if err != nil {
		t.Fatal(err)
	}
	if acc.Cosmos != katSeedAddress {
		t.Fatalf("cosmos = %s, want %s", acc.Cosmos, katSeedAddress)
	}
	if len(acc.Pqc.PublicKey) != 2592 {
		t.Fatalf("pqc public key = %d bytes, want 2592", len(acc.Pqc.PublicKey))
	}
	if got := pubSHA(acc.Pqc.PublicKey); got != katRecoveryPubSHA {
		t.Errorf("sha256(pqc pub) = %s, want %s", got, katRecoveryPubSHA)
	}

	secret := bytes.Repeat([]byte{0x07}, 32)
	acc2, err := UnifiedAccountFromSeed(seed, SeedPQCOptions{PQCSecret: secret})
	if err != nil {
		t.Fatal(err)
	}
	if got := pubSHA(acc2.Pqc.PublicKey); got != katRecoveryPubSHA {
		t.Errorf("PQCSecret: sha256(pqc pub) = %s, want %s", got, katRecoveryPubSHA)
	}
	if !bytes.Equal(secret, bytes.Repeat([]byte{0x07}, 32)) {
		t.Error("PQCSecret was modified by the call")
	}

	kp, err := PQCKeyFromRecoveryCode(katRecoveryCode, katSeedAddress)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(kp.PublicKey, acc.Pqc.PublicKey) || !bytes.Equal(kp.SecretKey, acc.Pqc.SecretKey) {
		t.Error("PQCKeyFromRecoveryCode differs from UnifiedAccountFromSeed")
	}
	// The address is lowercased before use.
	kpUpper, err := PQCKeyFromRecoveryCode(katRecoveryCode, strings.ToUpper(katSeedAddress))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(kpUpper.PublicKey, kp.PublicKey) {
		t.Error("upper-case address gave a different key")
	}
}

func TestUnifiedAccountFromSeedLegacyKAT(t *testing.T) {
	acc, err := UnifiedAccountFromSeed(bytes.Repeat([]byte{0x01}, 32), SeedPQCOptions{LegacySeedDerivation: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := pubSHA(acc.Pqc.PublicKey); got != katLegacyPubSHA {
		t.Errorf("sha256(pqc pub) = %s, want %s", got, katLegacyPubSHA)
	}
}

func TestUnifiedAccountFromSeedOptionErrors(t *testing.T) {
	seed := bytes.Repeat([]byte{0x01}, 32)
	_, err := UnifiedAccountFromSeed(seed, SeedPQCOptions{})
	if err == nil {
		t.Fatal("expected an error with no option")
	}
	for _, want := range []string{"RecoveryCode", "PQCSecret", "LegacySeedDerivation"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not mention %s", err, want)
		}
	}
	cases := []SeedPQCOptions{
		{RecoveryCode: katRecoveryCode, PQCSecret: bytes.Repeat([]byte{0x07}, 32)},
		{RecoveryCode: katRecoveryCode, LegacySeedDerivation: true},
		{PQCSecret: bytes.Repeat([]byte{0x07}, 32), LegacySeedDerivation: true},
	}
	for i, o := range cases {
		if _, err := UnifiedAccountFromSeed(seed, o); err == nil {
			t.Errorf("case %d: expected an error with two options", i)
		}
	}
	_, err = UnifiedAccountFromSeed(seed, SeedPQCOptions{PQCSecret: bytes.Repeat([]byte{0x01}, 32)})
	if err == nil || !strings.Contains(err.Error(), "must not equal seed32") {
		t.Errorf("PQCSecret equal to seed32: err = %v, want a rejection", err)
	}
	if _, err := UnifiedAccountFromSeed(seed, SeedPQCOptions{PQCSecret: make([]byte, 16)}); err == nil {
		t.Error("expected an error for a 16-byte PQCSecret")
	}
	if _, err := UnifiedAccountFromSeed(seed, SeedPQCOptions{RecoveryCode: "QRC1-not-a-code"}); err == nil {
		t.Error("expected an error for a malformed recovery code")
	}
}

func TestRecoveryCodeNormalisation(t *testing.T) {
	// Lowercase, spaces instead of dashes, and confusables: O for 0, I/L for 1.
	messy := strings.ToLower(katRecoveryCode)
	messy = strings.ReplaceAll(messy, "-", " ")
	messy = strings.ReplaceAll(messy, "0", "o")
	messy = strings.Replace(messy, "1", "i", 2)
	messy = strings.Replace(messy, "1", "l", 2)
	if !IsValidRecoveryCode(messy) {
		t.Fatalf("normalised code %q rejected", messy)
	}
	kp, err := PQCKeyFromRecoveryCode(messy, katSeedAddress)
	if err != nil {
		t.Fatal(err)
	}
	if got := pubSHA(kp.PublicKey); got != katRecoveryPubSHA {
		t.Errorf("sha256(pqc pub) = %s, want %s", got, katRecoveryPubSHA)
	}
	// Without the prefix, and with underscores and dots.
	bare := strings.ReplaceAll(strings.TrimPrefix(katRecoveryCode, "QRC1-"), "-", "_.")
	if !IsValidRecoveryCode(bare) {
		t.Errorf("code without prefix %q rejected", bare)
	}
}

func TestRecoveryCodeRejects(t *testing.T) {
	// One changed character: checksum error.
	b := []byte(katRecoveryCode)
	i := len("QRC1-") + 1 // the 'W' of the first group
	b[i] = 'X'
	_, err := PQCKeyFromRecoveryCode(string(b), katSeedAddress)
	if err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Errorf("one changed character: err = %v, want a checksum error", err)
	}
	if IsValidRecoveryCode(string(b)) {
		t.Error("IsValidRecoveryCode accepted a changed code")
	}
	// U is not in the alphabet.
	u := []byte(katRecoveryCode)
	u[i] = 'U'
	if IsValidRecoveryCode(string(u)) {
		t.Error("code with U accepted")
	}
	// Bad character and bad length.
	bad := []byte(katRecoveryCode)
	bad[i] = '*'
	if IsValidRecoveryCode(string(bad)) {
		t.Error("code with * accepted")
	}
	if IsValidRecoveryCode(katRecoveryCode[:len(katRecoveryCode)-1]) {
		t.Error("short code accepted")
	}
	if IsValidRecoveryCode("") {
		t.Error("empty code accepted")
	}
	// The address must be a qor1 bech32 address.
	for _, addr := range []string{"", "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", "cosmos1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj", "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zak"} {
		if _, err := PQCKeyFromRecoveryCode(katRecoveryCode, addr); err == nil {
			t.Errorf("address %q accepted", addr)
		}
	}
}

func TestGeneratePQCRecoveryCode(t *testing.T) {
	a, err := GeneratePQCRecoveryCode()
	if err != nil {
		t.Fatal(err)
	}
	b, err := GeneratePQCRecoveryCode()
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Error("two generated codes are equal")
	}
	for _, c := range []string{a, b} {
		if !strings.HasPrefix(c, "QRC1-") || len(c) != 5+14*4+13 {
			t.Errorf("unexpected code shape %q", c)
		}
		if !IsValidRecoveryCode(c) {
			t.Errorf("generated code %q is not valid", c)
		}
	}
}
