package messages

import (
	"fmt"
	"reflect"
	"strings"

	"cosmossdk.io/math"
	"github.com/cosmos/cosmos-sdk/types/bech32"

	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	rdkv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/rdk/v1"
	svmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/svm/v1"
)

// Governance parameter updates for crossvm, svm and rdk (chain v3.2.8).
//
// Each MsgUpdateParams replaces the module parameters WHOLESALE: a field the
// message leaves out is set to zero on the chain. From chain v3.2.8 a zero
// clears real settings (the crossvm bridge target pins, the svm custody
// ceilings, the rdk posted-data limits), so the composers below take every
// field as a pointer and refuse a message with any field left nil, naming the
// missing fields. A zero given explicitly (Ptr(uint64(0))) is accepted unless a
// check says otherwise.
//
// The way to build a parameter proposal is to start from the values in force
// and change only what you mean to: CrossVMUpdateParamsFromCurrent,
// SvmUpdateParamsFromCurrent and RdkUpdateParamsFromCurrent read the current
// parameters over REST (a *query.RestClient satisfies the reader interfaces)
// and apply the non-nil fields of changes on top.

// Ptr returns a pointer to v. Use it to fill the parameter structs:
// messages.Ptr(uint64(65536)).
func Ptr[T any](v T) *T { return &v }

// missingParams lists the `param` tag of every nil pointer field of p (a
// struct value).
func missingParams(p any) []string {
	v := reflect.ValueOf(p)
	t := v.Type()
	var out []string
	for i := 0; i < t.NumField(); i++ {
		if v.Field(i).Kind() == reflect.Pointer && v.Field(i).IsNil() {
			out = append(out, t.Field(i).Tag.Get("param"))
		}
	}
	return out
}

// mergeParams returns base with every non-nil pointer field of changes copied
// over it. base and changes are the same struct type.
func mergeParams[T any](base, changes T) T {
	out := base
	ov := reflect.ValueOf(&out).Elem()
	cv := reflect.ValueOf(changes)
	for i := 0; i < cv.NumField(); i++ {
		if f := cv.Field(i); f.Kind() == reflect.Pointer && !f.IsNil() {
			ov.Field(i).Set(f)
		}
	}
	return out
}

func requireAllParams(module string, p any) error {
	if missing := missingParams(p); len(missing) > 0 {
		return fmt.Errorf("%s update params: every parameter must be given explicitly (the message replaces them all and a "+
			"missing one becomes zero); missing: %s. Build the update from the current values with %sUpdateParamsFromCurrent",
			module, strings.Join(missing, ", "), map[string]string{"crossvm": "CrossVM", "svm": "Svm", "rdk": "Rdk"}[module])
	}
	return nil
}

// ---------------------------------------------------------------------------
// crossvm
// ---------------------------------------------------------------------------

// Crossvm parameter bounds a governance update must respect (chain
// ValidateUpdate).
const (
	CrossVMMaxUpdateMessageSize       uint64 = 1 << 20
	CrossVMMaxUpdateQueueSize         uint32 = 10_000
	CrossVMMaxUpdateQueueTimeout      int64  = 100_000
	CrossVMMaxBridgeAllowedTargets           = 64
	CrossVMMaxBridgeAllowedTargetSize        = 256
)

// CrossVMParams are the crossvm parameters MsgUpdateParams carries (fields
// 2..18). Every field is required by CrossVM.UpdateParams; nil means "not
// given", not zero.
type CrossVMParams struct {
	MaxMessageSize     *uint64 `param:"max_message_size"`
	MaxQueueSize       *uint32 `param:"max_queue_size"`
	QueueTimeoutBlocks *int64  `param:"queue_timeout_blocks"`
	Enabled            *bool   `param:"enabled"`
	// BridgeAllowedTargets lists "cosmwasm:<qor1... contract>" entries; an
	// empty list keeps the EVM bridge precompile shut.
	BridgeAllowedTargets *[]string `param:"bridge_allowed_targets"`
	// BridgeTargetPins pins each bridge target to a code id (chain v3.2.8). An
	// empty list removes every pin.
	BridgeTargetPins         *[]crossvmv1.BridgeTargetPin `param:"bridge_target_pins"`
	MaxPendingPerSender      *uint32                      `param:"max_pending_per_sender"`
	MaxCosmosTxGas           *uint64                      `param:"max_cosmos_tx_gas"`
	RecordRetentionBlocks    *uint64                      `param:"record_retention_blocks"`
	MaxBlockWasmGas          *uint64                      `param:"max_block_wasm_gas"`
	MaxTxWasmShareBps        *uint32                      `param:"max_tx_wasm_share_bps"`
	MaxBlockLevelWasmGas     *uint64                      `param:"max_block_level_wasm_gas"`
	QueueWasmReserveBps      *uint32                      `param:"queue_wasm_reserve_bps"`
	WasmCongestionMaxFactor  *uint32                      `param:"wasm_congestion_max_factor"`
	WasmCongestionTargetBps  *uint32                      `param:"wasm_congestion_target_bps"`
	MaxBlockUploadBps        *uint32                      `param:"max_block_upload_bps"`
	MaxQueueTimeoutsPerBlock *uint32                      `param:"max_queue_timeouts_per_block"`
}

// UpdateParams builds crossvm MsgUpdateParams. It refuses a CrossVMParams with
// any field left nil (the message replaces every parameter, so a missing one
// would become zero) but applies no other check. Governance only. Prefer
// NewCrossVMUpdateParams or CrossVMUpdateParamsFromCurrent.
func (CrossVMComposers) UpdateParams(authority string, p CrossVMParams) (*crossvmv1.MsgUpdateParams, error) {
	if err := requireAllParams("crossvm", p); err != nil {
		return nil, err
	}
	return &crossvmv1.MsgUpdateParams{
		Authority:                authority,
		MaxMessageSize:           *p.MaxMessageSize,
		MaxQueueSize:             *p.MaxQueueSize,
		QueueTimeoutBlocks:       *p.QueueTimeoutBlocks,
		Enabled:                  *p.Enabled,
		BridgeAllowedTargets:     *p.BridgeAllowedTargets,
		BridgeTargetPins:         *p.BridgeTargetPins,
		MaxPendingPerSender:      *p.MaxPendingPerSender,
		MaxCosmosTxGas:           *p.MaxCosmosTxGas,
		RecordRetentionBlocks:    *p.RecordRetentionBlocks,
		MaxBlockWasmGas:          *p.MaxBlockWasmGas,
		MaxTxWasmShareBps:        *p.MaxTxWasmShareBps,
		MaxBlockLevelWasmGas:     *p.MaxBlockLevelWasmGas,
		QueueWasmReserveBps:      *p.QueueWasmReserveBps,
		WasmCongestionMaxFactor:  *p.WasmCongestionMaxFactor,
		WasmCongestionTargetBps:  *p.WasmCongestionTargetBps,
		MaxBlockUploadBps:        *p.MaxBlockUploadBps,
		MaxQueueTimeoutsPerBlock: *p.MaxQueueTimeoutsPerBlock,
	}, nil
}

// NewCrossVMUpdateParams builds crossvm MsgUpdateParams after the chain's
// checks: every field given, positive limits under their ceilings, at most 64
// bridge targets, no duplicates, each "cosmwasm:<qor1... contract address>"
// (the bridge only calls CosmWasm contracts).
func NewCrossVMUpdateParams(authority string, p CrossVMParams) (*crossvmv1.MsgUpdateParams, error) {
	if authority == "" {
		return nil, fmt.Errorf("crossvm update params: authority is required")
	}
	msg, err := CrossVM.UpdateParams(authority, p)
	if err != nil {
		return nil, err
	}
	switch {
	case msg.MaxMessageSize == 0 || msg.MaxMessageSize > CrossVMMaxUpdateMessageSize:
		return nil, fmt.Errorf("crossvm update params: max_message_size must be 1..%d, got %d", CrossVMMaxUpdateMessageSize, msg.MaxMessageSize)
	case msg.MaxQueueSize == 0 || msg.MaxQueueSize > CrossVMMaxUpdateQueueSize:
		return nil, fmt.Errorf("crossvm update params: max_queue_size must be 1..%d, got %d", CrossVMMaxUpdateQueueSize, msg.MaxQueueSize)
	case msg.QueueTimeoutBlocks <= 0 || msg.QueueTimeoutBlocks > CrossVMMaxUpdateQueueTimeout:
		return nil, fmt.Errorf("crossvm update params: queue_timeout_blocks must be 1..%d, got %d", CrossVMMaxUpdateQueueTimeout, msg.QueueTimeoutBlocks)
	case len(msg.BridgeAllowedTargets) > CrossVMMaxBridgeAllowedTargets:
		return nil, fmt.Errorf("crossvm update params: at most %d bridge targets, got %d", CrossVMMaxBridgeAllowedTargets, len(msg.BridgeAllowedTargets))
	}
	seen := make(map[string]bool, len(msg.BridgeAllowedTargets))
	for _, entry := range msg.BridgeAllowedTargets {
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
	pinned := make(map[string]bool, len(msg.BridgeTargetPins))
	for _, pin := range msg.BridgeTargetPins {
		if pin.Target == "" {
			return nil, fmt.Errorf("crossvm update params: a bridge target pin has no target")
		}
		if pinned[pin.Target] {
			return nil, fmt.Errorf("crossvm update params: bridge target %q is pinned twice", pin.Target)
		}
		pinned[pin.Target] = true
	}
	return msg, nil
}

// CrossVMParamsFromQuery turns GET /qorechain/crossvm/v1/params into a fully
// given CrossVMParams. The response lists the values in force (defaults
// substituted for unset ones), which is what an update should carry over.
func CrossVMParamsFromQuery(q *crossvmv1.QueryParamsResponse) CrossVMParams {
	targets := append([]string(nil), q.BridgeAllowedTargets...)
	pins := append([]crossvmv1.BridgeTargetPin(nil), q.BridgeTargetPins...)
	return CrossVMParams{
		MaxMessageSize:           Ptr(q.MaxMessageSize),
		MaxQueueSize:             Ptr(q.MaxQueueSize),
		QueueTimeoutBlocks:       Ptr(q.QueueTimeoutBlocks),
		Enabled:                  Ptr(q.Enabled),
		BridgeAllowedTargets:     &targets,
		BridgeTargetPins:         &pins,
		MaxPendingPerSender:      Ptr(q.MaxPendingPerSender),
		MaxCosmosTxGas:           Ptr(q.MaxCosmosTxGas),
		RecordRetentionBlocks:    Ptr(q.RecordRetentionBlocks),
		MaxBlockWasmGas:          Ptr(q.MaxBlockWasmGas),
		MaxTxWasmShareBps:        Ptr(q.MaxTxWasmShareBps),
		MaxBlockLevelWasmGas:     Ptr(q.MaxBlockLevelWasmGas),
		QueueWasmReserveBps:      Ptr(q.QueueWasmReserveBps),
		WasmCongestionMaxFactor:  Ptr(q.WasmCongestionMaxFactor),
		WasmCongestionTargetBps:  Ptr(q.WasmCongestionTargetBps),
		MaxBlockUploadBps:        Ptr(q.MaxBlockUploadBps),
		MaxQueueTimeoutsPerBlock: Ptr(q.MaxQueueTimeoutsPerBlock),
	}
}

// CrossVMParamsReader reads the crossvm parameters in force;
// *query.RestClient satisfies it.
type CrossVMParamsReader interface {
	GetCrossVMParams() (*crossvmv1.QueryParamsResponse, error)
}

// CrossVMUpdateParamsFromCurrent is the way to build a crossvm parameter
// proposal: it reads the parameters in force, applies the non-nil fields of
// changes, and builds a checked MsgUpdateParams (NewCrossVMUpdateParams).
func CrossVMUpdateParamsFromCurrent(rest CrossVMParamsReader, authority string, changes CrossVMParams) (*crossvmv1.MsgUpdateParams, error) {
	current, err := rest.GetCrossVMParams()
	if err != nil {
		return nil, fmt.Errorf("crossvm update params: reading the current parameters: %w", err)
	}
	return NewCrossVMUpdateParams(authority, mergeParams(CrossVMParamsFromQuery(current), changes))
}

// ---------------------------------------------------------------------------
// svm
// ---------------------------------------------------------------------------

// SvmParams are the svm parameters (SVMParams fields 1..12). Every field is
// required by Svm.UpdateParams; nil means "not given", not zero.
type SvmParams struct {
	MaxProgramSize     *uint64         `param:"max_program_size"`
	MaxAccountDataSize *uint64         `param:"max_account_data_size"`
	ComputeBudgetMax   *uint64         `param:"compute_budget_max"`
	LamportsPerByte    *uint64         `param:"lamports_per_byte"`
	RentExemptionMulti *math.LegacyDec `param:"rent_exemption_multi"`
	// Enabled turns the SVM lane on or off by proposal. Opening it needs
	// MaxCustodyHardUqor > 0.
	Enabled          *bool   `param:"enabled"`
	SvmSlotOffset    *int64  `param:"svm_slot_offset"`
	DefaultSigScheme *uint32 `param:"default_sig_scheme"`
	MaxCpi           *uint32 `param:"max_cpi"`
	// MaxCustodyUqor, MaxCustodyHardUqor and MaxAccountExcessUqor are the
	// custody ceilings (chain v3.2.8), in uqor. Zero removes a ceiling.
	MaxCustodyUqor       *uint64 `param:"max_custody_uqor"`
	MaxCustodyHardUqor   *uint64 `param:"max_custody_hard_uqor"`
	MaxAccountExcessUqor *uint64 `param:"max_account_excess_uqor"`
}

// UpdateParams builds svm MsgUpdateParams (chain v3.1.97+), which replaces the
// SVM runtime parameters WHOLESALE. It refuses a SvmParams with any field left
// nil, and refuses Enabled = true with MaxCustodyHardUqor = 0: governance must
// set a hard custody ceiling before opening the lane.
//
// authority must be the governance module account; a tx signed by anyone else
// is rejected on-chain. Submit it as the content of a gov proposal. Prefer
// SvmUpdateParamsFromCurrent.
func (SvmComposers) UpdateParams(authority string, p SvmParams) (*svmv1.MsgUpdateParams, error) {
	if err := requireAllParams("svm", p); err != nil {
		return nil, err
	}
	if *p.Enabled && *p.MaxCustodyHardUqor == 0 {
		return nil, fmt.Errorf("svm update params: governance must set a hard custody ceiling before opening the lane " +
			"(enabled = true needs max_custody_hard_uqor > 0)")
	}
	return &svmv1.MsgUpdateParams{Authority: authority, Params: svmv1.SVMParams{
		MaxProgramSize:       *p.MaxProgramSize,
		MaxAccountDataSize:   *p.MaxAccountDataSize,
		ComputeBudgetMax:     *p.ComputeBudgetMax,
		LamportsPerByte:      *p.LamportsPerByte,
		RentExemptionMulti:   *p.RentExemptionMulti,
		Enabled:              *p.Enabled,
		SvmSlotOffset:        *p.SvmSlotOffset,
		DefaultSigScheme:     *p.DefaultSigScheme,
		MaxCpi:               *p.MaxCpi,
		MaxCustodyUqor:       *p.MaxCustodyUqor,
		MaxCustodyHardUqor:   *p.MaxCustodyHardUqor,
		MaxAccountExcessUqor: *p.MaxAccountExcessUqor,
	}}, nil
}

// SvmParamsFromSVMParams turns stored SVMParams into a fully given SvmParams.
func SvmParamsFromSVMParams(q svmv1.SVMParams) SvmParams {
	return SvmParams{
		MaxProgramSize:       Ptr(q.MaxProgramSize),
		MaxAccountDataSize:   Ptr(q.MaxAccountDataSize),
		ComputeBudgetMax:     Ptr(q.ComputeBudgetMax),
		LamportsPerByte:      Ptr(q.LamportsPerByte),
		RentExemptionMulti:   Ptr(q.RentExemptionMulti),
		Enabled:              Ptr(q.Enabled),
		SvmSlotOffset:        Ptr(q.SvmSlotOffset),
		DefaultSigScheme:     Ptr(q.DefaultSigScheme),
		MaxCpi:               Ptr(q.MaxCpi),
		MaxCustodyUqor:       Ptr(q.MaxCustodyUqor),
		MaxCustodyHardUqor:   Ptr(q.MaxCustodyHardUqor),
		MaxAccountExcessUqor: Ptr(q.MaxAccountExcessUqor),
	}
}

// SvmParamsReader reads the svm parameters in force; *query.RestClient
// satisfies it.
type SvmParamsReader interface {
	GetSvmParams() (*svmv1.SVMParams, error)
}

// SvmUpdateParamsFromCurrent is the way to build an svm parameter proposal: it
// reads the parameters in force, applies the non-nil fields of changes, and
// builds MsgUpdateParams (Svm.UpdateParams, with its custody-ceiling check).
func SvmUpdateParamsFromCurrent(rest SvmParamsReader, authority string, changes SvmParams) (*svmv1.MsgUpdateParams, error) {
	current, err := rest.GetSvmParams()
	if err != nil {
		return nil, fmt.Errorf("svm update params: reading the current parameters: %w", err)
	}
	if current == nil {
		return nil, fmt.Errorf("svm update params: the node returned no parameters")
	}
	return Svm.UpdateParams(authority, mergeParams(SvmParamsFromSVMParams(*current), changes))
}

// ---------------------------------------------------------------------------
// rdk
// ---------------------------------------------------------------------------

// RdkParams are the rdk module parameters, as MsgUpdateParams carries them
// (fields 2..14). Every field is required by Rdk.UpdateParams; nil means "not
// given", not zero.
type RdkParams struct {
	MaxRollups *uint32 `param:"max_rollups"`
	// MinStakeForRollup is a uqor amount.
	MinStakeForRollup *int64 `param:"min_stake_for_rollup"`
	// RollupCreationBurnRate is a decimal in [0, 1), for example "0.01".
	RollupCreationBurnRate *string `param:"rollup_creation_burn_rate"`
	// DefaultChallengeWindow is in seconds (60 to 30 days).
	DefaultChallengeWindow *uint64 `param:"default_challenge_window"`
	MaxDABlobSize          *uint64 `param:"max_da_blob_size"`
	BlobRetentionBlocks    *uint64 `param:"blob_retention_blocks"`
	MaxBatchesPerBlock     *uint32 `param:"max_batches_per_block"`
	// Chain v3.2.8 retention and posted-data parameters.
	FinalizedBatchRetentionBlocks *uint64 `param:"finalized_batch_retention_blocks"`
	MaxPostedDataBytes            *uint64 `param:"max_posted_data_bytes"`
	MaxPostedDataBytesPerBlock    *uint64 `param:"max_posted_data_bytes_per_block"`
	PostedDataFeePerByte          *uint64 `param:"posted_data_fee_per_byte"`
	PostedDataRetentionBlocks     *uint64 `param:"posted_data_retention_blocks"`
	MinSubmitterBond              *uint64 `param:"min_submitter_bond"`
}

// Rdk parameter bounds (chain ValidateUpdate).
const (
	RdkMinChallengeWindowSec uint64 = 60
	RdkMaxChallengeWindowSec uint64 = 30 * 24 * 3600
	RdkMaxDABlobSizeLimit    uint64 = 8 << 20
)

// UpdateParams builds rdk MsgUpdateParams. It refuses an RdkParams with any
// field left nil but applies no other check. It replaces the rdk parameters
// wholesale; governance only. Prefer NewRdkUpdateParams or
// RdkUpdateParamsFromCurrent.
func (RdkComposers) UpdateParams(authority string, p RdkParams) (*rdkv1.MsgUpdateParams, error) {
	if err := requireAllParams("rdk", p); err != nil {
		return nil, err
	}
	return &rdkv1.MsgUpdateParams{
		Authority:                     authority,
		MaxRollups:                    *p.MaxRollups,
		MinStakeForRollup:             *p.MinStakeForRollup,
		RollupCreationBurnRate:        *p.RollupCreationBurnRate,
		DefaultChallengeWindow:        *p.DefaultChallengeWindow,
		MaxDaBlobSize:                 *p.MaxDABlobSize,
		BlobRetentionBlocks:           *p.BlobRetentionBlocks,
		MaxBatchesPerBlock:            *p.MaxBatchesPerBlock,
		FinalizedBatchRetentionBlocks: *p.FinalizedBatchRetentionBlocks,
		MaxPostedDataBytes:            *p.MaxPostedDataBytes,
		MaxPostedDataBytesPerBlock:    *p.MaxPostedDataBytesPerBlock,
		PostedDataFeePerByte:          *p.PostedDataFeePerByte,
		PostedDataRetentionBlocks:     *p.PostedDataRetentionBlocks,
		MinSubmitterBond:              *p.MinSubmitterBond,
	}, nil
}

// NewRdkUpdateParams builds rdk MsgUpdateParams after the chain's checks and
// with every field given.
func NewRdkUpdateParams(authority string, p RdkParams) (*rdkv1.MsgUpdateParams, error) {
	if authority == "" {
		return nil, fmt.Errorf("rdk update params: authority is required")
	}
	msg, err := Rdk.UpdateParams(authority, p)
	if err != nil {
		return nil, err
	}
	if msg.MaxRollups == 0 {
		return nil, fmt.Errorf("rdk update params: max_rollups must be positive")
	}
	if msg.MinStakeForRollup <= 0 {
		return nil, fmt.Errorf("rdk update params: min_stake_for_rollup must be positive")
	}
	rate, err := math.LegacyNewDecFromStr(msg.RollupCreationBurnRate)
	if err != nil || rate.IsNegative() || rate.GTE(math.LegacyOneDec()) {
		return nil, fmt.Errorf("rdk update params: rollup_creation_burn_rate must be a decimal in [0, 1), got %q", msg.RollupCreationBurnRate)
	}
	if msg.DefaultChallengeWindow < RdkMinChallengeWindowSec || msg.DefaultChallengeWindow > RdkMaxChallengeWindowSec {
		return nil, fmt.Errorf("rdk update params: default_challenge_window must be %d..%d seconds, got %d",
			RdkMinChallengeWindowSec, RdkMaxChallengeWindowSec, msg.DefaultChallengeWindow)
	}
	if msg.MaxDaBlobSize == 0 || msg.MaxDaBlobSize > RdkMaxDABlobSizeLimit {
		return nil, fmt.Errorf("rdk update params: max_da_blob_size must be 1..%d bytes, got %d", RdkMaxDABlobSizeLimit, msg.MaxDaBlobSize)
	}
	if msg.BlobRetentionBlocks == 0 {
		return nil, fmt.Errorf("rdk update params: blob_retention_blocks must be positive")
	}
	if msg.MaxBatchesPerBlock == 0 {
		return nil, fmt.Errorf("rdk update params: max_batches_per_block must be positive")
	}
	return msg, nil
}

// RdkParamsFromQuery turns GET /qorechain/rdk/v1/params into a fully given
// RdkParams.
func RdkParamsFromQuery(q *rdkv1.QueryParamsResponse) (RdkParams, error) {
	if q == nil || q.Params == nil {
		return RdkParams{}, fmt.Errorf("rdk update params: the node returned no parameters")
	}
	v := q.Params
	return RdkParams{
		MaxRollups:                    Ptr(v.MaxRollups),
		MinStakeForRollup:             Ptr(v.MinStakeForRollup),
		RollupCreationBurnRate:        Ptr(v.RollupCreationBurnRate),
		DefaultChallengeWindow:        Ptr(v.DefaultChallengeWindow),
		MaxDABlobSize:                 Ptr(v.MaxDaBlobSize),
		BlobRetentionBlocks:           Ptr(v.BlobRetentionBlocks),
		MaxBatchesPerBlock:            Ptr(v.MaxBatchesPerBlock),
		FinalizedBatchRetentionBlocks: Ptr(v.FinalizedBatchRetentionBlocks),
		MaxPostedDataBytes:            Ptr(v.MaxPostedDataBytes),
		MaxPostedDataBytesPerBlock:    Ptr(v.MaxPostedDataBytesPerBlock),
		PostedDataFeePerByte:          Ptr(v.PostedDataFeePerByte),
		PostedDataRetentionBlocks:     Ptr(v.PostedDataRetentionBlocks),
		MinSubmitterBond:              Ptr(v.MinSubmitterBond),
	}, nil
}

// RdkParamsReader reads the rdk parameters in force; *query.RestClient
// satisfies it.
type RdkParamsReader interface {
	GetRdkParams() (*rdkv1.QueryParamsResponse, error)
}

// RdkUpdateParamsFromCurrent is the way to build an rdk parameter proposal: it
// reads the parameters in force, applies the non-nil fields of changes, and
// builds a checked MsgUpdateParams (NewRdkUpdateParams).
func RdkUpdateParamsFromCurrent(rest RdkParamsReader, authority string, changes RdkParams) (*rdkv1.MsgUpdateParams, error) {
	current, err := rest.GetRdkParams()
	if err != nil {
		return nil, fmt.Errorf("rdk update params: reading the current parameters: %w", err)
	}
	base, err := RdkParamsFromQuery(current)
	if err != nil {
		return nil, err
	}
	return NewRdkUpdateParams(authority, mergeParams(base, changes))
}
