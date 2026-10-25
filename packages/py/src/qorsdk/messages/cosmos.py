"""Convenience message composers for the standard Native modules.

These wrap the message types cosmpy bundles (``cosmpy.protos.cosmos.*`` and
``cosmpy.protos.ibc.*``) and return :class:`~qorechain.messages._composer.Msg`
objects with the correct on-chain ``type_url``. They mirror the TypeScript SDK's
``msg.staking.delegate(...)`` / ``msg.gov.vote(...)`` surface (snake_cased) so a
transaction built from either SDK carries identical messages.

Builders are grouped per module into a small namespace object.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from types import SimpleNamespace

from cosmpy.protos.cosmos.authz.v1beta1.tx_pb2 import MsgExec, MsgGrant, MsgRevoke
from cosmpy.protos.cosmos.bank.v1beta1.tx_pb2 import MsgMultiSend, MsgSend
from cosmpy.protos.cosmos.distribution.v1beta1.tx_pb2 import (
    MsgFundCommunityPool,
    MsgSetWithdrawAddress,
    MsgWithdrawDelegatorReward,
)
from cosmpy.protos.cosmos.feegrant.v1beta1.tx_pb2 import (
    MsgGrantAllowance,
    MsgRevokeAllowance,
)
from cosmpy.protos.cosmos.gov.v1.tx_pb2 import (
    MsgDeposit,
    MsgSubmitProposal,
    MsgVote,
    MsgVoteWeighted,
)
from cosmpy.protos.cosmos.staking.v1beta1.tx_pb2 import (
    MsgBeginRedelegate,
    MsgDelegate,
    MsgUndelegate,
)
from cosmpy.protos.ibc.applications.transfer.v1.tx_pb2 import MsgTransfer

from ._composer import composer

#: Bank module message composers.
bank = SimpleNamespace(
    send=composer("/cosmos.bank.v1beta1.MsgSend", MsgSend),
    multi_send=composer("/cosmos.bank.v1beta1.MsgMultiSend", MsgMultiSend),
)

#: Staking module message composers.
staking = SimpleNamespace(
    delegate=composer("/cosmos.staking.v1beta1.MsgDelegate", MsgDelegate),
    undelegate=composer("/cosmos.staking.v1beta1.MsgUndelegate", MsgUndelegate),
    redelegate=composer(
        "/cosmos.staking.v1beta1.MsgBeginRedelegate", MsgBeginRedelegate
    ),
)

#: Distribution module message composers.
distribution = SimpleNamespace(
    withdraw_delegator_reward=composer(
        "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
        MsgWithdrawDelegatorReward,
    ),
    set_withdraw_address=composer(
        "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress", MsgSetWithdrawAddress
    ),
    fund_community_pool=composer(
        "/cosmos.distribution.v1beta1.MsgFundCommunityPool", MsgFundCommunityPool
    ),
)

#: Governance (gov v1) module message composers.
gov = SimpleNamespace(
    vote=composer("/cosmos.gov.v1.MsgVote", MsgVote),
    vote_weighted=composer("/cosmos.gov.v1.MsgVoteWeighted", MsgVoteWeighted),
    deposit=composer("/cosmos.gov.v1.MsgDeposit", MsgDeposit),
    submit_proposal=composer("/cosmos.gov.v1.MsgSubmitProposal", MsgSubmitProposal),
)

#: Authz (authorization grants) module message composers.
authz = SimpleNamespace(
    grant=composer("/cosmos.authz.v1beta1.MsgGrant", MsgGrant),
    revoke=composer("/cosmos.authz.v1beta1.MsgRevoke", MsgRevoke),
    exec=composer("/cosmos.authz.v1beta1.MsgExec", MsgExec),
)

#: Fee-grant module message composers.
feegrant = SimpleNamespace(
    grant=composer("/cosmos.feegrant.v1beta1.MsgGrantAllowance", MsgGrantAllowance),
    revoke=composer("/cosmos.feegrant.v1beta1.MsgRevokeAllowance", MsgRevokeAllowance),
)


def ibc_timeout_timestamp(seconds: float, *, now: datetime | None = None) -> int:
    """An absolute IBC timeout ``seconds`` from now, in the unit
    ``MsgTransfer.timeout_timestamp`` takes: Unix time in NANOSECONDS.

    ICS-20 timeouts are absolute: pass this, never a duration. (IBC v2 packets
    take an absolute Unix time in SECONDS; a relative value there is refused
    after the fee is charged.)

    :param seconds: How far ahead, in seconds; must be positive.
    :param now: The current time (defaults to the clock); a naive value is
        read as local time.
    :raises ValueError: If ``seconds`` is not a positive finite number.
    """
    if (
        isinstance(seconds, bool)
        or not isinstance(seconds, (int, float))
        or not math.isfinite(seconds)
        or seconds <= 0
    ):
        raise ValueError("ibc_timeout_timestamp: seconds must be positive")
    base_ms = math.floor((now or datetime.now(timezone.utc)).timestamp() * 1000)
    return (base_ms + math.ceil(seconds * 1000)) * 1_000_000


#: IBC fungible-token-transfer message composers.
ibc = SimpleNamespace(
    transfer=composer("/ibc.applications.transfer.v1.MsgTransfer", MsgTransfer),
)

__all__ = [
    "bank",
    "staking",
    "distribution",
    "gov",
    "authz",
    "feegrant",
    "ibc",
    "ibc_timeout_timestamp",
]
