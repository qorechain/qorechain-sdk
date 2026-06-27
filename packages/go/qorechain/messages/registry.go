// Package messages provides the interface registry, codec, and typed message
// composers for every transaction QoreChain supports.
//
// The registry registers all 53 custom QoreChain Msg implementations (across the
// 11 custom modules) plus the standard Cosmos SDK modules under their type URLs,
// so a custom Msg can be packed into a tx Any and decoded back through the codec
// exactly like the chain does. RegisterInterfaces mirrors each module's
// RegisterInterfaces on the chain.
package messages

import (
	feegranttypes "cosmossdk.io/x/feegrant"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	cryptocodec "github.com/cosmos/cosmos-sdk/crypto/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	txtypes "github.com/cosmos/cosmos-sdk/types/tx"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	authztypes "github.com/cosmos/cosmos-sdk/x/authz"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	distrtypes "github.com/cosmos/cosmos-sdk/x/distribution/types"
	govv1types "github.com/cosmos/cosmos-sdk/x/gov/types/v1"
	govv1beta1types "github.com/cosmos/cosmos-sdk/x/gov/types/v1beta1"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
	ibctransfertypes "github.com/cosmos/ibc-go/v8/modules/apps/transfer/types"

	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
	ammv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/amm/v1"
	bridgev1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/bridge/v1"
	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	licensev1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/license/v1"
	lightnodev1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/lightnode/v1"
	multilayerv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/multilayer/v1"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
	rdkv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/rdk/v1"
	rlconsensusv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/rlconsensus/v1"
	svmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/svm/v1"
)

// RegisterInterfaces registers every QoreChain custom Msg implementation plus the
// standard Cosmos SDK message and crypto interfaces into reg. After this call,
// the codec can pack any of these messages into an Any and unpack them back.
func RegisterInterfaces(reg codectypes.InterfaceRegistry) {
	registerQoreChainInterfaces(reg)
	registerCosmosInterfaces(reg)
}

// registerQoreChainInterfaces registers all 53 custom QoreChain Msg
// implementations under the sdk.Msg interface.
func registerQoreChainInterfaces(reg codectypes.InterfaceRegistry) {
	reg.RegisterImplementations((*sdk.Msg)(nil),
		// amm (7)
		&ammv1.MsgCreatePool{},
		&ammv1.MsgAddLiquidity{},
		&ammv1.MsgRemoveLiquidity{},
		&ammv1.MsgSwapExactIn{},
		&ammv1.MsgSwapExactOut{},
		&ammv1.MsgPausePool{},
		&ammv1.MsgResumePool{},
		// bridge (7)
		&bridgev1.MsgBridgeDeposit{},
		&bridgev1.MsgBridgeWithdraw{},
		&bridgev1.MsgRegisterBridgeValidator{},
		&bridgev1.MsgBridgeAttestation{},
		&bridgev1.MsgUpdateEthLightClient{},
		&bridgev1.MsgUpdateChainConfig{},
		&bridgev1.MsgSetVerifierBootstrap{},
		// rdk (8)
		&rdkv1.MsgCreateRollup{},
		&rdkv1.MsgSubmitBatch{},
		&rdkv1.MsgChallengeBatch{},
		&rdkv1.MsgResolveChallenge{},
		&rdkv1.MsgPauseRollup{},
		&rdkv1.MsgResumeRollup{},
		&rdkv1.MsgStopRollup{},
		&rdkv1.MsgExecuteWithdrawal{},
		// multilayer (6)
		&multilayerv1.MsgRegisterSidechain{},
		&multilayerv1.MsgRegisterPaychain{},
		&multilayerv1.MsgAnchorState{},
		&multilayerv1.MsgRouteTransaction{},
		&multilayerv1.MsgUpdateLayerStatus{},
		&multilayerv1.MsgChallengeAnchor{},
		// pqc (5)
		&pqcv1.MsgRegisterPQCKey{},
		&pqcv1.MsgRegisterPQCKeyV2{},
		&pqcv1.MsgMigratePQCKey{},
		&pqcv1.MsgDeprecateAlgorithm{},
		&pqcv1.MsgDisableAlgorithm{},
		// svm (4)
		&svmv1.MsgDeployProgram{},
		&svmv1.MsgCreateAccount{},
		&svmv1.MsgExecuteProgram{},
		&svmv1.MsgRegisterSVMPQCKey{},
		// lightnode (4)
		&lightnodev1.MsgRegisterLightNode{},
		&lightnodev1.MsgHeartbeat{},
		&lightnodev1.MsgDeregisterLightNode{},
		&lightnodev1.MsgClaimLightNodeRewards{},
		// license (4)
		&licensev1.MsgGrantLicense{},
		&licensev1.MsgRevokeLicense{},
		&licensev1.MsgSuspendLicense{},
		&licensev1.MsgResumeLicense{},
		// abstractaccount (2)
		&abstractaccountv1.MsgCreateAbstractAccount{},
		&abstractaccountv1.MsgUpdateSpendingRules{},
		// crossvm (2)
		&crossvmv1.MsgCrossVMCall{},
		&crossvmv1.MsgProcessQueue{},
		// rlconsensus (4)
		&rlconsensusv1.MsgSetAgentMode{},
		&rlconsensusv1.MsgResumeAgent{},
		&rlconsensusv1.MsgUpdatePolicy{},
		&rlconsensusv1.MsgUpdateRewardWeights{},
	)
}

// registerCosmosInterfaces registers the standard Cosmos SDK message, account,
// and crypto interfaces so the SDK can build bank/staking/distribution/gov/
// authz/feegrant transactions and resolve public keys in tx AuthInfo.
func registerCosmosInterfaces(reg codectypes.InterfaceRegistry) {
	cryptocodec.RegisterInterfaces(reg)
	authtypes.RegisterInterfaces(reg)
	banktypes.RegisterInterfaces(reg)
	stakingtypes.RegisterInterfaces(reg)
	distrtypes.RegisterInterfaces(reg)
	govv1types.RegisterInterfaces(reg)
	govv1beta1types.RegisterInterfaces(reg)
	authztypes.RegisterInterfaces(reg)
	feegranttypes.RegisterInterfaces(reg)
	ibctransfertypes.RegisterInterfaces(reg)
	// Register the tx message-service descriptors so msgservice resolution works.
	txtypes.RegisterInterfaces(reg)
}
