package messages

import (
	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"

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

// The composers below are thin, typed constructors that return the generated
// proto Msg ready to pass to tx.SendMessages or to pack with PackAny. They are
// grouped per module under package-level values (Amm, Bridge, …) so callers can
// write messages.Amm.SwapExactIn(...). Each returns a concrete *Msg type (which
// satisfies sdk.Msg) — no hidden defaults are applied.

// ---- amm ----

// AmmComposers builds amm module messages.
type AmmComposers struct{}

// Amm is the amm message composer group.
var Amm AmmComposers

// CreatePool builds MsgCreatePool.
func (AmmComposers) CreatePool(creator string, poolType ammv1.PoolType, depositA, depositB sdk.Coin, amplificationCoefficient uint32) *ammv1.MsgCreatePool {
	return &ammv1.MsgCreatePool{Creator: creator, PoolType: poolType, InitialDepositA: depositA, InitialDepositB: depositB, AmplificationCoefficient: amplificationCoefficient}
}

// AddLiquidity builds MsgAddLiquidity.
func (AmmComposers) AddLiquidity(sender string, poolID uint64, amountA, amountB sdk.Coin, minLPOut math.Int) *ammv1.MsgAddLiquidity {
	return &ammv1.MsgAddLiquidity{Sender: sender, PoolID: poolID, AmountA: amountA, AmountB: amountB, MinLPOut: minLPOut}
}

// RemoveLiquidity builds MsgRemoveLiquidity.
func (AmmComposers) RemoveLiquidity(sender string, poolID uint64, lpAmount, minAmountA, minAmountB math.Int) *ammv1.MsgRemoveLiquidity {
	return &ammv1.MsgRemoveLiquidity{Sender: sender, PoolID: poolID, LPAmount: lpAmount, MinAmountA: minAmountA, MinAmountB: minAmountB}
}

// SwapExactIn builds MsgSwapExactIn.
func (AmmComposers) SwapExactIn(sender string, poolID uint64, tokenIn sdk.Coin, denomOut string, minOut math.Int) *ammv1.MsgSwapExactIn {
	return &ammv1.MsgSwapExactIn{Sender: sender, PoolID: poolID, TokenIn: tokenIn, DenomOut: denomOut, MinOut: minOut}
}

// SwapExactOut builds MsgSwapExactOut.
func (AmmComposers) SwapExactOut(sender string, poolID uint64, denomIn string, tokenOut sdk.Coin, maxIn math.Int) *ammv1.MsgSwapExactOut {
	return &ammv1.MsgSwapExactOut{Sender: sender, PoolID: poolID, DenomIn: denomIn, TokenOut: tokenOut, MaxIn: maxIn}
}

// PausePool builds MsgPausePool.
func (AmmComposers) PausePool(authority string, poolID uint64, reason string) *ammv1.MsgPausePool {
	return &ammv1.MsgPausePool{Authority: authority, PoolID: poolID, Reason: reason}
}

// ResumePool builds MsgResumePool.
func (AmmComposers) ResumePool(authority string, poolID uint64) *ammv1.MsgResumePool {
	return &ammv1.MsgResumePool{Authority: authority, PoolID: poolID}
}

// ---- bridge ----

// BridgeComposers builds bridge module messages.
type BridgeComposers struct{}

// Bridge is the bridge message composer group.
var Bridge BridgeComposers

// Deposit builds MsgBridgeDeposit.
func (BridgeComposers) Deposit(sender, sourceChain, sourceTxHash, asset, amount string, validatorSigs, pqcCommitment []byte) *bridgev1.MsgBridgeDeposit {
	return &bridgev1.MsgBridgeDeposit{Sender: sender, SourceChain: sourceChain, SourceTxHash: sourceTxHash, Asset: asset, Amount: amount, BridgeValidatorSigs: validatorSigs, PQCCommitment: pqcCommitment}
}

// Withdraw builds MsgBridgeWithdraw.
func (BridgeComposers) Withdraw(sender, destinationChain, destinationAddress, asset, amount string) *bridgev1.MsgBridgeWithdraw {
	return &bridgev1.MsgBridgeWithdraw{Sender: sender, DestinationChain: destinationChain, DestinationAddress: destinationAddress, Asset: asset, Amount: amount}
}

// RegisterValidator builds MsgRegisterBridgeValidator.
func (BridgeComposers) RegisterValidator(validatorAddress string, pqcPubkey []byte, supportedChains []string) *bridgev1.MsgRegisterBridgeValidator {
	return &bridgev1.MsgRegisterBridgeValidator{ValidatorAddress: validatorAddress, PQCPubkey: pqcPubkey, SupportedChains: supportedChains}
}

// Attestation builds MsgBridgeAttestation.
func (BridgeComposers) Attestation(validator, chain, eventType, operationID, txHash string, amount math.Int, asset string, proof, pqcSignature []byte) *bridgev1.MsgBridgeAttestation {
	return &bridgev1.MsgBridgeAttestation{Validator: validator, Chain: chain, EventType: eventType, OperationID: operationID, TxHash: txHash, Amount: amount, Asset: asset, Proof: proof, PQCSignature: pqcSignature}
}

// UpdateEthLightClient builds MsgUpdateEthLightClient. update is the encoded
// Altair LightClientUpdate bundle the chain verifies before advancing the
// on-chain light client.
func (BridgeComposers) UpdateEthLightClient(relayer string, update []byte) *bridgev1.MsgUpdateEthLightClient {
	return &bridgev1.MsgUpdateEthLightClient{Relayer: relayer, Update: update}
}

// UpdateChainConfig builds MsgUpdateChainConfig. Empty string / zero fields fall
// back to the existing config (handler merge semantics), so a caller can flip
// just status plus one verifier flag to activate a chain post-deploy.
func (BridgeComposers) UpdateChainConfig(admin, chainID, bridgeContract string, confirmationsRequired uint32, architecture, status, verifier, lockEventSig string) *bridgev1.MsgUpdateChainConfig {
	return &bridgev1.MsgUpdateChainConfig{Admin: admin, ChainId: chainID, BridgeContract: bridgeContract, ConfirmationsRequired: confirmationsRequired, Architecture: architecture, Status: status, Verifier: verifier, LockEventSig: lockEventSig}
}

// SetVerifierBootstrap builds MsgSetVerifierBootstrap. Exactly one verifier
// trust root should be populated; the handler routes by which is non-nil. Pass
// nil for the unused roots and an empty slice for an unused starknetStateRoot.
func (BridgeComposers) SetVerifierBootstrap(admin, chainID string, wormhole *bridgev1.WormholeGuardianSet, ed25519, bls *bridgev1.ValidatorQuorum, bitcoin *bridgev1.BitcoinCheckpoint, starknetStateRoot []byte) *bridgev1.MsgSetVerifierBootstrap {
	return &bridgev1.MsgSetVerifierBootstrap{Admin: admin, ChainId: chainID, Wormhole: wormhole, Ed25519: ed25519, Bls: bls, Bitcoin: bitcoin, StarknetStateRoot: starknetStateRoot}
}

// ---- rdk ----

// RdkComposers builds rdk module messages.
type RdkComposers struct{}

// Rdk is the rdk message composer group.
var Rdk RdkComposers

// CreateRollup builds MsgCreateRollup.
func (RdkComposers) CreateRollup(creator, rollupID, profile, vmType string, stakeAmount int64) *rdkv1.MsgCreateRollup {
	return &rdkv1.MsgCreateRollup{Creator: creator, RollupID: rollupID, Profile: profile, VmType: vmType, StakeAmount: stakeAmount}
}

// SubmitBatch builds MsgSubmitBatch. withdrawalsRoot commits the batch's L2->L1
// messages (withdrawals) as a binary-Merkle root; pass nil when the batch
// carries no cross-layer messages.
func (RdkComposers) SubmitBatch(sequencer, rollupID string, batchIndex uint64, stateRoot, prevStateRoot []byte, txCount uint64, dataHash, proof, withdrawalsRoot []byte) *rdkv1.MsgSubmitBatch {
	return &rdkv1.MsgSubmitBatch{Sequencer: sequencer, RollupID: rollupID, BatchIndex: batchIndex, StateRoot: stateRoot, PrevStateRoot: prevStateRoot, TxCount: txCount, DataHash: dataHash, Proof: proof, WithdrawalsRoot: withdrawalsRoot}
}

// ChallengeBatch builds MsgChallengeBatch.
func (RdkComposers) ChallengeBatch(challenger, rollupID string, batchIndex uint64, proof []byte) *rdkv1.MsgChallengeBatch {
	return &rdkv1.MsgChallengeBatch{Challenger: challenger, RollupID: rollupID, BatchIndex: batchIndex, Proof: proof}
}

// ResolveChallenge builds MsgResolveChallenge.
func (RdkComposers) ResolveChallenge(resolver, rollupID string, batchIndex uint64, fraudUpheld bool) *rdkv1.MsgResolveChallenge {
	return &rdkv1.MsgResolveChallenge{Resolver: resolver, RollupID: rollupID, BatchIndex: batchIndex, FraudUpheld: fraudUpheld}
}

// PauseRollup builds MsgPauseRollup.
func (RdkComposers) PauseRollup(creator, rollupID, reason string) *rdkv1.MsgPauseRollup {
	return &rdkv1.MsgPauseRollup{Creator: creator, RollupID: rollupID, Reason: reason}
}

// ResumeRollup builds MsgResumeRollup.
func (RdkComposers) ResumeRollup(creator, rollupID string) *rdkv1.MsgResumeRollup {
	return &rdkv1.MsgResumeRollup{Creator: creator, RollupID: rollupID}
}

// StopRollup builds MsgStopRollup.
func (RdkComposers) StopRollup(creator, rollupID string) *rdkv1.MsgStopRollup {
	return &rdkv1.MsgStopRollup{Creator: creator, RollupID: rollupID}
}

// ExecuteWithdrawal builds MsgExecuteWithdrawal. proof is the binary-Merkle
// sibling-hash path from the withdrawal leaf to the batch's withdrawals_root.
func (RdkComposers) ExecuteWithdrawal(submitter, rollupID string, batchIndex, withdrawalIndex uint64, recipient, denom string, amount int64, proof [][]byte) *rdkv1.MsgExecuteWithdrawal {
	return &rdkv1.MsgExecuteWithdrawal{Submitter: submitter, RollupID: rollupID, BatchIndex: batchIndex, WithdrawalIndex: withdrawalIndex, Recipient: recipient, Denom: denom, Amount: amount, Proof: proof}
}

// ---- multilayer ----

// MultilayerComposers builds multilayer module messages.
type MultilayerComposers struct{}

// Multilayer is the multilayer message composer group.
var Multilayer MultilayerComposers

// RegisterSidechain builds MsgRegisterSidechain.
func (MultilayerComposers) RegisterSidechain(creator, layerID, description string, targetBlockTimeMs, maxTransactionsPerBlock uint64, minValidators uint32, settlementIntervalBlocks uint64, supportedVMTypes, supportedDomains []string) *multilayerv1.MsgRegisterSidechain {
	return &multilayerv1.MsgRegisterSidechain{Creator: creator, LayerID: layerID, Description: description, TargetBlockTimeMs: targetBlockTimeMs, MaxTransactionsPerBlock: maxTransactionsPerBlock, MinValidators: minValidators, SettlementIntervalBlocks: settlementIntervalBlocks, SupportedVMTypes: supportedVMTypes, SupportedDomains: supportedDomains}
}

// RegisterPaychain builds MsgRegisterPaychain.
func (MultilayerComposers) RegisterPaychain(creator, layerID, description string, maxTransactionsPerBlock, settlementIntervalBlocks uint64, baseFeeMultiplier string) *multilayerv1.MsgRegisterPaychain {
	return &multilayerv1.MsgRegisterPaychain{Creator: creator, LayerID: layerID, Description: description, MaxTransactionsPerBlock: maxTransactionsPerBlock, SettlementIntervalBlocks: settlementIntervalBlocks, BaseFeeMultiplier: baseFeeMultiplier}
}

// AnchorState builds MsgAnchorState.
func (MultilayerComposers) AnchorState(relayer, layerID string, layerHeight uint64, stateRoot, validatorSetHash, pqcAggregateSignature []byte, transactionCount uint64, compressedStateProof []byte) *multilayerv1.MsgAnchorState {
	return &multilayerv1.MsgAnchorState{Relayer: relayer, LayerID: layerID, LayerHeight: layerHeight, StateRoot: stateRoot, ValidatorSetHash: validatorSetHash, PQCAggregateSignature: pqcAggregateSignature, TransactionCount: transactionCount, CompressedStateProof: compressedStateProof}
}

// RouteTransaction builds MsgRouteTransaction.
func (MultilayerComposers) RouteTransaction(sender string, payload []byte, preferredLayer string, maxLatencyMs uint64, maxFee string) *multilayerv1.MsgRouteTransaction {
	return &multilayerv1.MsgRouteTransaction{Sender: sender, TransactionPayload: payload, PreferredLayer: preferredLayer, MaxLatencyMs: maxLatencyMs, MaxFee: maxFee}
}

// UpdateLayerStatus builds MsgUpdateLayerStatus.
func (MultilayerComposers) UpdateLayerStatus(authority, layerID string, newStatus multilayerv1.LayerStatus, reason string) *multilayerv1.MsgUpdateLayerStatus {
	return &multilayerv1.MsgUpdateLayerStatus{Authority: authority, LayerID: layerID, NewStatus: newStatus, Reason: reason}
}

// ChallengeAnchor builds MsgChallengeAnchor.
func (MultilayerComposers) ChallengeAnchor(challenger, layerID string, anchorHeight uint64, fraudProof []byte, challengeReason string) *multilayerv1.MsgChallengeAnchor {
	return &multilayerv1.MsgChallengeAnchor{Challenger: challenger, LayerID: layerID, AnchorHeight: anchorHeight, FraudProof: fraudProof, ChallengeReason: challengeReason}
}

// ---- pqc ----

// PqcComposers builds pqc module messages.
type PqcComposers struct{}

// Pqc is the pqc message composer group.
var Pqc PqcComposers

// RegisterKey builds MsgRegisterPQCKey (legacy v1).
func (PqcComposers) RegisterKey(sender string, dilithiumPubkey, ecdsaPubkey []byte, keyType string) *pqcv1.MsgRegisterPQCKey {
	return &pqcv1.MsgRegisterPQCKey{Sender: sender, DilithiumPubkey: dilithiumPubkey, ECDSAPubkey: ecdsaPubkey, KeyType: keyType}
}

// RegisterKeyV2 builds MsgRegisterPQCKeyV2.
func (PqcComposers) RegisterKeyV2(sender string, publicKey []byte, algorithmID pqcv1.AlgorithmID, ecdsaPubkey []byte, keyType string) *pqcv1.MsgRegisterPQCKeyV2 {
	return &pqcv1.MsgRegisterPQCKeyV2{Sender: sender, PublicKey: publicKey, AlgorithmID: algorithmID, ECDSAPubkey: ecdsaPubkey, KeyType: keyType}
}

// MigrateKey builds MsgMigratePQCKey.
func (PqcComposers) MigrateKey(sender string, oldPublicKey, newPublicKey []byte, newAlgorithmID pqcv1.AlgorithmID, oldSignature, newSignature []byte) *pqcv1.MsgMigratePQCKey {
	return &pqcv1.MsgMigratePQCKey{Sender: sender, OldPublicKey: oldPublicKey, NewPublicKey: newPublicKey, NewAlgorithmID: newAlgorithmID, OldSignature: oldSignature, NewSignature: newSignature}
}

// DeprecateAlgorithm builds MsgDeprecateAlgorithm.
func (PqcComposers) DeprecateAlgorithm(authority string, algorithmID pqcv1.AlgorithmID, migrationBlocks int64, replacementAlgID pqcv1.AlgorithmID) *pqcv1.MsgDeprecateAlgorithm {
	return &pqcv1.MsgDeprecateAlgorithm{Authority: authority, AlgorithmID: algorithmID, MigrationBlocks: migrationBlocks, ReplacementAlgID: replacementAlgID}
}

// DisableAlgorithm builds MsgDisableAlgorithm.
func (PqcComposers) DisableAlgorithm(authority string, algorithmID pqcv1.AlgorithmID, reason string) *pqcv1.MsgDisableAlgorithm {
	return &pqcv1.MsgDisableAlgorithm{Authority: authority, AlgorithmID: algorithmID, Reason: reason}
}

// ---- svm ----

// SvmComposers builds svm module messages.
type SvmComposers struct{}

// Svm is the svm message composer group.
var Svm SvmComposers

// DeployProgram builds MsgDeployProgram.
func (SvmComposers) DeployProgram(sender string, bytecode []byte) *svmv1.MsgDeployProgram {
	return &svmv1.MsgDeployProgram{Sender: sender, Bytecode: bytecode}
}

// CreateAccount builds MsgCreateAccount.
func (SvmComposers) CreateAccount(sender string, owner svmv1.Bytes32, space, lamports uint64, salt []byte) *svmv1.MsgCreateAccount {
	return &svmv1.MsgCreateAccount{Sender: sender, Owner: owner, Space: space, Lamports: lamports, Salt: salt}
}

// ExecuteProgram builds MsgExecuteProgram.
func (SvmComposers) ExecuteProgram(sender string, programID svmv1.Bytes32, accounts []svmv1.SvmAccountMeta, data []byte) *svmv1.MsgExecuteProgram {
	return &svmv1.MsgExecuteProgram{Sender: sender, ProgramID: programID, Accounts: accounts, Data: data}
}

// RegisterPQCKey builds MsgRegisterSVMPQCKey.
func (SvmComposers) RegisterPQCKey(sender string, svmAddr svmv1.Bytes32, pqcPubKey []byte) *svmv1.MsgRegisterSVMPQCKey {
	return &svmv1.MsgRegisterSVMPQCKey{Sender: sender, SVMAddr: svmAddr, PQCPubKey: pqcPubKey}
}

// ---- lightnode ----

// LightnodeComposers builds lightnode module messages.
type LightnodeComposers struct{}

// Lightnode is the lightnode message composer group.
var Lightnode LightnodeComposers

// Register builds MsgRegisterLightNode.
func (LightnodeComposers) Register(operator, nodeType, version string, capabilities []string) *lightnodev1.MsgRegisterLightNode {
	return &lightnodev1.MsgRegisterLightNode{Operator: operator, NodeType: nodeType, Version: version, Capabilities: capabilities}
}

// Heartbeat builds MsgHeartbeat.
func (LightnodeComposers) Heartbeat(operator string) *lightnodev1.MsgHeartbeat {
	return &lightnodev1.MsgHeartbeat{Operator: operator}
}

// Deregister builds MsgDeregisterLightNode.
func (LightnodeComposers) Deregister(operator string) *lightnodev1.MsgDeregisterLightNode {
	return &lightnodev1.MsgDeregisterLightNode{Operator: operator}
}

// ClaimRewards builds MsgClaimLightNodeRewards.
func (LightnodeComposers) ClaimRewards(operator string) *lightnodev1.MsgClaimLightNodeRewards {
	return &lightnodev1.MsgClaimLightNodeRewards{Operator: operator}
}

// ---- license ----

// LicenseComposers builds license module messages.
type LicenseComposers struct{}

// License is the license message composer group.
var License LicenseComposers

// Grant builds MsgGrantLicense.
func (LicenseComposers) Grant(authority, grantee, featureID string, expiresAt int64, metadata string) *licensev1.MsgGrantLicense {
	return &licensev1.MsgGrantLicense{Authority: authority, Grantee: grantee, FeatureID: featureID, ExpiresAt: expiresAt, Metadata: metadata}
}

// Revoke builds MsgRevokeLicense.
func (LicenseComposers) Revoke(authority, grantee, featureID string) *licensev1.MsgRevokeLicense {
	return &licensev1.MsgRevokeLicense{Authority: authority, Grantee: grantee, FeatureID: featureID}
}

// Suspend builds MsgSuspendLicense.
func (LicenseComposers) Suspend(authority, grantee, featureID string) *licensev1.MsgSuspendLicense {
	return &licensev1.MsgSuspendLicense{Authority: authority, Grantee: grantee, FeatureID: featureID}
}

// Resume builds MsgResumeLicense.
func (LicenseComposers) Resume(authority, grantee, featureID string) *licensev1.MsgResumeLicense {
	return &licensev1.MsgResumeLicense{Authority: authority, Grantee: grantee, FeatureID: featureID}
}

// ---- abstractaccount ----

// AbstractAccountComposers builds abstractaccount module messages.
type AbstractAccountComposers struct{}

// AbstractAccount is the abstractaccount message composer group.
var AbstractAccount AbstractAccountComposers

// Create builds MsgCreateAbstractAccount.
func (AbstractAccountComposers) Create(owner, accountType string) *abstractaccountv1.MsgCreateAbstractAccount {
	return &abstractaccountv1.MsgCreateAbstractAccount{Owner: owner, AccountType: accountType}
}

// UpdateSpendingRules builds MsgUpdateSpendingRules.
func (AbstractAccountComposers) UpdateSpendingRules(owner, accountAddress string, rules []abstractaccountv1.SpendingRule) *abstractaccountv1.MsgUpdateSpendingRules {
	return &abstractaccountv1.MsgUpdateSpendingRules{Owner: owner, AccountAddress: accountAddress, Rules: rules}
}

// ---- crossvm ----

// CrossVMComposers builds crossvm module messages.
type CrossVMComposers struct{}

// CrossVM is the crossvm message composer group.
var CrossVM CrossVMComposers

// Call builds MsgCrossVMCall.
func (CrossVMComposers) Call(sender string, sourceVM, targetVM crossvmv1.VMType, targetContract string, payload []byte, funds sdk.Coins) *crossvmv1.MsgCrossVMCall {
	return &crossvmv1.MsgCrossVMCall{Sender: sender, SourceVM: sourceVM, TargetVM: targetVM, TargetContract: targetContract, Payload: payload, Funds: funds}
}

// ProcessQueue builds MsgProcessQueue.
func (CrossVMComposers) ProcessQueue(authority string) *crossvmv1.MsgProcessQueue {
	return &crossvmv1.MsgProcessQueue{Authority: authority}
}

// ---- rlconsensus ----

// RlConsensusComposers builds rlconsensus module messages.
type RlConsensusComposers struct{}

// RlConsensus is the rlconsensus message composer group.
var RlConsensus RlConsensusComposers

// SetAgentMode builds MsgSetAgentMode.
func (RlConsensusComposers) SetAgentMode(authority string, mode rlconsensusv1.AgentMode) *rlconsensusv1.MsgSetAgentMode {
	return &rlconsensusv1.MsgSetAgentMode{Authority: authority, Mode: mode}
}

// ResumeAgent builds MsgResumeAgent.
func (RlConsensusComposers) ResumeAgent(authority string) *rlconsensusv1.MsgResumeAgent {
	return &rlconsensusv1.MsgResumeAgent{Authority: authority}
}

// UpdatePolicy builds MsgUpdatePolicy.
func (RlConsensusComposers) UpdatePolicy(authority, weightsJSON string) *rlconsensusv1.MsgUpdatePolicy {
	return &rlconsensusv1.MsgUpdatePolicy{Authority: authority, WeightsJson: weightsJSON}
}

// UpdateRewardWeights builds MsgUpdateRewardWeights.
func (RlConsensusComposers) UpdateRewardWeights(authority, throughput, finality, decentralization, mev, failedTxs string) *rlconsensusv1.MsgUpdateRewardWeights {
	return &rlconsensusv1.MsgUpdateRewardWeights{Authority: authority, Throughput: throughput, Finality: finality, Decentralization: decentralization, MEV: mev, FailedTxs: failedTxs}
}
