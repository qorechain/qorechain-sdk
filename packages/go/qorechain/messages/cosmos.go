package messages

import (
	"time"

	"cosmossdk.io/math"
	feegranttypes "cosmossdk.io/x/feegrant"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	authztypes "github.com/cosmos/cosmos-sdk/x/authz"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	distrtypes "github.com/cosmos/cosmos-sdk/x/distribution/types"
	govv1types "github.com/cosmos/cosmos-sdk/x/gov/types/v1"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
	ibctransfertypes "github.com/cosmos/ibc-go/v8/modules/apps/transfer/types"
	ibcclienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
)

// The composers below build the standard Cosmos SDK messages QoreChain inherits.
// They reuse the upstream sdk types directly so the type URLs are exactly the
// canonical /cosmos.* and /ibc.* values the chain expects.

// ---- bank ----

// BankComposers builds bank module messages.
type BankComposers struct{}

// Bank is the bank message composer group.
var Bank BankComposers

// Send builds /cosmos.bank.v1beta1.MsgSend.
func (BankComposers) Send(fromAddress, toAddress string, amount sdk.Coins) *banktypes.MsgSend {
	return &banktypes.MsgSend{FromAddress: fromAddress, ToAddress: toAddress, Amount: amount}
}

// MultiSend builds /cosmos.bank.v1beta1.MsgMultiSend.
func (BankComposers) MultiSend(inputs []banktypes.Input, outputs []banktypes.Output) *banktypes.MsgMultiSend {
	return &banktypes.MsgMultiSend{Inputs: inputs, Outputs: outputs}
}

// ---- staking ----

// StakingComposers builds staking module messages.
type StakingComposers struct{}

// Staking is the staking message composer group.
var Staking StakingComposers

// Delegate builds /cosmos.staking.v1beta1.MsgDelegate.
func (StakingComposers) Delegate(delegator, validator string, amount sdk.Coin) *stakingtypes.MsgDelegate {
	return &stakingtypes.MsgDelegate{DelegatorAddress: delegator, ValidatorAddress: validator, Amount: amount}
}

// Undelegate builds /cosmos.staking.v1beta1.MsgUndelegate.
func (StakingComposers) Undelegate(delegator, validator string, amount sdk.Coin) *stakingtypes.MsgUndelegate {
	return &stakingtypes.MsgUndelegate{DelegatorAddress: delegator, ValidatorAddress: validator, Amount: amount}
}

// BeginRedelegate builds /cosmos.staking.v1beta1.MsgBeginRedelegate.
func (StakingComposers) BeginRedelegate(delegator, srcValidator, dstValidator string, amount sdk.Coin) *stakingtypes.MsgBeginRedelegate {
	return &stakingtypes.MsgBeginRedelegate{DelegatorAddress: delegator, ValidatorSrcAddress: srcValidator, ValidatorDstAddress: dstValidator, Amount: amount}
}

// ---- distribution ----

// DistributionComposers builds distribution module messages.
type DistributionComposers struct{}

// Distribution is the distribution message composer group.
var Distribution DistributionComposers

// WithdrawDelegatorReward builds /cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward.
func (DistributionComposers) WithdrawDelegatorReward(delegator, validator string) *distrtypes.MsgWithdrawDelegatorReward {
	return &distrtypes.MsgWithdrawDelegatorReward{DelegatorAddress: delegator, ValidatorAddress: validator}
}

// SetWithdrawAddress builds /cosmos.distribution.v1beta1.MsgSetWithdrawAddress.
func (DistributionComposers) SetWithdrawAddress(delegator, withdraw string) *distrtypes.MsgSetWithdrawAddress {
	return &distrtypes.MsgSetWithdrawAddress{DelegatorAddress: delegator, WithdrawAddress: withdraw}
}

// FundCommunityPool builds /cosmos.distribution.v1beta1.MsgFundCommunityPool.
func (DistributionComposers) FundCommunityPool(depositor string, amount sdk.Coins) *distrtypes.MsgFundCommunityPool {
	return &distrtypes.MsgFundCommunityPool{Depositor: depositor, Amount: amount}
}

// ---- gov ----

// GovComposers builds gov (v1) module messages.
type GovComposers struct{}

// Gov is the gov message composer group.
var Gov GovComposers

// SubmitProposal builds /cosmos.gov.v1.MsgSubmitProposal.
func (GovComposers) SubmitProposal(messages []*codectypes.Any, initialDeposit sdk.Coins, proposer, metadata, title, summary string) *govv1types.MsgSubmitProposal {
	return &govv1types.MsgSubmitProposal{Messages: messages, InitialDeposit: initialDeposit, Proposer: proposer, Metadata: metadata, Title: title, Summary: summary}
}

// Vote builds /cosmos.gov.v1.MsgVote.
func (GovComposers) Vote(proposalID uint64, voter string, option govv1types.VoteOption, metadata string) *govv1types.MsgVote {
	return &govv1types.MsgVote{ProposalId: proposalID, Voter: voter, Option: option, Metadata: metadata}
}

// Deposit builds /cosmos.gov.v1.MsgDeposit.
func (GovComposers) Deposit(proposalID uint64, depositor string, amount sdk.Coins) *govv1types.MsgDeposit {
	return &govv1types.MsgDeposit{ProposalId: proposalID, Depositor: depositor, Amount: amount}
}

// ---- authz ----

// AuthzComposers builds authz module messages.
type AuthzComposers struct{}

// Authz is the authz message composer group.
var Authz AuthzComposers

// Grant builds /cosmos.authz.v1beta1.MsgGrant.
func (AuthzComposers) Grant(granter, grantee string, grant authztypes.Grant) *authztypes.MsgGrant {
	return &authztypes.MsgGrant{Granter: granter, Grantee: grantee, Grant: grant}
}

// Revoke builds /cosmos.authz.v1beta1.MsgRevoke.
func (AuthzComposers) Revoke(granter, grantee, msgTypeURL string) *authztypes.MsgRevoke {
	return &authztypes.MsgRevoke{Granter: granter, Grantee: grantee, MsgTypeUrl: msgTypeURL}
}

// Exec builds /cosmos.authz.v1beta1.MsgExec.
func (AuthzComposers) Exec(grantee string, msgs []*codectypes.Any) *authztypes.MsgExec {
	return &authztypes.MsgExec{Grantee: grantee, Msgs: msgs}
}

// ---- feegrant ----

// FeegrantComposers builds feegrant module messages.
type FeegrantComposers struct{}

// Feegrant is the feegrant message composer group.
var Feegrant FeegrantComposers

// GrantAllowance builds /cosmos.feegrant.v1beta1.MsgGrantAllowance.
func (FeegrantComposers) GrantAllowance(granter, grantee string, allowance *codectypes.Any) *feegranttypes.MsgGrantAllowance {
	return &feegranttypes.MsgGrantAllowance{Granter: granter, Grantee: grantee, Allowance: allowance}
}

// RevokeAllowance builds /cosmos.feegrant.v1beta1.MsgRevokeAllowance.
func (FeegrantComposers) RevokeAllowance(granter, grantee string) *feegranttypes.MsgRevokeAllowance {
	return &feegranttypes.MsgRevokeAllowance{Granter: granter, Grantee: grantee}
}

// ---- ibc ----

// IBCComposers builds IBC application messages.
type IBCComposers struct{}

// IBC is the IBC message composer group.
var IBC IBCComposers

// Transfer builds /ibc.applications.transfer.v1.MsgTransfer (ICS-20).
//
// timeoutHeight may be the zero value for no height timeout; timeoutTimestamp is
// nanoseconds since the Unix epoch (0 for none). memo is optional.
func (IBCComposers) Transfer(sourcePort, sourceChannel string, token sdk.Coin, sender, receiver string, timeoutHeight ibcclienttypes.Height, timeoutTimestamp uint64, memo string) *ibctransfertypes.MsgTransfer {
	return &ibctransfertypes.MsgTransfer{
		SourcePort:       sourcePort,
		SourceChannel:    sourceChannel,
		Token:            token,
		Sender:           sender,
		Receiver:         receiver,
		TimeoutHeight:    timeoutHeight,
		TimeoutTimestamp: timeoutTimestamp,
		Memo:             memo,
	}
}

// BasicAllowance builds a feegrant BasicAllowance packed into an Any, ready for
// FeegrantComposers.GrantAllowance.
func BasicAllowance(spendLimit sdk.Coins, expiration *time.Time) (*codectypes.Any, error) {
	allowance := &feegranttypes.BasicAllowance{SpendLimit: spendLimit, Expiration: expiration}
	return codectypes.NewAnyWithValue(allowance)
}

var _ = math.ZeroInt
