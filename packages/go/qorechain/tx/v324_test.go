package tx

import "testing"

func TestDecodeTxErrorStakingTier(t *testing.T) {
	for code, want := range map[uint32]string{
		2:  "invalid staking-tier parameters",
		5:  "this lock term is not offered (see the module parameters)",
		13: "this stake is locked; undelegating or redelegating it waits for the lock to end",
	} {
		if e := DecodeTxError(code, "stakingtier", ""); e.Reason != want {
			t.Errorf("stakingtier %d: %q", code, e.Reason)
		}
	}
	if len(moduleCodespaceReasons["stakingtier"]) != 12 {
		t.Fatalf("stakingtier codes 2-13: got %d", len(moduleCodespaceReasons["stakingtier"]))
	}
	if e := DecodeTxError(14, "stakingtier", ""); e.Reason != "unknown stakingtier error" {
		t.Fatalf("14: %q", e.Reason)
	}
}
