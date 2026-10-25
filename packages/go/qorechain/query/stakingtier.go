package query

import (
	"net/url"

	"cosmossdk.io/math"
)

// Staking tiers (chain v3.2.4, x/stakingtier): a delegator locks part of an
// existing delegation for 3, 6 or 12 months and earns a bonus on top of the
// staking reward. The terms and bonus rates are governance parameters
// (GetStakingTierParams). Running a light node or a validator adds to the
// bonus, up to a total cap; leaving a lock early burns a penalty and forfeits
// the bonus. The messages are messages.StakingTier.
//
// int64 and uint64 fields arrive as JSON strings and amounts as integer
// strings in base units; amounts are kept as math.Int and decimal strings
// (the bps projections) stay strings. A field the answer omits reads as zero.

// StakingTierParamsPath, StakingTierPoolPath and StakingLocksPath are the
// module's REST routes.
const (
	StakingTierParamsPath = "/qorechain/stakingtier/v1/params"
	StakingTierPoolPath   = "/qorechain/stakingtier/v1/pool"
)

// StakingLocksPath is the REST route for one holder's locks.
func StakingLocksPath(holder string) string {
	return "/qorechain/stakingtier/v1/locks/" + url.PathEscape(holder)
}

// StakingLockTier is one offered term and its bonus.
type StakingLockTier struct {
	Months uint32
	// BonusBps is the bonus in basis points of APY.
	BonusBps uint32
}

// StakingTierParams is the decoded answer of GET {rest}/qorechain/stakingtier/v1/params.
type StakingTierParams struct {
	// LockTiers are the offered terms and their bonus.
	LockTiers []StakingLockTier
	// LightNodeBonusBps is the extra bonus for a holder that runs an active
	// light node.
	LightNodeBonusBps uint32
	// ValidatorBonusBps is the extra bonus for a holder that runs a validator.
	ValidatorBonusBps uint32
	// MaxTotalApyBps caps the total yield (staking reward plus every bonus).
	MaxTotalApyBps uint32
	// EarlyUnlockPenaltyBps is the share of the locked amount burned on an
	// early unlock.
	EarlyUnlockPenaltyBps uint32
	// Enabled reports whether governance has the module switched on.
	Enabled bool
	// MinLockAmount is the smallest lock, in base units.
	MinLockAmount math.Int
}

// StakingLock is one lock of a holder.
type StakingLock struct {
	ID           uint64
	Validator    string
	LockedAmount math.Int
	// LockedShares is a decimal string.
	LockedShares string
	Months       uint32
	TierBonusBps uint32
	StartHeight  int64
	// StartTime is Unix seconds.
	StartTime int64
	// EndTime is Unix seconds; the lock is released at this block time.
	EndTime           int64
	AccruedBonus      math.Int
	Released          bool
	LightNodeBonusBps uint32
	ValidatorBonusBps uint32
	// ProjectedBonusBps is a decimal string.
	ProjectedBonusBps      string
	ProjectedBonusToExpiry math.Int
}

// StakingLocks is the decoded answer of GET {rest}/qorechain/stakingtier/v1/locks/{holder}:
// a holder's locks and claimable bonus.
type StakingLocks struct {
	Locks          []StakingLock
	Claimable      math.Int
	TotalClaimable math.Int
}

// StakingTierPool is the decoded answer of GET {rest}/qorechain/stakingtier/v1/pool:
// the bonus pool.
type StakingTierPool struct {
	Balance            math.Int
	Outstanding        math.Int
	Surplus            math.Int
	TotalMinted        math.Int
	TotalPaid          math.Int
	TotalForfeited     math.Int
	TotalPenaltyBurned math.Int
	LastSettleTime     int64
	LastSettleHeight   int64
	// LastBaseApyBps is a decimal string.
	LastBaseApyBps string
	LockCount      uint64
}

// GetStakingTierParams returns the decoded module parameters.
func (c *RestClient) GetStakingTierParams() (*StakingTierParams, error) {
	raw, err := c.Get(StakingTierParamsPath, nil)
	if err != nil {
		return nil, err
	}
	return ParseStakingTierParams(raw)
}

// GetStakingLocks returns the decoded locks and claimable bonus of holder (qor1…).
func (c *RestClient) GetStakingLocks(holder string) (*StakingLocks, error) {
	raw, err := c.Get(StakingLocksPath(holder), nil)
	if err != nil {
		return nil, err
	}
	return ParseStakingLocks(raw)
}

// GetStakingTierPool returns the decoded bonus pool.
func (c *RestClient) GetStakingTierPool() (*StakingTierPool, error) {
	raw, err := c.Get(StakingTierPoolPath, nil)
	if err != nil {
		return nil, err
	}
	return ParseStakingTierPool(raw)
}

// ParseStakingTierParams decodes a stakingtier params response body.
func ParseStakingTierParams(raw []byte) (*StakingTierParams, error) {
	const route = "stakingtier params"
	f, err := decodeFields(raw, route)
	if err != nil {
		return nil, err
	}
	tiers, err := decodeFieldList(f["lock_tiers"], route, "lock_tiers")
	if err != nil {
		return nil, err
	}
	r := &fieldReader{f: f, route: route}
	out := &StakingTierParams{
		LightNodeBonusBps:     r.u32("light_node_bonus_bps"),
		ValidatorBonusBps:     r.u32("validator_bonus_bps"),
		MaxTotalApyBps:        r.u32("max_total_apy_bps"),
		EarlyUnlockPenaltyBps: r.u32("early_unlock_penalty_bps"),
		Enabled:               r.boolean("enabled"),
		MinLockAmount:         r.amount("min_lock_amount"),
	}
	for _, t := range tiers {
		tr := &fieldReader{f: t, route: route}
		out.LockTiers = append(out.LockTiers, StakingLockTier{Months: tr.u32("months"), BonusBps: tr.u32("bonus_bps")})
		r.keep(tr.err)
	}
	if r.err != nil {
		return nil, r.err
	}
	return out, nil
}

// ParseStakingLocks decodes a stakingtier locks response body.
func ParseStakingLocks(raw []byte) (*StakingLocks, error) {
	const route = "stakingtier locks"
	f, err := decodeFields(raw, route)
	if err != nil {
		return nil, err
	}
	locks, err := decodeFieldList(f["locks"], route, "locks")
	if err != nil {
		return nil, err
	}
	r := &fieldReader{f: f, route: route}
	out := &StakingLocks{Claimable: r.amount("claimable"), TotalClaimable: r.amount("total_claimable")}
	for _, l := range locks {
		lr := &fieldReader{f: l, route: route}
		out.Locks = append(out.Locks, StakingLock{
			ID:                     lr.u64("id"),
			Validator:              lr.str("validator"),
			LockedAmount:           lr.amount("locked_amount"),
			LockedShares:           lr.str("locked_shares"),
			Months:                 lr.u32("months"),
			TierBonusBps:           lr.u32("tier_bonus_bps"),
			StartHeight:            lr.i64("start_height"),
			StartTime:              lr.i64("start_time"),
			EndTime:                lr.i64("end_time"),
			AccruedBonus:           lr.amount("accrued_bonus"),
			Released:               lr.boolean("released"),
			LightNodeBonusBps:      lr.u32("light_node_bonus_bps"),
			ValidatorBonusBps:      lr.u32("validator_bonus_bps"),
			ProjectedBonusBps:      lr.str("projected_bonus_bps"),
			ProjectedBonusToExpiry: lr.amount("projected_bonus_to_expiry"),
		})
		r.keep(lr.err)
	}
	if r.err != nil {
		return nil, r.err
	}
	return out, nil
}

// ParseStakingTierPool decodes a stakingtier pool response body.
func ParseStakingTierPool(raw []byte) (*StakingTierPool, error) {
	const route = "stakingtier pool"
	f, err := decodeFields(raw, route)
	if err != nil {
		return nil, err
	}
	r := &fieldReader{f: f, route: route}
	out := &StakingTierPool{
		Balance:            r.amount("balance"),
		Outstanding:        r.amount("outstanding"),
		Surplus:            r.amount("surplus"),
		TotalMinted:        r.amount("total_minted"),
		TotalPaid:          r.amount("total_paid"),
		TotalForfeited:     r.amount("total_forfeited"),
		TotalPenaltyBurned: r.amount("total_penalty_burned"),
		LastSettleTime:     r.i64("last_settle_time"),
		LastSettleHeight:   r.i64("last_settle_height"),
		LastBaseApyBps:     r.str("last_base_apy_bps"),
		LockCount:          r.u64("lock_count"),
	}
	if r.err != nil {
		return nil, r.err
	}
	return out, nil
}
