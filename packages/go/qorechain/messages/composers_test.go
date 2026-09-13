package messages

import (
	"testing"

	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"
	ibcclienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"

	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	svmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/svm/v1"
)

func ibcZeroHeight() ibcclienttypes.Height { return ibcclienttypes.Height{} }

func typeURL(m proto.Message) string { return "/" + proto.MessageName(m) }

// TestStandardCosmosComposerTypeURLs asserts each standard Cosmos builder
// produces the canonical /cosmos.* / /ibc.* type URL.
func TestStandardCosmosComposerTypeURLs(t *testing.T) {
	coins := sdk.NewCoins(sdk.NewCoin("uqor", math.NewInt(1)))
	coin := sdk.NewCoin("uqor", math.NewInt(1))
	cases := map[string]proto.Message{
		"/cosmos.bank.v1beta1.MsgSend":                            Bank.Send("a", "b", coins),
		"/cosmos.bank.v1beta1.MsgMultiSend":                       Bank.MultiSend(nil, nil),
		"/cosmos.staking.v1beta1.MsgDelegate":                     Staking.Delegate("a", "v", coin),
		"/cosmos.staking.v1beta1.MsgUndelegate":                   Staking.Undelegate("a", "v", coin),
		"/cosmos.staking.v1beta1.MsgBeginRedelegate":              Staking.BeginRedelegate("a", "v1", "v2", coin),
		"/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": Distribution.WithdrawDelegatorReward("a", "v"),
		"/cosmos.distribution.v1beta1.MsgSetWithdrawAddress":      Distribution.SetWithdrawAddress("a", "b"),
		"/cosmos.distribution.v1beta1.MsgFundCommunityPool":       Distribution.FundCommunityPool("a", coins),
		"/cosmos.gov.v1.MsgVote":                                  Gov.Vote(1, "a", 1, ""),
		"/cosmos.gov.v1.MsgDeposit":                               Gov.Deposit(1, "a", coins),
		"/cosmos.authz.v1beta1.MsgRevoke":                         Authz.Revoke("a", "b", "/cosmos.bank.v1beta1.MsgSend"),
		"/cosmos.feegrant.v1beta1.MsgRevokeAllowance":             Feegrant.RevokeAllowance("a", "b"),
		"/ibc.applications.transfer.v1.MsgTransfer":               IBC.Transfer("transfer", "channel-0", coin, "a", "b", ibcZeroHeight(), 0, ""),
	}
	for want, msg := range cases {
		if got := typeURL(msg); got != want {
			t.Errorf("type URL mismatch: want %s, got %s", want, got)
		}
	}
}

// TestQoreChainComposerTypeURLs asserts a representative QoreChain composer from
// each module produces the expected custom type URL.
func TestQoreChainComposerTypeURLs(t *testing.T) {
	coin := sdk.NewCoin("uqor", math.NewInt(1))
	coins := sdk.NewCoins(coin)
	cases := map[string]proto.Message{
		"/qorechain.amm.v1.MsgSwapExactIn":                       Amm.SwapExactIn("s", 1, coin, "uusdc", math.NewInt(1)),
		"/qorechain.bridge.v1.MsgBridgeWithdraw":                 Bridge.Withdraw("s", "eth", "0xabc", "uqor", "1"),
		"/qorechain.bridge.v1.MsgUpdateEthLightClient":           Bridge.UpdateEthLightClient("r", []byte{1}),
		"/qorechain.bridge.v1.MsgUpdateChainConfig":              Bridge.UpdateChainConfig("a", "eth", "0xbridge", 12, "evm", "active", "light_client", "0xtopic"),
		"/qorechain.bridge.v1.MsgSetVerifierBootstrap":           Bridge.SetVerifierBootstrap("a", "eth", nil, nil, nil, nil, nil),
		"/qorechain.rdk.v1.MsgCreateRollup":                      Rdk.CreateRollup("s", "r1", "default", "evm", 1),
		"/qorechain.rdk.v1.MsgExecuteWithdrawal":                 Rdk.ExecuteWithdrawal("s", "r1", 1, 0, "qor1rcpt", "uqor", 100, [][]byte{{0x01}}),
		"/qorechain.multilayer.v1.MsgRouteTransaction":           Multilayer.RouteTransaction("s", nil, "", 0, ""),
		"/qorechain.pqc.v1.MsgRegisterPQCKeyV2":                  Pqc.RegisterKeyV2("s", nil, 1, nil, ""),
		"/qorechain.svm.v1.MsgDeployProgram":                     Svm.DeployProgram("s", []byte{1}),
		"/qorechain.lightnode.v1.MsgHeartbeat":                   Lightnode.Heartbeat("s"),
		"/qorechain.license.v1.MsgGrantLicense":                  License.Grant("a", "g", "f", 0, ""),
		"/qorechain.abstractaccount.v1.MsgCreateAbstractAccount": AbstractAccount.Create("o", "smart"),
		"/qorechain.abstractaccount.v1.MsgRegisterAuthenticator": AbstractAccount.RegisterAuthenticator("o", "qor1acct", "ed25519", []byte{0x01}, []string{"send"}, 0, "phantom"),
		"/qorechain.abstractaccount.v1.MsgRevokeAuthenticator":   AbstractAccount.RevokeAuthenticator("o", "qor1acct", "ed25519", []byte{0x01}),
		"/qorechain.abstractaccount.v1.MsgExecuteEVM":            AbstractAccount.ExecuteEVM("qor1relayer", "qor1acct", "ed25519", []byte{0x01}, []byte{0x02}, "0xabc", "1000", []byte{0x02, 0x02}, 100000, 5),
		"/qorechain.abstractaccount.v1.MsgExecuteCosmos":         AbstractAccount.ExecuteCosmos("qor1relayer", "qor1acct", "ed25519", []byte{0x01}, []byte{0x02}, "qor1recv", coins, 3),
		"/qorechain.pqc.v1.MsgRotatePQCKey":                      Pqc.RotatePQCKey("qor1acct", []byte{0xaa}, []byte{0xbb}, []byte{0x01}, []byte{0x02}),
		"/qorechain.crossvm.v1.MsgCrossVMCall":                   CrossVM.Call("s", "evm", "svm", "prog", []byte{0x01}, coins, false),
		"/qorechain.crossvm.v1.MsgProcessQueue":                  CrossVM.ProcessQueue("a"),
		"/qorechain.svm.v1.MsgUpdateParams":                      Svm.UpdateParams("qor1gov", svmParamsFixture()),
		"/qorechain.rlconsensus.v1.MsgSetAgentMode":              RlConsensus.SetAgentMode("a", 1),
	}
	for want, msg := range cases {
		if got := typeURL(msg); got != want {
			t.Errorf("type URL mismatch: want %s, got %s", want, got)
		}
		// Each composed message must also pack into an Any via the default registry.
		if _, err := PackAny(msg.(sdk.Msg)); err != nil {
			t.Errorf("pack %s: %v", want, err)
		}
	}
}

// svmParamsFixture is a fully-populated SVMParams for the governance
// MsgUpdateParams composer. MsgUpdateParams replaces the params WHOLESALE, so a
// realistic fixture sets every field rather than relying on zero values.
func svmParamsFixture() svmv1.SVMParams {
	return svmv1.SVMParams{
		MaxProgramSize:     1 << 20,
		MaxAccountDataSize: 10 * 1024,
		ComputeBudgetMax:   1_400_000,
		LamportsPerByte:    6960,
		RentExemptionMulti: math.LegacyMustNewDecFromStr("2.0"),
		Enabled:            false,
		SvmSlotOffset:      12,
		DefaultSigScheme:   1,
		MaxCpi:             4,
	}
}

// TestSvmUpdateParamsComposer asserts the governance composer produces the new
// type URL and carries the params through — Enabled in particular, which is the
// switch that turns the SVM lane off by proposal instead of by binary release.
func TestSvmUpdateParamsComposer(t *testing.T) {
	params := svmParamsFixture()
	msg := Svm.UpdateParams("qor1gov", params)

	if got, want := typeURL(msg), "/qorechain.svm.v1.MsgUpdateParams"; got != want {
		t.Fatalf("type URL = %s, want %s", got, want)
	}
	if msg.Authority != "qor1gov" {
		t.Errorf("authority = %q, want qor1gov", msg.Authority)
	}
	if msg.Params.Enabled {
		t.Error("Enabled must round-trip as false")
	}
	if msg.Params.MaxProgramSize != params.MaxProgramSize || msg.Params.MaxCpi != params.MaxCpi {
		t.Errorf("params not carried through: %+v", msg.Params)
	}
}

// TestSvmUpdateParamsAnyRoundTrip packs the governance message into a codec Any
// and decodes it back through the registry, covering the nested SVMParams and
// its LegacyDec custom type.
func TestSvmUpdateParamsAnyRoundTrip(t *testing.T) {
	original := Svm.UpdateParams("qor1gov", svmParamsFixture())

	any, err := PackAny(original)
	if err != nil {
		t.Fatalf("pack any: %v", err)
	}
	if any.TypeUrl != "/qorechain.svm.v1.MsgUpdateParams" {
		t.Fatalf("type URL = %s", any.TypeUrl)
	}

	var decodedMsg sdk.Msg
	if err := NewProtoCodec().UnpackAny(any, &decodedMsg); err != nil {
		t.Fatalf("unpack any: %v", err)
	}
	decoded, ok := decodedMsg.(*svmv1.MsgUpdateParams)
	if !ok {
		t.Fatalf("decoded into wrong type: %T", decodedMsg)
	}
	if decoded.Authority != original.Authority {
		t.Errorf("authority = %q, want %q", decoded.Authority, original.Authority)
	}
	if decoded.Params.Enabled != original.Params.Enabled {
		t.Errorf("Enabled = %v, want %v", decoded.Params.Enabled, original.Params.Enabled)
	}
	if decoded.Params.MaxAccountDataSize != original.Params.MaxAccountDataSize ||
		decoded.Params.ComputeBudgetMax != original.Params.ComputeBudgetMax ||
		decoded.Params.LamportsPerByte != original.Params.LamportsPerByte ||
		decoded.Params.SvmSlotOffset != original.Params.SvmSlotOffset ||
		decoded.Params.DefaultSigScheme != original.Params.DefaultSigScheme ||
		decoded.Params.MaxCpi != original.Params.MaxCpi {
		t.Errorf("params mismatch: %+v", decoded.Params)
	}
	if !decoded.Params.RentExemptionMulti.Equal(original.Params.RentExemptionMulti) {
		t.Errorf("RentExemptionMulti = %s, want %s",
			decoded.Params.RentExemptionMulti, original.Params.RentExemptionMulti)
	}
}

// TestCrossVMCallComposerAsync asserts the async flag reaches the message and
// that the default (false) means "execute now and return the answer".
func TestCrossVMCallComposerAsync(t *testing.T) {
	sync := CrossVM.Call("qor1s", "evm", "cosmwasm", "qor1contract", []byte{0x01}, nil, false)
	if sync.Async {
		t.Error("async must be false when not requested")
	}
	async := CrossVM.Call("qor1s", "evm", "cosmwasm", "qor1contract", []byte{0x01}, nil, true)
	if !async.Async {
		t.Error("async flag did not reach the message")
	}
	// The flag must survive an Any round-trip (proto3 bools are omitted when
	// false, so only the true case carries wire bytes).
	any, err := PackAny(async)
	if err != nil {
		t.Fatalf("pack any: %v", err)
	}
	var decodedMsg sdk.Msg
	if err := NewProtoCodec().UnpackAny(any, &decodedMsg); err != nil {
		t.Fatalf("unpack any: %v", err)
	}
	if !decodedMsg.(*crossvmv1.MsgCrossVMCall).Async {
		t.Error("async lost through the Any round-trip")
	}
}
