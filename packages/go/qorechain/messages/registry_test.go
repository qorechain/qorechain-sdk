package messages

import (
	"testing"

	"cosmossdk.io/math"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"

	ammv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/amm/v1"
	bridgev1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/bridge/v1"
	rdkv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/rdk/v1"
	svmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/svm/v1"
)

// allCustomTypeURLs is every custom QoreChain Msg type URL the registry must
// resolve. The 53 entries match the chain's tx services across all 11 modules.
var allCustomTypeURLs = []string{
	// amm (7)
	"/qorechain.amm.v1.MsgCreatePool",
	"/qorechain.amm.v1.MsgAddLiquidity",
	"/qorechain.amm.v1.MsgRemoveLiquidity",
	"/qorechain.amm.v1.MsgSwapExactIn",
	"/qorechain.amm.v1.MsgSwapExactOut",
	"/qorechain.amm.v1.MsgPausePool",
	"/qorechain.amm.v1.MsgResumePool",
	// bridge (7)
	"/qorechain.bridge.v1.MsgBridgeDeposit",
	"/qorechain.bridge.v1.MsgBridgeWithdraw",
	"/qorechain.bridge.v1.MsgRegisterBridgeValidator",
	"/qorechain.bridge.v1.MsgBridgeAttestation",
	"/qorechain.bridge.v1.MsgUpdateEthLightClient",
	"/qorechain.bridge.v1.MsgUpdateChainConfig",
	"/qorechain.bridge.v1.MsgSetVerifierBootstrap",
	// rdk (8)
	"/qorechain.rdk.v1.MsgCreateRollup",
	"/qorechain.rdk.v1.MsgSubmitBatch",
	"/qorechain.rdk.v1.MsgChallengeBatch",
	"/qorechain.rdk.v1.MsgResolveChallenge",
	"/qorechain.rdk.v1.MsgPauseRollup",
	"/qorechain.rdk.v1.MsgResumeRollup",
	"/qorechain.rdk.v1.MsgStopRollup",
	"/qorechain.rdk.v1.MsgExecuteWithdrawal",
	// multilayer (6)
	"/qorechain.multilayer.v1.MsgRegisterSidechain",
	"/qorechain.multilayer.v1.MsgRegisterPaychain",
	"/qorechain.multilayer.v1.MsgAnchorState",
	"/qorechain.multilayer.v1.MsgRouteTransaction",
	"/qorechain.multilayer.v1.MsgUpdateLayerStatus",
	"/qorechain.multilayer.v1.MsgChallengeAnchor",
	// pqc (5)
	"/qorechain.pqc.v1.MsgRegisterPQCKey",
	"/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
	"/qorechain.pqc.v1.MsgMigratePQCKey",
	"/qorechain.pqc.v1.MsgDeprecateAlgorithm",
	"/qorechain.pqc.v1.MsgDisableAlgorithm",
	// svm (4)
	"/qorechain.svm.v1.MsgDeployProgram",
	"/qorechain.svm.v1.MsgCreateAccount",
	"/qorechain.svm.v1.MsgExecuteProgram",
	"/qorechain.svm.v1.MsgRegisterSVMPQCKey",
	// lightnode (4)
	"/qorechain.lightnode.v1.MsgRegisterLightNode",
	"/qorechain.lightnode.v1.MsgHeartbeat",
	"/qorechain.lightnode.v1.MsgDeregisterLightNode",
	"/qorechain.lightnode.v1.MsgClaimLightNodeRewards",
	// license (4)
	"/qorechain.license.v1.MsgGrantLicense",
	"/qorechain.license.v1.MsgRevokeLicense",
	"/qorechain.license.v1.MsgSuspendLicense",
	"/qorechain.license.v1.MsgResumeLicense",
	// abstractaccount (2)
	"/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
	"/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
	// crossvm (2)
	"/qorechain.crossvm.v1.MsgCrossVMCall",
	"/qorechain.crossvm.v1.MsgProcessQueue",
	// rlconsensus (4)
	"/qorechain.rlconsensus.v1.MsgSetAgentMode",
	"/qorechain.rlconsensus.v1.MsgResumeAgent",
	"/qorechain.rlconsensus.v1.MsgUpdatePolicy",
	"/qorechain.rlconsensus.v1.MsgUpdateRewardWeights",
}

func TestAllCustomTypeURLsCount(t *testing.T) {
	if got := len(allCustomTypeURLs); got != 53 {
		t.Fatalf("expected 53 custom type URLs, got %d", got)
	}
}

// TestRegistryResolvesAllCustomTypeURLs asserts every custom Msg type URL
// resolves to a registered concrete implementation in the default registry.
func TestRegistryResolvesAllCustomTypeURLs(t *testing.T) {
	reg := NewInterfaceRegistry()
	for _, url := range allCustomTypeURLs {
		t.Run(url, func(t *testing.T) {
			msg, err := reg.Resolve(url)
			if err != nil {
				t.Fatalf("resolve %s: %v", url, err)
			}
			if msg == nil {
				t.Fatalf("resolve %s returned nil", url)
			}
			if gotURL := "/" + proto.MessageName(msg); gotURL != url {
				t.Fatalf("resolved type URL mismatch: want %s, got %s", url, gotURL)
			}
		})
	}
}

// TestEncodeAnyDecodeRoundTrip is the gogo-compatibility proof: a populated
// custom Msg packs into a codec Any and decodes back through the registry to an
// equal value, including the cosmos math.Int and Coin custom-typed fields.
func TestEncodeAnyDecodeRoundTrip(t *testing.T) {
	original := &ammv1.MsgSwapExactIn{
		Sender:   "qor1xyz",
		PoolID:   42,
		TokenIn:  sdk.NewCoin("uqor", math.NewInt(1000)),
		DenomOut: "uusdc",
		MinOut:   math.NewInt(990),
	}

	any, err := PackAny(original)
	if err != nil {
		t.Fatalf("pack any: %v", err)
	}
	if any.TypeUrl != "/qorechain.amm.v1.MsgSwapExactIn" {
		t.Fatalf("unexpected type URL: %s", any.TypeUrl)
	}
	if len(any.Value) == 0 {
		t.Fatal("packed Any has empty value bytes")
	}

	// Decode through a fresh codec/registry (not reusing the cached pointer).
	codec := NewProtoCodec()
	var decodedMsg sdk.Msg
	if err := codec.UnpackAny(any, &decodedMsg); err != nil {
		t.Fatalf("unpack any: %v", err)
	}
	decoded, ok := decodedMsg.(*ammv1.MsgSwapExactIn)
	if !ok {
		t.Fatalf("decoded into wrong type: %T", decodedMsg)
	}
	if decoded.Sender != original.Sender || decoded.PoolID != original.PoolID ||
		decoded.DenomOut != original.DenomOut {
		t.Fatalf("scalar field mismatch: %+v", decoded)
	}
	if !decoded.TokenIn.IsEqual(original.TokenIn) {
		t.Fatalf("TokenIn mismatch: want %s, got %s", original.TokenIn, decoded.TokenIn)
	}
	if !decoded.MinOut.Equal(original.MinOut) {
		t.Fatalf("MinOut mismatch: want %s, got %s", original.MinOut, decoded.MinOut)
	}
}

// TestSvmBytes32RoundTrip exercises the gogo customtype path (32-byte fixed
// arrays) through the codec Any.
func TestSvmBytes32RoundTrip(t *testing.T) {
	var pid svmv1.Bytes32
	for i := range pid {
		pid[i] = byte(i + 1)
	}
	original := &svmv1.MsgExecuteProgram{
		Sender:    "qor1abc",
		ProgramID: pid,
		Accounts: []svmv1.SvmAccountMeta{
			{Address: pid, IsSigner: true, IsWritable: false},
		},
		Data: []byte{0xde, 0xad, 0xbe, 0xef},
	}

	any, err := PackAny(original)
	if err != nil {
		t.Fatalf("pack any: %v", err)
	}
	var decodedMsg sdk.Msg
	if err := DefaultProtoCodec().UnpackAny(any, &decodedMsg); err != nil {
		t.Fatalf("unpack any: %v", err)
	}
	decoded := decodedMsg.(*svmv1.MsgExecuteProgram)
	if !decoded.ProgramID.Equal(original.ProgramID) {
		t.Fatalf("ProgramID mismatch: want %s, got %s", original.ProgramID, decoded.ProgramID)
	}
	if len(decoded.Accounts) != 1 || !decoded.Accounts[0].Address.Equal(pid) {
		t.Fatalf("Accounts mismatch: %+v", decoded.Accounts)
	}
}

// TestExecuteWithdrawalRoundTrip exercises the rdk MsgExecuteWithdrawal repeated
// bytes (proof) field through the codec Any.
func TestExecuteWithdrawalRoundTrip(t *testing.T) {
	original := &rdkv1.MsgExecuteWithdrawal{
		Submitter:       "qor1submit",
		RollupID:        "rollup-1",
		BatchIndex:      7,
		WithdrawalIndex: 3,
		Recipient:       "qor1recipient",
		Denom:           "uqor",
		Amount:          5000,
		Proof:           [][]byte{{0x01, 0x02}, {0x03, 0x04}, {0x05}},
	}

	any, err := PackAny(original)
	if err != nil {
		t.Fatalf("pack any: %v", err)
	}
	if any.TypeUrl != "/qorechain.rdk.v1.MsgExecuteWithdrawal" {
		t.Fatalf("unexpected type URL: %s", any.TypeUrl)
	}

	var decodedMsg sdk.Msg
	if err := DefaultProtoCodec().UnpackAny(any, &decodedMsg); err != nil {
		t.Fatalf("unpack any: %v", err)
	}
	decoded := decodedMsg.(*rdkv1.MsgExecuteWithdrawal)
	if decoded.Submitter != original.Submitter || decoded.RollupID != original.RollupID ||
		decoded.BatchIndex != original.BatchIndex || decoded.WithdrawalIndex != original.WithdrawalIndex ||
		decoded.Recipient != original.Recipient || decoded.Denom != original.Denom || decoded.Amount != original.Amount {
		t.Fatalf("scalar field mismatch: %+v", decoded)
	}
	if len(decoded.Proof) != 3 || string(decoded.Proof[0]) != "\x01\x02" || string(decoded.Proof[2]) != "\x05" {
		t.Fatalf("proof mismatch: %+v", decoded.Proof)
	}
}

// TestSetVerifierBootstrapRoundTrip exercises the bridge MsgSetVerifierBootstrap
// nested-submessage fields (WormholeGuardianSet) through the codec Any.
func TestSetVerifierBootstrapRoundTrip(t *testing.T) {
	original := &bridgev1.MsgSetVerifierBootstrap{
		Admin:   "qor1admin",
		ChainId: "eth",
		Wormhole: &bridgev1.WormholeGuardianSet{
			Addresses: [][]byte{{0xaa}, {0xbb}},
			Quorum:    2,
		},
	}

	any, err := PackAny(original)
	if err != nil {
		t.Fatalf("pack any: %v", err)
	}
	if any.TypeUrl != "/qorechain.bridge.v1.MsgSetVerifierBootstrap" {
		t.Fatalf("unexpected type URL: %s", any.TypeUrl)
	}

	var decodedMsg sdk.Msg
	if err := DefaultProtoCodec().UnpackAny(any, &decodedMsg); err != nil {
		t.Fatalf("unpack any: %v", err)
	}
	decoded := decodedMsg.(*bridgev1.MsgSetVerifierBootstrap)
	if decoded.Admin != original.Admin || decoded.ChainId != original.ChainId {
		t.Fatalf("scalar field mismatch: %+v", decoded)
	}
	if decoded.Wormhole == nil || decoded.Wormhole.Quorum != 2 || len(decoded.Wormhole.Addresses) != 2 {
		t.Fatalf("wormhole mismatch: %+v", decoded.Wormhole)
	}
}

var _ = codectypes.Any{}
