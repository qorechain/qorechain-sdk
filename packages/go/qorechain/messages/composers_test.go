package messages

import (
	"testing"

	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"
	ibcclienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
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
	cases := map[string]proto.Message{
		"/qorechain.amm.v1.MsgSwapExactIn":                       Amm.SwapExactIn("s", 1, coin, "uusdc", math.NewInt(1)),
		"/qorechain.bridge.v1.MsgBridgeWithdraw":                 Bridge.Withdraw("s", "eth", "0xabc", "uqor", "1"),
		"/qorechain.rdk.v1.MsgCreateRollup":                      Rdk.CreateRollup("s", "r1", "default", "evm", 1),
		"/qorechain.multilayer.v1.MsgRouteTransaction":           Multilayer.RouteTransaction("s", nil, "", 0, ""),
		"/qorechain.pqc.v1.MsgRegisterPQCKeyV2":                  Pqc.RegisterKeyV2("s", nil, 1, nil, ""),
		"/qorechain.svm.v1.MsgDeployProgram":                     Svm.DeployProgram("s", []byte{1}),
		"/qorechain.lightnode.v1.MsgHeartbeat":                   Lightnode.Heartbeat("s"),
		"/qorechain.license.v1.MsgGrantLicense":                  License.Grant("a", "g", "f", 0, ""),
		"/qorechain.abstractaccount.v1.MsgCreateAbstractAccount": AbstractAccount.Create("o", "smart"),
		"/qorechain.crossvm.v1.MsgProcessQueue":                  CrossVM.ProcessQueue("a"),
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
