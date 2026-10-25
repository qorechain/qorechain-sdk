package messages

import (
	"fmt"
	"slices"

	"cosmossdk.io/math"

	stakingtierv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/stakingtier/v1"
)

// Staking tiers (chain v3.2.4, x/stakingtier): lock part of a delegation for
// 3, 6 or 12 months for a bonus on top of the staking reward, leave a lock
// early (a penalty is burned and the bonus forfeited), and claim the accrued
// bonus. The reads (params, locks, pool) are on query.RestClient.

// StakingLockMonths are the lock terms the chain accepts (AllowedLockMonths).
// Which of them governance offers, and at what bonus, is in the module
// parameters (query.RestClient.GetStakingTierParams).
var StakingLockMonths = []uint32{3, 6, 12}

// ValidateLockDelegation mirrors the chain's stateless checks on
// MsgLockDelegation: delegator and validator set, amount a positive integer in
// base units, months one of StakingLockMonths. The error names the field.
func ValidateLockDelegation(msg *stakingtierv1.MsgLockDelegation) error {
	if msg == nil {
		return fmt.Errorf("lock delegation: message is nil")
	}
	if msg.Delegator == "" {
		return fmt.Errorf("lock delegation: delegator is required")
	}
	if msg.Validator == "" {
		return fmt.Errorf("lock delegation: validator is required")
	}
	if msg.Amount.IsNil() || !msg.Amount.IsPositive() {
		return fmt.Errorf("lock delegation: amount must be a positive integer in base units, got %s", msg.Amount.String())
	}
	if !slices.Contains(StakingLockMonths, msg.Months) {
		return fmt.Errorf("lock delegation: months must be one of 3, 6, 12, got %d", msg.Months)
	}
	return nil
}

// NewLockDelegation builds a validated MsgLockDelegation, locking amount (an
// integer amount in base units, as a decimal string) of the delegator's
// existing delegation to validator for months.
func NewLockDelegation(delegator, validator, amount string, months uint32) (*stakingtierv1.MsgLockDelegation, error) {
	if !decimalAmount.MatchString(amount) {
		return nil, fmt.Errorf("lock delegation: amount must be a positive integer in base units, got %q", amount)
	}
	value, ok := math.NewIntFromString(amount)
	if !ok {
		return nil, fmt.Errorf("lock delegation: amount must be a positive integer in base units, got %q", amount)
	}
	msg := StakingTier.LockDelegation(delegator, validator, value, months)
	if err := ValidateLockDelegation(msg); err != nil {
		return nil, err
	}
	return msg, nil
}

// StakingTierComposers builds stakingtier module messages.
type StakingTierComposers struct{}

// StakingTier is the stakingtier message composer group.
var StakingTier StakingTierComposers

// LockDelegation builds MsgLockDelegation without checking it. Prefer
// NewLockDelegation, which applies the chain's checks (ValidateLockDelegation).
func (StakingTierComposers) LockDelegation(delegator, validator string, amount math.Int, months uint32) *stakingtierv1.MsgLockDelegation {
	return &stakingtierv1.MsgLockDelegation{Delegator: delegator, Validator: validator, Amount: amount, Months: months}
}

// UnlockEarly builds MsgUnlockEarly, releasing lock lockID before its term ends.
func (StakingTierComposers) UnlockEarly(delegator string, lockID uint64) *stakingtierv1.MsgUnlockEarly {
	return &stakingtierv1.MsgUnlockEarly{Delegator: delegator, LockId: lockID}
}

// ClaimBonus builds MsgClaimBonus, claiming the holder's accrued bonus.
func (StakingTierComposers) ClaimBonus(holder string) *stakingtierv1.MsgClaimBonus {
	return &stakingtierv1.MsgClaimBonus{Holder: holder}
}

// UpdateParams builds MsgUpdateParams, which replaces the module parameters
// WHOLESALE. authority must be the governance module account, so it only
// executes from a passed proposal.
func (StakingTierComposers) UpdateParams(authority string, lockTiers []stakingtierv1.LockTierParam, lightNodeBonusBps, validatorBonusBps, maxTotalApyBps, earlyUnlockPenaltyBps uint32, enabled bool, minLockAmount math.Int) *stakingtierv1.MsgUpdateParams {
	return &stakingtierv1.MsgUpdateParams{
		Authority:             authority,
		LockTiers:             lockTiers,
		LightNodeBonusBps:     lightNodeBonusBps,
		ValidatorBonusBps:     validatorBonusBps,
		MaxTotalApyBps:        maxTotalApyBps,
		EarlyUnlockPenaltyBps: earlyUnlockPenaltyBps,
		Enabled:               enabled,
		MinLockAmount:         minLockAmount,
	}
}
