/**
 * Convenience message builders for the standard Cosmos SDK modules.
 *
 * These wrap `cosmjs-types` message types and return cosmjs
 * {@link EncodeObject}s with the correct on-chain `typeUrl`. The matching types
 * are already in cosmjs's {@link defaultRegistryTypes} (and therefore in
 * {@link qorechainRegistry}), so a tx built from these encodes without extra
 * registration.
 *
 * Builders are grouped by module and re-exported (see {@link messages.ts}) so
 * callers write e.g. `msg.staking.delegate({ ... })` or `msg.gov.vote({ ... })`.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import { MsgSend, MsgMultiSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import {
  MsgDelegate,
  MsgUndelegate,
  MsgBeginRedelegate,
} from "cosmjs-types/cosmos/staking/v1beta1/tx";
import {
  MsgWithdrawDelegatorReward,
  MsgSetWithdrawAddress,
  MsgFundCommunityPool,
} from "cosmjs-types/cosmos/distribution/v1beta1/tx";
import {
  MsgVote,
  MsgVoteWeighted,
  MsgDeposit,
  MsgSubmitProposal,
} from "cosmjs-types/cosmos/gov/v1/tx";
import {
  MsgGrant,
  MsgRevoke,
  MsgExec,
} from "cosmjs-types/cosmos/authz/v1beta1/tx";
import {
  MsgGrantAllowance,
  MsgRevokeAllowance,
} from "cosmjs-types/cosmos/feegrant/v1beta1/tx";
import { MsgTransfer } from "cosmjs-types/ibc/applications/transfer/v1/tx";

/** A ts-proto/cosmjs generated message exposing `fromPartial`. */
interface MsgType<T> {
  fromPartial(object: T): T;
}

/** Build a `{ typeUrl, value }` composer bound to a fixed typeUrl + message. */
function composer<T>(typeUrl: string, msg: MsgType<Partial<T>>) {
  return (value: Partial<T>): EncodeObject => ({
    typeUrl,
    value: msg.fromPartial(value),
  });
}

/** Bank module message builders. */
export const bank = {
  send: composer<MsgSend>("/cosmos.bank.v1beta1.MsgSend", MsgSend),
  multiSend: composer<MsgMultiSend>(
    "/cosmos.bank.v1beta1.MsgMultiSend",
    MsgMultiSend,
  ),
};

/** Staking module message builders. */
export const staking = {
  delegate: composer<MsgDelegate>(
    "/cosmos.staking.v1beta1.MsgDelegate",
    MsgDelegate,
  ),
  undelegate: composer<MsgUndelegate>(
    "/cosmos.staking.v1beta1.MsgUndelegate",
    MsgUndelegate,
  ),
  redelegate: composer<MsgBeginRedelegate>(
    "/cosmos.staking.v1beta1.MsgBeginRedelegate",
    MsgBeginRedelegate,
  ),
};

/** Distribution module message builders. */
export const distribution = {
  withdrawDelegatorReward: composer<MsgWithdrawDelegatorReward>(
    "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
    MsgWithdrawDelegatorReward,
  ),
  setWithdrawAddress: composer<MsgSetWithdrawAddress>(
    "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress",
    MsgSetWithdrawAddress,
  ),
  fundCommunityPool: composer<MsgFundCommunityPool>(
    "/cosmos.distribution.v1beta1.MsgFundCommunityPool",
    MsgFundCommunityPool,
  ),
};

/** Governance (gov v1) module message builders. */
export const gov = {
  vote: composer<MsgVote>("/cosmos.gov.v1.MsgVote", MsgVote),
  voteWeighted: composer<MsgVoteWeighted>(
    "/cosmos.gov.v1.MsgVoteWeighted",
    MsgVoteWeighted,
  ),
  deposit: composer<MsgDeposit>("/cosmos.gov.v1.MsgDeposit", MsgDeposit),
  submitProposal: composer<MsgSubmitProposal>(
    "/cosmos.gov.v1.MsgSubmitProposal",
    MsgSubmitProposal,
  ),
};

/** Authz (authorization grants) module message builders. */
export const authz = {
  grant: composer<MsgGrant>("/cosmos.authz.v1beta1.MsgGrant", MsgGrant),
  revoke: composer<MsgRevoke>("/cosmos.authz.v1beta1.MsgRevoke", MsgRevoke),
  exec: composer<MsgExec>("/cosmos.authz.v1beta1.MsgExec", MsgExec),
};

/** Fee-grant module message builders. */
export const feegrant = {
  grant: composer<MsgGrantAllowance>(
    "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
    MsgGrantAllowance,
  ),
  revoke: composer<MsgRevokeAllowance>(
    "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
    MsgRevokeAllowance,
  ),
};

/** IBC fungible-token-transfer message builders. */
export const ibc = {
  transfer: composer<MsgTransfer>(
    "/ibc.applications.transfer.v1.MsgTransfer",
    MsgTransfer,
  ),
};
