package messages

import (
	"fmt"
	"strings"

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
	// Do NOT present this bound to a user as "24 hours" - say "up to 17280
	// blocks", or compute the duration from the chain's recent block time.
	MaxEVMWindowBlocks uint64 = 17280
	// MaxEVMWindowTxs is the largest number of EVM transactions a window may
	// admit. Zero is refused: a window that admits nothing is a mistake, not a
	// policy.
	MaxEVMWindowTxs uint64 = 1000
	// MaxEVMWindowTargets is the most allowed_targets one window may list
	// (chain v3.2.3).
	MaxEVMWindowTargets = 16
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
	if len(msg.AllowedTargets) > MaxEVMWindowTargets {
		return fmt.Errorf("open evm window: allowed_targets lists %d addresses, the maximum is %d", len(msg.AllowedTargets), MaxEVMWindowTargets)
	}
	seen := make(map[string]bool, len(msg.AllowedTargets))
	for _, t := range msg.AllowedTargets {
		if !evmAddress.MatchString(t) {
			return fmt.Errorf("open evm window: allowed_targets: %q is not a 0x-prefixed 20-byte address", t)
		}
		if seen[strings.ToLower(t)] {
			return fmt.Errorf("open evm window: allowed_targets lists %s more than once", t)
		}
		seen[strings.ToLower(t)] = true
	}
	return validateWindowScope(msg)
}

// validateWindowScope checks the v3.2.8 fields 7..9 lightly: validators are
// 0x 20-byte addresses, staking_validators qorvaloper bech32 addresses, and
// ibc_receivers "<source channel>/<receiver>" with a channel-N prefix. No
// duplicates in any list.
func validateWindowScope(msg *pqcv1.MsgOpenEVMWindow) error {
	check := func(field string, list []string, ok func(string) error) error {
		seen := make(map[string]bool, len(list))
		for _, v := range list {
			if err := ok(v); err != nil {
				return fmt.Errorf("open evm window: %s: %w", field, err)
			}
			k := strings.ToLower(v)
			if seen[k] {
				return fmt.Errorf("open evm window: %s lists %s more than once", field, v)
			}
			seen[k] = true
		}
		return nil
	}
	if err := check("validators", msg.Validators, func(v string) error {
		if !evmAddress.MatchString(v) {
			return fmt.Errorf("%q is not a 0x-prefixed 20-byte contract address", v)
		}
		return nil
	}); err != nil {
		return err
	}
	if err := check("staking_validators", msg.StakingValidators, func(v string) error {
		if !address.IsValidBech32(v, "qorvaloper") {
			return fmt.Errorf("%q is not a qorvaloper bech32 address", v)
		}
		return nil
	}); err != nil {
		return err
	}
	return check("ibc_receivers", msg.IbcReceivers, func(v string) error {
		// The chain's ParseIBCReceiver: 1 to 256 characters, no whitespace or
		// comma, a "/" with text on both sides.
		i := strings.IndexByte(v, '/')
		if len(v) == 0 || len(v) > 256 || strings.ContainsAny(v, " \t\r\n,") || i <= 0 || i == len(v)-1 {
			return fmt.Errorf("%q is not \"<source channel>/<receiver>\" (for example channel-0/cosmos1...)", v)
		}
		return nil
	})
}

// EVMWindowScope narrows what an EVM authorisation window admits.
//
// Standard precompile methods are deny-by-default through a window (chain
// v3.2.8): staking delegate and redelegate need the validator listed in
// StakingValidators, an ICS-20 transfer needs its "<channel>/<receiver>" in
// IBCReceivers. Undelegate, governance votes and withdraw-address changes are
// refused through a window whatever it lists: send them as a PQC-signed Cosmos
// transaction. Rotating, migrating or re-registering the PQC key closes the
// window.
type EVMWindowScope struct {
	// NativeOnly admits plain native transfers only (v3.2.3).
	NativeOnly bool
	// AllowedTargets limits recipients/contracts to these 0x addresses, at most
	// 16 (v3.2.3).
	AllowedTargets []string
	// Validators lists 0x 20-byte contract addresses (field 7, v3.2.8).
	Validators []string
	// StakingValidators lists qorvaloper... addresses staking delegate and
	// redelegate may use (field 8, v3.2.8).
	StakingValidators []string
	// IBCReceivers lists "<source channel>/<receiver>" pairs ICS-20 may send
	// to, for example "channel-0/cosmos1..." (field 9, v3.2.8).
	IBCReceivers []string
}

// NewOpenEVMWindowWithScope builds a validated MsgOpenEVMWindow with every
// scope field. The v3.2.8 fields (Validators, StakingValidators,
// IBCReceivers) make a node below v3.2.8 refuse the transaction, so set them
// only once the network has applied v3.2.8.
func NewOpenEVMWindowWithScope(sender string, blocks, maxTxs uint64, maxValue string, scope EVMWindowScope) (*pqcv1.MsgOpenEVMWindow, error) {
	msg, err := NewOpenEVMWindow(sender, blocks, maxTxs, maxValue)
	if err != nil {
		return nil, err
	}
	msg.NativeOnly = scope.NativeOnly
	msg.AllowedTargets = scope.AllowedTargets
	msg.Validators = scope.Validators
	msg.StakingValidators = scope.StakingValidators
	msg.IbcReceivers = scope.IBCReceivers
	if err := ValidateOpenEVMWindow(msg); err != nil {
		return nil, err
	}
	return msg, nil
}

// NewOpenEVMWindowScoped builds a validated MsgOpenEVMWindow narrowed to plain
// native transfers (nativeOnly) and/or to the recipients in allowedTargets (at
// most 16), chain v3.2.3. Both are new fields: a node below v3.2.3 refuses the
// whole transaction when either is set, so use this only once the network has
// applied v3.2.3 (query.RestClient.RequireUpgradeApplied).
func NewOpenEVMWindowScoped(sender string, blocks, maxTxs uint64, maxValue string, nativeOnly bool, allowedTargets []string) (*pqcv1.MsgOpenEVMWindow, error) {
	msg, err := NewOpenEVMWindow(sender, blocks, maxTxs, maxValue)
	if err != nil {
		return nil, err
	}
	msg.NativeOnly = nativeOnly
	msg.AllowedTargets = allowedTargets
	if err := ValidateOpenEVMWindow(msg); err != nil {
		return nil, err
	}
	return msg, nil
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
// Opening a window REPLACES any window the account already has, and - because
// QoreChain unifies the identity - it advances the account sequence, which is
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
