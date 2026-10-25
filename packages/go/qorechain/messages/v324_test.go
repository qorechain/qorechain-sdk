package messages

import (
	"strings"
	"testing"
	"time"

	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"

	stakingtierv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/stakingtier/v1"
)

const (
	v324Addr = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k"
	v324Val  = "qorvaloper1hkkxx5jmmw02wcz26c74lsp74qysj6h4ewkcwk"
)

func roundTrip(t *testing.T, msg sdk.Msg) (string, sdk.Msg) {
	t.Helper()
	any, err := PackAny(msg)
	if err != nil {
		t.Fatalf("pack: %v", err)
	}
	var decoded sdk.Msg
	if err := NewProtoCodec().UnpackAny(any, &decoded); err != nil {
		t.Fatalf("unpack %s: %v", any.TypeUrl, err)
	}
	return any.TypeUrl, decoded
}

func TestLockDelegationRoundTrip(t *testing.T) {
	msg, err := NewLockDelegation(v324Addr, v324Val, "10000000", 6)
	if err != nil {
		t.Fatal(err)
	}
	url, decoded := roundTrip(t, msg)
	if url != "/qorechain.stakingtier.v1.MsgLockDelegation" {
		t.Fatalf("type URL %s", url)
	}
	got := decoded.(*stakingtierv1.MsgLockDelegation)
	if got.Delegator != v324Addr || got.Validator != v324Val || got.Amount.String() != "10000000" || got.Months != 6 {
		t.Fatalf("%+v", got)
	}
}

func TestLockDelegationAppliesTheChainChecks(t *testing.T) {
	if len(StakingLockMonths) != 3 || StakingLockMonths[0] != 3 || StakingLockMonths[1] != 6 || StakingLockMonths[2] != 12 {
		t.Fatalf("StakingLockMonths %v", StakingLockMonths)
	}
	for _, tc := range []struct {
		name                string
		delegator, val, amt string
		months              uint32
		want                string
	}{
		{"months 4", v324Addr, v324Val, "10000000", 4, "months must be one of 3, 6, 12"},
		{"zero amount", v324Addr, v324Val, "0", 3, "positive integer"},
		{"decimal amount", v324Addr, v324Val, "1.5", 3, "positive integer"},
		{"negative amount", v324Addr, v324Val, "-5", 3, "positive integer"},
		{"no validator", v324Addr, "", "10000000", 3, "validator"},
		{"no delegator", "", v324Val, "10000000", 3, "delegator"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NewLockDelegation(tc.delegator, tc.val, tc.amt, tc.months); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q, got %v", tc.want, err)
			}
		})
	}
	if err := ValidateLockDelegation(StakingTier.LockDelegation(v324Addr, v324Val, math.Int{}, 3)); err == nil {
		t.Fatal("nil amount accepted")
	}
	for _, m := range StakingLockMonths {
		if _, err := NewLockDelegation(v324Addr, v324Val, "1", m); err != nil {
			t.Errorf("months %d: %v", m, err)
		}
	}
}

func TestStakingTierMessagesAreRegistered(t *testing.T) {
	url, decoded := roundTrip(t, StakingTier.UnlockEarly(v324Addr, 7))
	if url != "/qorechain.stakingtier.v1.MsgUnlockEarly" || decoded.(*stakingtierv1.MsgUnlockEarly).LockId != 7 {
		t.Fatalf("%s %+v", url, decoded)
	}
	url, decoded = roundTrip(t, StakingTier.ClaimBonus(v324Addr))
	if url != "/qorechain.stakingtier.v1.MsgClaimBonus" || decoded.(*stakingtierv1.MsgClaimBonus).Holder != v324Addr {
		t.Fatalf("%s %+v", url, decoded)
	}
	tiers := []stakingtierv1.LockTierParam{{Months: 3, BonusBps: 150}, {Months: 12, BonusBps: 500}}
	url, decoded = roundTrip(t, StakingTier.UpdateParams("qor1gov", tiers, 200, 300, 2500, 500, true, math.NewInt(10_000_000)))
	p := decoded.(*stakingtierv1.MsgUpdateParams)
	if url != "/qorechain.stakingtier.v1.MsgUpdateParams" || len(p.LockTiers) != 2 || !p.Enabled || p.MinLockAmount.Int64() != 10_000_000 || p.EarlyUnlockPenaltyBps != 500 {
		t.Fatalf("%s %+v", url, p)
	}
}

func TestIBCTimeoutTimestampIsAbsoluteNanoseconds(t *testing.T) {
	now := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	got, err := ibcTimeoutTimestampAt(600*time.Second, now)
	if err != nil || got != uint64(now.UnixMilli()+600_000)*1_000_000 {
		t.Fatalf("%d %v", got, err)
	}
	if _, err := IBCTimeoutTimestamp(0); err == nil || !strings.Contains(err.Error(), "positive") {
		t.Fatalf("zero accepted: %v", err)
	}
	if _, err := IBCTimeoutTimestamp(-time.Second); err == nil {
		t.Fatal("negative accepted")
	}
	if ts, err := IBCTimeoutTimestamp(time.Minute); err != nil || ts <= uint64(time.Now().UnixNano()) {
		t.Fatalf("not in the future: %d %v", ts, err)
	}
}
