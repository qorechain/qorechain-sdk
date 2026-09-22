package messages

import (
	"fmt"

	"cosmossdk.io/math"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/address"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
)

// Bounds of the EVM authorisation window, mirroring the chain's x/pqc
// ValidateBasic (chain v3.2.0). Every field of MsgOpenEVMWindow is required:
// the chain refuses a missing field rather than defaulting it.
const (
	// MaxEVMWindowBlocks is the largest lifetime a window may be opened for.
	//
	// The chain constant is documented as "about 24 hours at 5s blocks", but no
	// QoreChain network runs at 5s: the testnet produces a block about every
	// 1.03s (17280 blocks ≈ 5 hours) and mainnet about every 3.1s (≈ 15 hours).
	// Do NOT present this bound to a user as "24 hours" — say "up to 17280
	// blocks", or compute the duration from the chain's recent block time.
	MaxEVMWindowBlocks uint64 = 17280
	// MaxEVMWindowTxs is the largest number of EVM transactions a window may
	// admit. Zero is refused: a window that admits nothing is a mistake, not a
	// policy.
	MaxEVMWindowTxs uint64 = 1000
)

// ValidateOpenEVMWindow mirrors the chain's ValidateBasic for MsgOpenEVMWindow
// so a caller fails fast, locally, with a message naming the bound it broke
// instead of paying for a transaction the chain refuses.
//
// Checked: sender is a valid `qor` bech32 address; blocks is in 1..17280;
// max_txs is in 1..1000; max_value is set and strictly positive.
func ValidateOpenEVMWindow(msg *pqcv1.MsgOpenEVMWindow) error {
	if msg == nil {
		return fmt.Errorf("open evm window: message is nil")
	}
	if err := validateWindowSender(msg.Sender); err != nil {
		return err
	}
	if msg.Blocks == 0 || msg.Blocks > MaxEVMWindowBlocks {
		return fmt.Errorf("open evm window: blocks must be between 1 and %d (MaxEVMWindowBlocks), got %d", MaxEVMWindowBlocks, msg.Blocks)
	}
	if msg.MaxTxs == 0 || msg.MaxTxs > MaxEVMWindowTxs {
		return fmt.Errorf("open evm window: max_txs must be between 1 and %d (MaxEVMWindowTxs), got %d", MaxEVMWindowTxs, msg.MaxTxs)
	}
	if msg.MaxValue.IsNil() {
		return fmt.Errorf("open evm window: max_value is required (an integer amount of uqor greater than 0)")
	}
	if !msg.MaxValue.IsPositive() {
		return fmt.Errorf("open evm window: max_value must be greater than 0 uqor, got %s", msg.MaxValue.String())
	}
	return nil
}

// ValidateCloseEVMWindow mirrors the chain's ValidateBasic for
// MsgCloseEVMWindow: the sender must be a valid `qor` bech32 address.
func ValidateCloseEVMWindow(msg *pqcv1.MsgCloseEVMWindow) error {
	if msg == nil {
		return fmt.Errorf("close evm window: message is nil")
	}
	if err := validateWindowSender(msg.Sender); err != nil {
		return err
	}
	return nil
}

func validateWindowSender(sender string) error {
	if sender == "" {
		return fmt.Errorf("evm window: sender is required")
	}
	if !address.IsValidBech32(sender, "qor") {
		return fmt.Errorf("evm window: sender %q is not a valid qor bech32 address", sender)
	}
	return nil
}

// NewOpenEVMWindow builds a validated MsgOpenEVMWindow. maxValue is an integer
// amount of uqor as a decimal string (it is a cosmos.Int on the wire, so it is
// never parsed through a float).
//
// It bounds the transferred value PLUS the maximum fee each admitted
// transaction could pay (gas limit × gas fee cap), because the holder of the
// classical key sets the gas price: measured on the testnet, a 1,000 uqor
// transfer with a 21,000 gas limit at 112.5 gwei consumed 3,363 uqor of the
// window. wei→uqor rounds UP.
//
// Opening a window REPLACES any window the account already has, and — because
// QoreChain unifies the identity — it advances the account sequence, which is
// also the EVM nonce. Open the window, THEN read the nonce, THEN sign the EVM
// transaction; the other order gives "nonce too low".
func NewOpenEVMWindow(sender string, blocks, maxTxs uint64, maxValue string) (*pqcv1.MsgOpenEVMWindow, error) {
	if maxValue == "" {
		return nil, fmt.Errorf("open evm window: max_value is required (an integer amount of uqor greater than 0)")
	}
	value, ok := math.NewIntFromString(maxValue)
	if !ok {
		return nil, fmt.Errorf("open evm window: max_value %q is not an integer amount of uqor", maxValue)
	}
	msg := Pqc.OpenEVMWindow(sender, blocks, maxTxs, value)
	if err := ValidateOpenEVMWindow(msg); err != nil {
		return nil, err
	}
	return msg, nil
}

// NewCloseEVMWindow builds a validated MsgCloseEVMWindow. Closing takes effect
// in the same block.
func NewCloseEVMWindow(sender string) (*pqcv1.MsgCloseEVMWindow, error) {
	msg := Pqc.CloseEVMWindow(sender)
	if err := ValidateCloseEVMWindow(msg); err != nil {
		return nil, err
	}
	return msg, nil
}
