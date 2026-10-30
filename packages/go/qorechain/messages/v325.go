package messages

import (
	"fmt"
	"strings"

	"cosmossdk.io/math"
	"github.com/cosmos/cosmos-sdk/types/bech32"

	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
	rdkv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/rdk/v1"
)

// Messages added by chain v3.2.5 (plan query.ChainUpgradeV3_2_5). A node
// below v3.2.5 does not know them and refuses the transaction.

// ---------------------------------------------------------------------------
// KEM key registry (x/pqc)
// ---------------------------------------------------------------------------

// An account publishes one key-encapsulation public key so that anyone can
// encrypt to it. It is not an authentication key: the account keeps signing
// with its ML-DSA-87 key, and MsgRegisterKEMKey / MsgRemoveKEMKey always need
// the account's verified hybrid signature (they are never sent classical).
// There is no proof of possession: the hybrid signature authenticates the
// registration. Sending a key again replaces it (the response reports
// replaced). The SDK only carries the chain messages; encrypting to a key is
// up to the application.
const (
	// KEMAlgorithmMLKEM1024 is the algorithm id of ML-KEM-1024 (FIPS 203),
	// the key-encapsulation algorithm the chain registry accepts.
	KEMAlgorithmMLKEM1024 pqcv1.AlgorithmID = 2
	// MLKEM1024PublicKeySize is the size of an ML-KEM-1024 encapsulation key.
	MLKEM1024PublicKeySize = 1568

	mlkemQ          = 3329
	mlkem1024THatSz = 1536 // 4 polynomials of 384 bytes; the last 32 bytes are rho
)

// ValidateKEMPublicKey mirrors the chain's stateless check for an ML-KEM-1024
// key: exactly MLKEM1024PublicKeySize bytes, every 12-bit coefficient of t_hat
// below q = 3329 (the FIPS 203 modulus check), and t_hat not all zero (a key
// anyone could read). Algorithm 0 is refused and algorithm 1 (ML-DSA-87, a
// signature algorithm) too; other ids pass through for the chain's registry to
// decide.
func ValidateKEMPublicKey(algorithmID pqcv1.AlgorithmID, publicKey []byte) error {
	switch algorithmID {
	case 0:
		return fmt.Errorf("kem key: algorithm_id is required (ML-KEM-1024 is %d)", KEMAlgorithmMLKEM1024)
	case 1:
		return fmt.Errorf("kem key: algorithm 1 (ML-DSA-87) is a signature algorithm; KEM keys use ML-KEM-1024 (%d)", KEMAlgorithmMLKEM1024)
	case KEMAlgorithmMLKEM1024:
	default:
		if len(publicKey) == 0 {
			return fmt.Errorf("kem key: public key is required")
		}
		return nil
	}
	if len(publicKey) != MLKEM1024PublicKeySize {
		return fmt.Errorf("kem key: an ML-KEM-1024 public key is %d bytes, got %d", MLKEM1024PublicKeySize, len(publicKey))
	}
	zero := true
	for i := 0; i < mlkem1024THatSz; i += 3 {
		c0 := uint16(publicKey[i]) | uint16(publicKey[i+1]&0x0f)<<8
		c1 := uint16(publicKey[i+1]>>4) | uint16(publicKey[i+2])<<4
		if c0 >= mlkemQ || c1 >= mlkemQ {
			return fmt.Errorf("kem key: coefficient at byte %d is not reduced modulo %d (fails the FIPS 203 encapsulation key check)", i, mlkemQ)
		}
		if c0 != 0 || c1 != 0 {
			zero = false
		}
	}
	if zero {
		return fmt.Errorf("kem key: the key's t_hat part is all zero, so anything encrypted to it is readable by anyone")
	}
	return nil
}

// NewRegisterKEMKey builds a checked MsgRegisterKEMKey publishing publicKey
// (ML-KEM-1024, KEMAlgorithmMLKEM1024) for sender. Send it hybrid-signed.
func NewRegisterKEMKey(sender string, publicKey []byte) (*pqcv1.MsgRegisterKEMKey, error) {
	return NewRegisterKEMKeyWithAlgorithm(sender, KEMAlgorithmMLKEM1024, publicKey)
}

// NewRegisterKEMKeyWithAlgorithm is NewRegisterKEMKey for an explicit
// algorithm id (a later KEM added to the chain registry by governance).
func NewRegisterKEMKeyWithAlgorithm(sender string, algorithmID pqcv1.AlgorithmID, publicKey []byte) (*pqcv1.MsgRegisterKEMKey, error) {
	if sender == "" {
		return nil, fmt.Errorf("kem key: sender is required")
	}
	if err := ValidateKEMPublicKey(algorithmID, publicKey); err != nil {
		return nil, err
	}
	return Pqc.RegisterKEMKey(sender, publicKey, algorithmID), nil
}

// RegisterKEMKey builds MsgRegisterKEMKey without checking it. Prefer
// NewRegisterKEMKey. Needs chain v3.2.5 and the hybrid signature.
func (PqcComposers) RegisterKEMKey(sender string, publicKey []byte, algorithmID pqcv1.AlgorithmID) *pqcv1.MsgRegisterKEMKey {
	return &pqcv1.MsgRegisterKEMKey{Sender: sender, AlgorithmID: algorithmID, PublicKey: publicKey}
}

// RemoveKEMKey builds MsgRemoveKEMKey, withdrawing the sender's published KEM
// key. Needs chain v3.2.5 and the hybrid signature.
func (PqcComposers) RemoveKEMKey(sender string) *pqcv1.MsgRemoveKEMKey {
	return &pqcv1.MsgRemoveKEMKey{Sender: sender}
}

// ---------------------------------------------------------------------------
// Spending rules: EVM token denoms (x/abstractaccount)
// ---------------------------------------------------------------------------

// evmDenomPrefixes are the token denoms whose contract address the chain
// parses when a spending rule is saved (v3.2.5).
var evmDenomPrefixes = []string{"erc20/", "erc721/", "erc1155/"}

// ValidateEVMDenom mirrors the chain's v3.2.5 save-time check on a spending
// rule's denoms: a denom starting (in any case) with erc20/, erc721/ or
// erc1155/ must continue with a 0x-prefixed 20-byte contract address; an
// erc721/ or erc1155/ denom may carry a "/<token id>" tail, an erc20/ denom
// may not. Other denoms pass. The chain refuses a failing rule with
// abstractaccount code 8 (invalid spending rule).
func ValidateEVMDenom(denom string) error {
	lower := strings.ToLower(denom)
	for _, p := range evmDenomPrefixes {
		if !strings.HasPrefix(lower, p) {
			continue
		}
		rest := denom[len(p):]
		addr, tail := rest, ""
		if i := strings.IndexByte(rest, '/'); i >= 0 {
			addr, tail = rest[:i], rest[i:]
		}
		if !isHexAddress0x(addr) {
			return fmt.Errorf("denom %q: %s must be followed by a 0x-prefixed 20-byte contract address", denom, p)
		}
		if p == "erc20/" && tail != "" {
			return fmt.Errorf("denom %q: an erc20/ denom is the contract address alone", denom)
		}
		return nil
	}
	return nil
}

func isHexAddress0x(s string) bool {
	if len(s) != 42 || (s[:2] != "0x" && s[:2] != "0X") {
		return false
	}
	for _, c := range s[2:] {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// Governance: abstractaccount config, crossvm and rdk parameters
// ---------------------------------------------------------------------------

// UpdateConfig builds MsgUpdateConfig without checking it. It replaces the
// abstractaccount configuration wholesale (copy the current values from
// GET /qorechain/abstractaccount/v1/config and change only what you mean to).
// authority must be the governance module account, so it only executes from a
// passed proposal. Prefer NewUpdateConfig.
func (AbstractAccountComposers) UpdateConfig(authority string, enabled bool, maxSessionKeys, maxSpendingRules int32, defaultSessionTTL int64) *abstractaccountv1.MsgUpdateConfig {
	return &abstractaccountv1.MsgUpdateConfig{
		Authority:         authority,
		Enabled:           enabled,
		MaxSessionKeys:    maxSessionKeys,
		MaxSpendingRules:  maxSpendingRules,
		DefaultSessionTtl: defaultSessionTTL,
	}
}

// NewUpdateConfig builds MsgUpdateConfig after the chain's checks: authority
// set, and max_session_keys, max_spending_rules and default_session_ttl
// (seconds) positive.
func NewUpdateConfig(authority string, enabled bool, maxSessionKeys, maxSpendingRules int32, defaultSessionTTL int64) (*abstractaccountv1.MsgUpdateConfig, error) {
	switch {
	case authority == "":
		return nil, fmt.Errorf("update config: authority is required")
	case maxSessionKeys <= 0:
		return nil, fmt.Errorf("update config: max_session_keys must be positive, got %d", maxSessionKeys)
	case maxSpendingRules <= 0:
		return nil, fmt.Errorf("update config: max_spending_rules must be positive, got %d", maxSpendingRules)
	case defaultSessionTTL <= 0:
		return nil, fmt.Errorf("update config: default_session_ttl must be positive, got %d", defaultSessionTTL)
	}
	return AbstractAccount.UpdateConfig(authority, enabled, maxSessionKeys, maxSpendingRules, defaultSessionTTL), nil
}

// Crossvm parameter bounds a governance update must respect (chain
// ValidateUpdate).
const (
	CrossVMMaxUpdateMessageSize       uint64 = 1 << 20
	CrossVMMaxUpdateQueueSize         uint32 = 10_000
	CrossVMMaxUpdateQueueTimeout      int64  = 100_000
	CrossVMMaxBridgeAllowedTargets           = 64
	CrossVMMaxBridgeAllowedTargetSize        = 256
)

// UpdateParams builds crossvm MsgUpdateParams without checking it. It replaces
// every crossvm parameter at once, among them bridge_allowed_targets (each
// "<vm>:<contract>"; empty keeps the EVM bridge precompile shut). Governance
// only. Prefer NewCrossVMUpdateParams.
func (CrossVMComposers) UpdateParams(authority string, maxMessageSize uint64, maxQueueSize uint32, queueTimeoutBlocks int64, enabled bool, bridgeAllowedTargets []string) *crossvmv1.MsgUpdateParams {
	return &crossvmv1.MsgUpdateParams{
		Authority:            authority,
		MaxMessageSize:       maxMessageSize,
		MaxQueueSize:         maxQueueSize,
		QueueTimeoutBlocks:   queueTimeoutBlocks,
		Enabled:              enabled,
		BridgeAllowedTargets: bridgeAllowedTargets,
	}
}

// NewCrossVMUpdateParams builds crossvm MsgUpdateParams after the chain's
// checks: positive limits under their ceilings, at most 64 bridge targets, no
// duplicates, each "cosmwasm:<qor1... contract address>" (the bridge only
// calls CosmWasm contracts).
func NewCrossVMUpdateParams(authority string, maxMessageSize uint64, maxQueueSize uint32, queueTimeoutBlocks int64, enabled bool, bridgeAllowedTargets []string) (*crossvmv1.MsgUpdateParams, error) {
	switch {
	case authority == "":
		return nil, fmt.Errorf("crossvm update params: authority is required")
	case maxMessageSize == 0 || maxMessageSize > CrossVMMaxUpdateMessageSize:
		return nil, fmt.Errorf("crossvm update params: max_message_size must be 1..%d, got %d", CrossVMMaxUpdateMessageSize, maxMessageSize)
	case maxQueueSize == 0 || maxQueueSize > CrossVMMaxUpdateQueueSize:
		return nil, fmt.Errorf("crossvm update params: max_queue_size must be 1..%d, got %d", CrossVMMaxUpdateQueueSize, maxQueueSize)
	case queueTimeoutBlocks <= 0 || queueTimeoutBlocks > CrossVMMaxUpdateQueueTimeout:
		return nil, fmt.Errorf("crossvm update params: queue_timeout_blocks must be 1..%d, got %d", CrossVMMaxUpdateQueueTimeout, queueTimeoutBlocks)
	case len(bridgeAllowedTargets) > CrossVMMaxBridgeAllowedTargets:
		return nil, fmt.Errorf("crossvm update params: at most %d bridge targets, got %d", CrossVMMaxBridgeAllowedTargets, len(bridgeAllowedTargets))
	}
	seen := make(map[string]bool, len(bridgeAllowedTargets))
	for _, entry := range bridgeAllowedTargets {
		if len(entry) > CrossVMMaxBridgeAllowedTargetSize {
			return nil, fmt.Errorf("crossvm update params: bridge target %q is longer than %d bytes", entry, CrossVMMaxBridgeAllowedTargetSize)
		}
		if seen[entry] {
			return nil, fmt.Errorf("crossvm update params: bridge target %q is listed twice", entry)
		}
		seen[entry] = true
		vm, contract, ok := strings.Cut(entry, ":")
		if !ok || vm != "cosmwasm" {
			return nil, fmt.Errorf("crossvm update params: bridge target %q must be cosmwasm:<contract> (the bridge only calls CosmWasm contracts)", entry)
		}
		if hrp, _, err := bech32.DecodeAndConvert(contract); err != nil || hrp != "qor" {
			return nil, fmt.Errorf("crossvm update params: bridge target %q: the contract is not a qor1... address", entry)
		}
	}
	return CrossVM.UpdateParams(authority, maxMessageSize, maxQueueSize, queueTimeoutBlocks, enabled, bridgeAllowedTargets), nil
}

// RdkParams are the rdk module parameters, as MsgUpdateParams carries them.
type RdkParams struct {
	MaxRollups uint32
	// MinStakeForRollup is a uqor amount.
	MinStakeForRollup int64
	// RollupCreationBurnRate is a decimal in [0, 1), for example "0.01".
	RollupCreationBurnRate string
	// DefaultChallengeWindow is in seconds (60 to 30 days).
	DefaultChallengeWindow uint64
	MaxDABlobSize          uint64
	BlobRetentionBlocks    uint64
	MaxBatchesPerBlock     uint32
}

// Rdk parameter bounds (chain ValidateUpdate).
const (
	RdkMinChallengeWindowSec uint64 = 60
	RdkMaxChallengeWindowSec uint64 = 30 * 24 * 3600
	RdkMaxDABlobSizeLimit    uint64 = 8 << 20
)

// UpdateParams builds rdk MsgUpdateParams without checking it. It replaces the
// rdk parameters wholesale; governance only. Prefer NewRdkUpdateParams.
func (RdkComposers) UpdateParams(authority string, p RdkParams) *rdkv1.MsgUpdateParams {
	return &rdkv1.MsgUpdateParams{
		Authority:              authority,
		MaxRollups:             p.MaxRollups,
		MinStakeForRollup:      p.MinStakeForRollup,
		RollupCreationBurnRate: p.RollupCreationBurnRate,
		DefaultChallengeWindow: p.DefaultChallengeWindow,
		MaxDaBlobSize:          p.MaxDABlobSize,
		BlobRetentionBlocks:    p.BlobRetentionBlocks,
		MaxBatchesPerBlock:     p.MaxBatchesPerBlock,
	}
}

// NewRdkUpdateParams builds rdk MsgUpdateParams after the chain's checks.
func NewRdkUpdateParams(authority string, p RdkParams) (*rdkv1.MsgUpdateParams, error) {
	if authority == "" {
		return nil, fmt.Errorf("rdk update params: authority is required")
	}
	if p.MaxRollups == 0 {
		return nil, fmt.Errorf("rdk update params: max_rollups must be positive")
	}
	if p.MinStakeForRollup <= 0 {
		return nil, fmt.Errorf("rdk update params: min_stake_for_rollup must be positive")
	}
	rate, err := math.LegacyNewDecFromStr(p.RollupCreationBurnRate)
	if err != nil || rate.IsNegative() || rate.GTE(math.LegacyOneDec()) {
		return nil, fmt.Errorf("rdk update params: rollup_creation_burn_rate must be a decimal in [0, 1), got %q", p.RollupCreationBurnRate)
	}
	if p.DefaultChallengeWindow < RdkMinChallengeWindowSec || p.DefaultChallengeWindow > RdkMaxChallengeWindowSec {
		return nil, fmt.Errorf("rdk update params: default_challenge_window must be %d..%d seconds, got %d",
			RdkMinChallengeWindowSec, RdkMaxChallengeWindowSec, p.DefaultChallengeWindow)
	}
	if p.MaxDABlobSize == 0 || p.MaxDABlobSize > RdkMaxDABlobSizeLimit {
		return nil, fmt.Errorf("rdk update params: max_da_blob_size must be 1..%d bytes, got %d", RdkMaxDABlobSizeLimit, p.MaxDABlobSize)
	}
	if p.BlobRetentionBlocks == 0 {
		return nil, fmt.Errorf("rdk update params: blob_retention_blocks must be positive")
	}
	if p.MaxBatchesPerBlock == 0 {
		return nil, fmt.Errorf("rdk update params: max_batches_per_block must be positive")
	}
	return Rdk.UpdateParams(authority, p), nil
}
