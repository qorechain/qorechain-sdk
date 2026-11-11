package messages

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"cosmossdk.io/math"
	"github.com/cosmos/cosmos-sdk/types/bech32"

	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	rdkv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/rdk/v1"
	svmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/svm/v1"
)

func TestAuthenticatorLinkMessageKnownAnswer(t *testing.T) {
	got := AuthenticatorLinkMessage("qorechain-diana", "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj", "ed25519", bytes.Repeat([]byte{0x07}, 32))
	want := "QoreChain authenticator link v1\nchain: qorechain-diana\naccount: qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj\nscheme: ed25519\nkey: 0707070707070707070707070707070707070707070707070707070707070707"
	if got != want {
		t.Fatalf("link message =\n%q\nwant\n%q", got, want)
	}
}

func TestRegisterAuthenticatorRequiresProof(t *testing.T) {
	_, err := AbstractAccount.RegisterAuthenticator("o", "o", "ed25519", []byte{1}, nil, 0, "", nil)
	if err == nil || !strings.Contains(err.Error(), "AuthenticatorLinkMessage") {
		t.Fatalf("empty proof: err = %v", err)
	}
	msg, err := AbstractAccount.RegisterAuthenticator("o", "o", "ed25519", []byte{1}, []string{"send"}, 5, "l", []byte{9})
	if err != nil || !bytes.Equal(msg.PossessionProof, []byte{9}) {
		t.Fatalf("msg = %+v, err = %v", msg, err)
	}
}

func TestHasValuePermission(t *testing.T) {
	for _, p := range []string{"send", "evm", "deploy", "svm", "all", "SEND"} {
		if !HasValuePermission([]string{"query", p}) {
			t.Errorf("%q not seen as a value permission", p)
		}
	}
	if HasValuePermission([]string{"query", "vote"}) || HasValuePermission(nil) {
		t.Error("non-value permissions flagged")
	}
}

func TestCheckSpendingRuleBoundsValueKeys(t *testing.T) {
	dl := func(d, per, daily string) *abstractaccountv1.DenomLimit {
		return &abstractaccountv1.DenomLimit{Denom: d, PerTxLimit: per, DailyLimit: daily}
	}
	ok := [][]abstractaccountv1.SpendingRule{
		{{Enabled: true, PerTxLimit: 10}},
		{{Enabled: true, DailyLimit: 10}},
		{{Enabled: true, AllowedDenoms: []string{"uqor", "ERC20/0xABC"}, DenomLimits: []*abstractaccountv1.DenomLimit{dl("UQOR", "5", ""), dl("erc20/0xabc", "", "7")}}},
		// The first ENABLED rule is the one applied; a disabled one before it is skipped.
		{{Enabled: false}, {Enabled: true, PerTxLimit: 1}},
	}
	for i, rules := range ok {
		if err := CheckSpendingRuleBoundsValueKeys(rules); err != nil {
			t.Errorf("case %d refused: %v", i, err)
		}
	}
	bad := [][]abstractaccountv1.SpendingRule{
		nil,
		{{Enabled: false, PerTxLimit: 10}},
		{{Enabled: true}},
		{{Enabled: true, AllowedDenoms: []string{"uqor"}}},
		{{Enabled: true, AllowedDenoms: []string{"uqor"}, DenomLimits: []*abstractaccountv1.DenomLimit{dl("uqor", "0", "")}}},
		{{Enabled: true, AllowedDenoms: []string{"uqor", "uatom"}, DenomLimits: []*abstractaccountv1.DenomLimit{dl("uqor", "1", "")}}},
		// Only the first enabled rule counts, even if a later one bounds.
		{{Enabled: true, AllowedDenoms: []string{"uqor"}}, {Enabled: true, PerTxLimit: 5}},
	}
	for i, rules := range bad {
		if err := CheckSpendingRuleBoundsValueKeys(rules); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}

func fullCrossVMParams(t *testing.T) CrossVMParams {
	t.Helper()
	contract, err := bech32.ConvertAndEncode("qor", make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	return CrossVMParams{
		MaxMessageSize:           Ptr(uint64(65536)),
		MaxQueueSize:             Ptr(uint32(1000)),
		QueueTimeoutBlocks:       Ptr(int64(100)),
		Enabled:                  Ptr(true),
		BridgeAllowedTargets:     &[]string{"cosmwasm:" + contract},
		BridgeTargetPins:         &[]crossvmv1.BridgeTargetPin{{Target: "cosmwasm:" + contract, CodeID: 7, HistoryLen: 2}},
		MaxPendingPerSender:      Ptr(uint32(100)),
		MaxCosmosTxGas:           Ptr(uint64(0)),
		RecordRetentionBlocks:    Ptr(uint64(1000)),
		MaxBlockWasmGas:          Ptr(uint64(1)),
		MaxTxWasmShareBps:        Ptr(uint32(2)),
		MaxBlockLevelWasmGas:     Ptr(uint64(3)),
		QueueWasmReserveBps:      Ptr(uint32(4)),
		WasmCongestionMaxFactor:  Ptr(uint32(5)),
		WasmCongestionTargetBps:  Ptr(uint32(6)),
		MaxBlockUploadBps:        Ptr(uint32(7)),
		MaxQueueTimeoutsPerBlock: Ptr(uint32(8)),
	}
}

func TestCrossVMUpdateParamsRequiresEveryField(t *testing.T) {
	p := fullCrossVMParams(t)
	msg, err := NewCrossVMUpdateParams("qor1gov", p)
	if err != nil {
		t.Fatal(err)
	}
	if typeURL(msg) != "/qorechain.crossvm.v1.MsgUpdateParams" || msg.MaxQueueTimeoutsPerBlock != 8 || len(msg.BridgeTargetPins) != 1 || msg.BridgeTargetPins[0].CodeID != 7 {
		t.Fatalf("msg = %+v", msg)
	}
	p.BridgeTargetPins = nil
	p.MaxBlockUploadBps = nil
	_, err = CrossVM.UpdateParams("qor1gov", p)
	if err == nil || !strings.Contains(err.Error(), "bridge_target_pins") || !strings.Contains(err.Error(), "max_block_upload_bps") {
		t.Fatalf("missing fields not named: %v", err)
	}
}

func TestCrossVMUpdateParamsChecks(t *testing.T) {
	contract, _ := bech32.ConvertAndEncode("qor", make([]byte, 32))
	mut := []func(p *CrossVMParams){
		func(p *CrossVMParams) { p.MaxMessageSize = Ptr(uint64(0)) },
		func(p *CrossVMParams) { p.MaxMessageSize = Ptr(uint64(1<<20 + 1)) },
		func(p *CrossVMParams) { p.MaxQueueSize = Ptr(uint32(0)) },
		func(p *CrossVMParams) { p.MaxQueueSize = Ptr(uint32(10_001)) },
		func(p *CrossVMParams) { p.QueueTimeoutBlocks = Ptr(int64(0)) },
		func(p *CrossVMParams) { p.QueueTimeoutBlocks = Ptr(int64(100_001)) },
		func(p *CrossVMParams) { p.BridgeAllowedTargets = &[]string{"evm:0x01"} },
		func(p *CrossVMParams) { p.BridgeAllowedTargets = &[]string{"cosmwasm:notanaddress"} },
		func(p *CrossVMParams) {
			p.BridgeAllowedTargets = &[]string{"cosmwasm:" + contract, "cosmwasm:" + contract}
		},
		func(p *CrossVMParams) { p.BridgeTargetPins = &[]crossvmv1.BridgeTargetPin{{Target: ""}} },
	}
	for i, m := range mut {
		p := fullCrossVMParams(t)
		m(&p)
		if _, err := NewCrossVMUpdateParams("qor1gov", p); err == nil {
			t.Errorf("mutation %d accepted", i)
		}
	}
	if _, err := NewCrossVMUpdateParams("", fullCrossVMParams(t)); err == nil {
		t.Error("empty authority accepted")
	}
}

type fakeCrossVM struct {
	resp *crossvmv1.QueryParamsResponse
}

func (f fakeCrossVM) GetCrossVMParams() (*crossvmv1.QueryParamsResponse, error) { return f.resp, nil }

func TestCrossVMUpdateParamsFromCurrent(t *testing.T) {
	contract, _ := bech32.ConvertAndEncode("qor", make([]byte, 32))
	cur := &crossvmv1.QueryParamsResponse{
		MaxMessageSize: 65536, MaxQueueSize: 1000, QueueTimeoutBlocks: 100, Enabled: true,
		BridgeAllowedTargets: []string{"cosmwasm:" + contract},
		BridgeTargetPins:     []crossvmv1.BridgeTargetPin{{Target: "cosmwasm:" + contract, CodeID: 3, HistoryLen: 1}},
		MaxPendingPerSender:  100, MaxCosmosTxGas: 9, RecordRetentionBlocks: 10, MaxBlockWasmGas: 11, MaxTxWasmShareBps: 12,
		MaxBlockLevelWasmGas: 13, QueueWasmReserveBps: 14, WasmCongestionMaxFactor: 15, WasmCongestionTargetBps: 16,
		WasmCongestionFactorMicro: 999, MaxBlockUploadBps: 17, MaxQueueTimeoutsPerBlock: 18,
	}
	msg, err := CrossVMUpdateParamsFromCurrent(fakeCrossVM{cur}, "qor1gov", CrossVMParams{MaxQueueSize: Ptr(uint32(2000))})
	if err != nil {
		t.Fatal(err)
	}
	if msg.MaxQueueSize != 2000 || msg.MaxMessageSize != 65536 || len(msg.BridgeTargetPins) != 1 || msg.BridgeTargetPins[0].CodeID != 3 ||
		msg.MaxQueueTimeoutsPerBlock != 18 || msg.WasmCongestionTargetBps != 16 || msg.Authority != "qor1gov" {
		t.Fatalf("msg = %+v", msg)
	}
}

func TestSvmUpdateParamsCustodyCeiling(t *testing.T) {
	p := svmParamsFixture()
	p.Enabled = Ptr(true)
	if _, err := Svm.UpdateParams("qor1gov", p); err == nil || !strings.Contains(err.Error(), "hard custody ceiling") {
		t.Fatalf("enabled without hard ceiling: %v", err)
	}
	p.MaxCustodyHardUqor = Ptr(uint64(1_000_000))
	msg, err := Svm.UpdateParams("qor1gov", p)
	if err != nil || !msg.Params.Enabled || msg.Params.MaxCustodyHardUqor != 1_000_000 {
		t.Fatalf("msg = %+v, err = %v", msg, err)
	}
	p.MaxAccountExcessUqor = nil
	if _, err := Svm.UpdateParams("qor1gov", p); err == nil || !strings.Contains(err.Error(), "max_account_excess_uqor") {
		t.Fatalf("missing field not named: %v", err)
	}
}

type fakeSvm struct {
	p   *svmv1.SVMParams
	err error
}

func (f fakeSvm) GetSvmParams() (*svmv1.SVMParams, error) { return f.p, f.err }

func TestSvmUpdateParamsFromCurrent(t *testing.T) {
	cur := &svmv1.SVMParams{MaxProgramSize: 1, MaxAccountDataSize: 2, ComputeBudgetMax: 3, LamportsPerByte: 4,
		RentExemptionMulti: math.LegacyMustNewDecFromStr("2"), MaxCpi: 4, MaxCustodyUqor: 50, MaxCustodyHardUqor: 100, MaxAccountExcessUqor: 7}
	msg, err := SvmUpdateParamsFromCurrent(fakeSvm{p: cur}, "qor1gov", SvmParams{Enabled: Ptr(true)})
	if err != nil {
		t.Fatal(err)
	}
	if !msg.Params.Enabled || msg.Params.MaxCustodyHardUqor != 100 || msg.Params.MaxAccountExcessUqor != 7 || msg.Params.MaxCpi != 4 {
		t.Fatalf("msg = %+v", msg.Params)
	}
	if _, err := SvmUpdateParamsFromCurrent(fakeSvm{err: errors.New("down")}, "g", SvmParams{}); err == nil {
		t.Fatal("reader error swallowed")
	}
}

func fullRdkParams() RdkParams {
	return RdkParams{
		MaxRollups: Ptr(uint32(100)), MinStakeForRollup: Ptr(int64(10_000_000)), RollupCreationBurnRate: Ptr("0.01"),
		DefaultChallengeWindow: Ptr(uint64(604800)), MaxDABlobSize: Ptr(uint64(2 << 20)), BlobRetentionBlocks: Ptr(uint64(100000)),
		MaxBatchesPerBlock: Ptr(uint32(10)), FinalizedBatchRetentionBlocks: Ptr(uint64(1)), MaxPostedDataBytes: Ptr(uint64(2)),
		MaxPostedDataBytesPerBlock: Ptr(uint64(3)), PostedDataFeePerByte: Ptr(uint64(4)), PostedDataRetentionBlocks: Ptr(uint64(5)),
		MinSubmitterBond: Ptr(uint64(6)),
	}
}

func TestRdkUpdateParamsComposer(t *testing.T) {
	msg, err := NewRdkUpdateParams("qor1gov", fullRdkParams())
	if err != nil {
		t.Fatal(err)
	}
	if typeURL(msg) != "/qorechain.rdk.v1.MsgUpdateParams" || msg.RollupCreationBurnRate != "0.01" || msg.MinSubmitterBond != 6 || msg.PostedDataFeePerByte != 4 {
		t.Fatalf("msg = %+v", msg)
	}
	mut := []func(p *RdkParams){
		func(p *RdkParams) { p.MaxRollups = Ptr(uint32(0)) },
		func(p *RdkParams) { p.MinStakeForRollup = Ptr(int64(0)) },
		func(p *RdkParams) { p.RollupCreationBurnRate = Ptr("1") },
		func(p *RdkParams) { p.RollupCreationBurnRate = Ptr("-0.1") },
		func(p *RdkParams) { p.RollupCreationBurnRate = Ptr("x") },
		func(p *RdkParams) { p.DefaultChallengeWindow = Ptr(uint64(59)) },
		func(p *RdkParams) { p.DefaultChallengeWindow = Ptr(uint64(30*24*3600 + 1)) },
		func(p *RdkParams) { p.MaxDABlobSize = Ptr(uint64(0)) },
		func(p *RdkParams) { p.MaxDABlobSize = Ptr(uint64(8<<20 + 1)) },
		func(p *RdkParams) { p.BlobRetentionBlocks = Ptr(uint64(0)) },
		func(p *RdkParams) { p.MaxBatchesPerBlock = Ptr(uint32(0)) },
		func(p *RdkParams) { p.MinSubmitterBond = nil },
	}
	for i, m := range mut {
		p := fullRdkParams()
		m(&p)
		if _, err := NewRdkUpdateParams("qor1gov", p); err == nil {
			t.Errorf("mutation %d accepted", i)
		}
	}
	p := fullRdkParams()
	p.PostedDataFeePerByte = Ptr(uint64(0)) // explicit zero is allowed
	if _, err := NewRdkUpdateParams("qor1gov", p); err != nil {
		t.Errorf("explicit zero refused: %v", err)
	}
}

type fakeRdk struct{ r *rdkv1.QueryParamsResponse }

func (f fakeRdk) GetRdkParams() (*rdkv1.QueryParamsResponse, error) { return f.r, nil }

func TestRdkUpdateParamsFromCurrent(t *testing.T) {
	cur := &rdkv1.QueryParamsResponse{Params: &rdkv1.ParamsView{MaxRollups: 100, MinStakeForRollup: 5, RollupCreationBurnRate: "0.01",
		DefaultChallengeWindow: 600, MaxDaBlobSize: 1024, BlobRetentionBlocks: 10, MaxBatchesPerBlock: 2,
		FinalizedBatchRetentionBlocks: 8, MaxPostedDataBytes: 9, MaxPostedDataBytesPerBlock: 10, PostedDataFeePerByte: 11,
		PostedDataRetentionBlocks: 12, MinSubmitterBond: 13}}
	msg, err := RdkUpdateParamsFromCurrent(fakeRdk{cur}, "qor1gov", RdkParams{MaxRollups: Ptr(uint32(5))})
	if err != nil {
		t.Fatal(err)
	}
	if msg.MaxRollups != 5 || msg.MinSubmitterBond != 13 || msg.FinalizedBatchRetentionBlocks != 8 {
		t.Fatalf("msg = %+v", msg)
	}
	if _, err := RdkUpdateParamsFromCurrent(fakeRdk{&rdkv1.QueryParamsResponse{}}, "g", RdkParams{}); err == nil {
		t.Fatal("empty params accepted")
	}
}

func TestCrossVMAsyncBudget(t *testing.T) {
	msg, err := CrossVM.CallAsync("qor1s", "cosmwasm", "qor1c", []byte("{}"), nil, 300_000, 2_000_000)
	if err != nil || !msg.Async || msg.AsyncGasLimit != 300_000 || msg.AsyncMaxFactor != 2_000_000 {
		t.Fatalf("msg = %+v, err = %v", msg, err)
	}
	if _, err := CrossVM.CallAsync("qor1s", "cosmwasm", "qor1c", nil, nil, 0, 0); err != nil {
		t.Fatalf("defaults refused: %v", err)
	}
	for _, g := range []uint64{249_999, 10_000_001} {
		if _, err := CrossVM.CallAsync("qor1s", "cosmwasm", "qor1c", nil, nil, g, 0); err == nil {
			t.Errorf("gas %d accepted", g)
		}
	}
	if _, err := CrossVM.CallAsync("qor1s", "evm", "0xabc", nil, nil, 300_000, 0); err == nil {
		t.Error("budget on a non-CosmWasm target accepted")
	}
	sync := CrossVM.Call("qor1s", "evm", "cosmwasm", "qor1c", nil, nil, false)
	sync.AsyncMaxFactor = 1
	if err := ValidateCrossVMCall(sync); err == nil {
		t.Error("budget on a synchronous call accepted")
	}
}

func TestOpenEVMWindowScopeV328(t *testing.T) {
	sender, _ := bech32.ConvertAndEncode("qor", make([]byte, 20))
	valoper, _ := bech32.ConvertAndEncode("qorvaloper", bytes.Repeat([]byte{1}, 20))
	scope := EVMWindowScope{
		Validators:        []string{"0x" + strings.Repeat("ab", 20)},
		StakingValidators: []string{valoper},
		IBCReceivers:      []string{"channel-0/cosmos1abc"},
	}
	msg, err := NewOpenEVMWindowWithScope(sender, 100, 5, "1000", scope)
	if err != nil {
		t.Fatal(err)
	}
	if len(msg.Validators) != 1 || msg.StakingValidators[0] != valoper || msg.IbcReceivers[0] != "channel-0/cosmos1abc" {
		t.Fatalf("msg = %+v", msg)
	}
	bad := []EVMWindowScope{
		{Validators: []string{"0x12"}},
		{StakingValidators: []string{sender}},
		{IBCReceivers: []string{"cosmos1abc"}},
		{IBCReceivers: []string{"/cosmos1abc"}},
		{IBCReceivers: []string{"channel-0/a,b"}},
		{IBCReceivers: []string{"channel-0/"}},
		{IBCReceivers: []string{"channel-0/a", "channel-0/a"}},
	}
	for i, s := range bad {
		if _, err := NewOpenEVMWindowWithScope(sender, 100, 5, "1000", s); err == nil {
			t.Errorf("scope %d accepted", i)
		}
	}
}
