package messages

import (
	"strings"
	"testing"

	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"

	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
)

const windowSender = "qor1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5tfman7"

// TestOpenEVMWindowRoundTrip packs a populated MsgOpenEVMWindow into an Any and
// decodes it back through the registry: the type URL, the encoded bytes and
// every field (including the cosmos.Int max_value) must survive.
func TestOpenEVMWindowRoundTrip(t *testing.T) {
	original, err := NewOpenEVMWindow(windowSender, 300, 5, "2000000")
	if err != nil {
		t.Fatalf("new open evm window: %v", err)
	}

	any, err := PackAny(original)
	if err != nil {
		t.Fatalf("pack any: %v", err)
	}
	if any.TypeUrl != "/qorechain.pqc.v1.MsgOpenEVMWindow" {
		t.Fatalf("unexpected type URL: %s", any.TypeUrl)
	}
	encoded, err := original.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(any.Value) != string(encoded) {
		t.Fatalf("packed bytes differ from the message's own encoding")
	}

	var decodedMsg sdk.Msg
	if err := DefaultProtoCodec().UnpackAny(any, &decodedMsg); err != nil {
		t.Fatalf("unpack any: %v", err)
	}
	decoded, ok := decodedMsg.(*pqcv1.MsgOpenEVMWindow)
	if !ok {
		t.Fatalf("decoded to %T, want *pqcv1.MsgOpenEVMWindow", decodedMsg)
	}
	if decoded.Sender != original.Sender || decoded.Blocks != 300 || decoded.MaxTxs != 5 {
		t.Fatalf("field mismatch: %+v", decoded)
	}
	if !decoded.MaxValue.Equal(math.NewInt(2000000)) {
		t.Fatalf("max_value mismatch: got %s", decoded.MaxValue)
	}
}

// TestCloseEVMWindowRoundTrip does the same for MsgCloseEVMWindow.
func TestCloseEVMWindowRoundTrip(t *testing.T) {
	original, err := NewCloseEVMWindow(windowSender)
	if err != nil {
		t.Fatalf("new close evm window: %v", err)
	}
	any, err := PackAny(original)
	if err != nil {
		t.Fatalf("pack any: %v", err)
	}
	if any.TypeUrl != "/qorechain.pqc.v1.MsgCloseEVMWindow" {
		t.Fatalf("unexpected type URL: %s", any.TypeUrl)
	}
	encoded, err := original.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(any.Value) != string(encoded) {
		t.Fatalf("packed bytes differ from the message's own encoding")
	}
	var decodedMsg sdk.Msg
	if err := DefaultProtoCodec().UnpackAny(any, &decodedMsg); err != nil {
		t.Fatalf("unpack any: %v", err)
	}
	decoded, ok := decodedMsg.(*pqcv1.MsgCloseEVMWindow)
	if !ok {
		t.Fatalf("decoded to %T, want *pqcv1.MsgCloseEVMWindow", decodedMsg)
	}
	if decoded.Sender != windowSender {
		t.Fatalf("sender mismatch: %s", decoded.Sender)
	}
}

// TestOpenEVMWindowBounds walks the chain's ValidateBasic bounds. Each refusal
// must name the bound it broke.
func TestOpenEVMWindowBounds(t *testing.T) {
	cases := []struct {
		name     string
		blocks   uint64
		maxTxs   uint64
		maxValue string
		wantIn   string
	}{
		{"blocks zero", 0, 5, "1000", "blocks must be between 1 and 17280"},
		{"blocks over max", MaxEVMWindowBlocks + 1, 5, "1000", "blocks must be between 1 and 17280"},
		{"max_txs zero", 300, 0, "1000", "max_txs must be between 1 and 1000"},
		{"max_txs over max", 300, MaxEVMWindowTxs + 1, "1000", "max_txs must be between 1 and 1000"},
		{"max_value zero", 300, 5, "0", "max_value must be greater than 0 uqor"},
		{"max_value negative", 300, 5, "-1", "max_value must be greater than 0 uqor"},
		{"max_value missing", 300, 5, "", "max_value is required"},
		{"max_value not an integer", 300, 5, "1.5", "not an integer amount of uqor"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			msg, err := NewOpenEVMWindow(windowSender, tc.blocks, tc.maxTxs, tc.maxValue)
			if err == nil {
				t.Fatalf("expected a refusal, got message %+v", msg)
			}
			if !strings.Contains(err.Error(), tc.wantIn) {
				t.Fatalf("error %q does not name the bound %q", err, tc.wantIn)
			}
		})
	}
}

// TestOpenEVMWindowAcceptsTheBoundsThemselves proves the bounds are inclusive.
func TestOpenEVMWindowAcceptsTheBoundsThemselves(t *testing.T) {
	for _, tc := range []struct {
		blocks uint64
		maxTxs uint64
	}{
		{1, 1},
		{MaxEVMWindowBlocks, MaxEVMWindowTxs},
	} {
		if _, err := NewOpenEVMWindow(windowSender, tc.blocks, tc.maxTxs, "1"); err != nil {
			t.Fatalf("blocks=%d max_txs=%d refused: %v", tc.blocks, tc.maxTxs, err)
		}
	}
}

// TestEVMWindowSenderRequired covers the sender checks on both messages.
func TestEVMWindowSenderRequired(t *testing.T) {
	if _, err := NewOpenEVMWindow("", 300, 5, "1000"); err == nil ||
		!strings.Contains(err.Error(), "sender is required") {
		t.Fatalf("empty sender: got %v", err)
	}
	if _, err := NewOpenEVMWindow("qor1nope", 300, 5, "1000"); err == nil ||
		!strings.Contains(err.Error(), "not a valid qor bech32 address") {
		t.Fatalf("bad sender: got %v", err)
	}
	if _, err := NewCloseEVMWindow("cosmos1xyz"); err == nil ||
		!strings.Contains(err.Error(), "not a valid qor bech32 address") {
		t.Fatalf("wrong-prefix sender: got %v", err)
	}
}

// TestValidateOpenEVMWindowRejectsUnsetMaxValue proves the nil cosmos.Int (the
// zero value of math.Int, which is not the same as zero) is refused rather than
// panicking.
func TestValidateOpenEVMWindowRejectsUnsetMaxValue(t *testing.T) {
	msg := &pqcv1.MsgOpenEVMWindow{Sender: windowSender, Blocks: 300, MaxTxs: 5}
	err := ValidateOpenEVMWindow(msg)
	if err == nil || !strings.Contains(err.Error(), "max_value is required") {
		t.Fatalf("expected a max_value refusal, got %v", err)
	}
}

// TestPqcComposersBuildWindowMessages checks the plain composers (no validation)
// are wired into the pqc group like every other pqc message.
func TestPqcComposersBuildWindowMessages(t *testing.T) {
	open := Pqc.OpenEVMWindow(windowSender, 17280, 1000, math.NewInt(7))
	if open.Sender != windowSender || open.Blocks != 17280 || open.MaxTxs != 1000 || !open.MaxValue.Equal(math.NewInt(7)) {
		t.Fatalf("open composer mismatch: %+v", open)
	}
	closeMsg := Pqc.CloseEVMWindow(windowSender)
	if closeMsg.Sender != windowSender {
		t.Fatalf("close composer mismatch: %+v", closeMsg)
	}
}
