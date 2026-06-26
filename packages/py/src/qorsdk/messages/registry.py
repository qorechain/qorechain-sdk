"""A type-URL → protobuf-class registry for QoreChain messages.

Building a transaction does not need a registry — a :class:`Msg`'s ``value`` is a
populated protobuf instance that packs directly into a Cosmos ``Any`` under its
``type_url`` (see :func:`qorechain.tx.send_messages`). The registry is the
*inverse*: it maps a ``type_url`` back to the generated class so a message pulled
off-chain (e.g. from a decoded ``TxBody``) can be parsed into a typed object,
and so callers can introspect the supported surface.

:data:`QORECHAIN_REGISTRY_TYPES` covers every QoreChain custom-module message;
the standard Cosmos SDK message classes cosmpy bundles are merged in by
:func:`qorechain_registry`. The ``type_url`` strings are the canonical on-chain
identifiers (``/qorechain.<module>.v1.Msg*`` and ``/cosmos.*``).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

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

from ..proto.qorechain.abstractaccount.v1 import tx_pb2 as abstractaccount_tx
from ..proto.qorechain.amm.v1 import tx_pb2 as amm_tx
from ..proto.qorechain.bridge.v1 import tx_pb2 as bridge_tx
from ..proto.qorechain.crossvm.v1 import tx_pb2 as crossvm_tx
from ..proto.qorechain.license.v1 import tx_pb2 as license_tx
from ..proto.qorechain.lightnode.v1 import tx_pb2 as lightnode_tx
from ..proto.qorechain.multilayer.v1 import tx_pb2 as multilayer_tx
from ..proto.qorechain.pqc.v1 import tx_pb2 as pqc_tx
from ..proto.qorechain.rdk.v1 import tx_pb2 as rdk_tx
from ..proto.qorechain.rlconsensus.v1 import tx_pb2 as rlconsensus_tx
from ..proto.qorechain.svm.v1 import tx_pb2 as svm_tx

#: A protobuf message class (callable producing a message instance).
ProtoType = Callable[..., Any]

#: Every QoreChain custom-module message, keyed by canonical on-chain type URL.
QORECHAIN_REGISTRY_TYPES: dict[str, ProtoType] = {
    # amm
    "/qorechain.amm.v1.MsgCreatePool": amm_tx.MsgCreatePool,
    "/qorechain.amm.v1.MsgAddLiquidity": amm_tx.MsgAddLiquidity,
    "/qorechain.amm.v1.MsgRemoveLiquidity": amm_tx.MsgRemoveLiquidity,
    "/qorechain.amm.v1.MsgSwapExactIn": amm_tx.MsgSwapExactIn,
    "/qorechain.amm.v1.MsgSwapExactOut": amm_tx.MsgSwapExactOut,
    "/qorechain.amm.v1.MsgPausePool": amm_tx.MsgPausePool,
    "/qorechain.amm.v1.MsgResumePool": amm_tx.MsgResumePool,
    # bridge
    "/qorechain.bridge.v1.MsgBridgeDeposit": bridge_tx.MsgBridgeDeposit,
    "/qorechain.bridge.v1.MsgBridgeWithdraw": bridge_tx.MsgBridgeWithdraw,
    "/qorechain.bridge.v1.MsgRegisterBridgeValidator": (
        bridge_tx.MsgRegisterBridgeValidator
    ),
    "/qorechain.bridge.v1.MsgBridgeAttestation": bridge_tx.MsgBridgeAttestation,
    # rdk
    "/qorechain.rdk.v1.MsgCreateRollup": rdk_tx.MsgCreateRollup,
    "/qorechain.rdk.v1.MsgSubmitBatch": rdk_tx.MsgSubmitBatch,
    "/qorechain.rdk.v1.MsgChallengeBatch": rdk_tx.MsgChallengeBatch,
    "/qorechain.rdk.v1.MsgResolveChallenge": rdk_tx.MsgResolveChallenge,
    "/qorechain.rdk.v1.MsgPauseRollup": rdk_tx.MsgPauseRollup,
    "/qorechain.rdk.v1.MsgResumeRollup": rdk_tx.MsgResumeRollup,
    "/qorechain.rdk.v1.MsgStopRollup": rdk_tx.MsgStopRollup,
    # multilayer
    "/qorechain.multilayer.v1.MsgRegisterSidechain": (
        multilayer_tx.MsgRegisterSidechain
    ),
    "/qorechain.multilayer.v1.MsgRegisterPaychain": multilayer_tx.MsgRegisterPaychain,
    "/qorechain.multilayer.v1.MsgAnchorState": multilayer_tx.MsgAnchorState,
    "/qorechain.multilayer.v1.MsgRouteTransaction": multilayer_tx.MsgRouteTransaction,
    "/qorechain.multilayer.v1.MsgUpdateLayerStatus": (
        multilayer_tx.MsgUpdateLayerStatus
    ),
    "/qorechain.multilayer.v1.MsgChallengeAnchor": multilayer_tx.MsgChallengeAnchor,
    # pqc
    "/qorechain.pqc.v1.MsgRegisterPQCKey": pqc_tx.MsgRegisterPQCKey,
    "/qorechain.pqc.v1.MsgRegisterPQCKeyV2": pqc_tx.MsgRegisterPQCKeyV2,
    "/qorechain.pqc.v1.MsgMigratePQCKey": pqc_tx.MsgMigratePQCKey,
    "/qorechain.pqc.v1.MsgDeprecateAlgorithm": pqc_tx.MsgDeprecateAlgorithm,
    "/qorechain.pqc.v1.MsgDisableAlgorithm": pqc_tx.MsgDisableAlgorithm,
    # svm
    "/qorechain.svm.v1.MsgDeployProgram": svm_tx.MsgDeployProgram,
    "/qorechain.svm.v1.MsgCreateAccount": svm_tx.MsgCreateAccount,
    "/qorechain.svm.v1.MsgExecuteProgram": svm_tx.MsgExecuteProgram,
    "/qorechain.svm.v1.MsgRegisterSVMPQCKey": svm_tx.MsgRegisterSVMPQCKey,
    # lightnode
    "/qorechain.lightnode.v1.MsgRegisterLightNode": (
        lightnode_tx.MsgRegisterLightNode
    ),
    "/qorechain.lightnode.v1.MsgHeartbeat": lightnode_tx.MsgHeartbeat,
    "/qorechain.lightnode.v1.MsgDeregisterLightNode": (
        lightnode_tx.MsgDeregisterLightNode
    ),
    "/qorechain.lightnode.v1.MsgClaimLightNodeRewards": (
        lightnode_tx.MsgClaimLightNodeRewards
    ),
    # license
    "/qorechain.license.v1.MsgGrantLicense": license_tx.MsgGrantLicense,
    "/qorechain.license.v1.MsgRevokeLicense": license_tx.MsgRevokeLicense,
    "/qorechain.license.v1.MsgSuspendLicense": license_tx.MsgSuspendLicense,
    "/qorechain.license.v1.MsgResumeLicense": license_tx.MsgResumeLicense,
    # abstractaccount
    "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount": (
        abstractaccount_tx.MsgCreateAbstractAccount
    ),
    "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules": (
        abstractaccount_tx.MsgUpdateSpendingRules
    ),
    # crossvm
    "/qorechain.crossvm.v1.MsgCrossVMCall": crossvm_tx.MsgCrossVMCall,
    "/qorechain.crossvm.v1.MsgProcessQueue": crossvm_tx.MsgProcessQueue,
    # rlconsensus
    "/qorechain.rlconsensus.v1.MsgSetAgentMode": rlconsensus_tx.MsgSetAgentMode,
    "/qorechain.rlconsensus.v1.MsgResumeAgent": rlconsensus_tx.MsgResumeAgent,
    "/qorechain.rlconsensus.v1.MsgUpdatePolicy": rlconsensus_tx.MsgUpdatePolicy,
    "/qorechain.rlconsensus.v1.MsgUpdateRewardWeights": (
        rlconsensus_tx.MsgUpdateRewardWeights
    ),
}

#: The standard Cosmos SDK + IBC messages this SDK composes, keyed by type URL.
COSMOS_REGISTRY_TYPES: dict[str, ProtoType] = {
    "/cosmos.bank.v1beta1.MsgSend": MsgSend,
    "/cosmos.bank.v1beta1.MsgMultiSend": MsgMultiSend,
    "/cosmos.staking.v1beta1.MsgDelegate": MsgDelegate,
    "/cosmos.staking.v1beta1.MsgUndelegate": MsgUndelegate,
    "/cosmos.staking.v1beta1.MsgBeginRedelegate": MsgBeginRedelegate,
    "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": (
        MsgWithdrawDelegatorReward
    ),
    "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress": MsgSetWithdrawAddress,
    "/cosmos.distribution.v1beta1.MsgFundCommunityPool": MsgFundCommunityPool,
    "/cosmos.gov.v1.MsgVote": MsgVote,
    "/cosmos.gov.v1.MsgVoteWeighted": MsgVoteWeighted,
    "/cosmos.gov.v1.MsgDeposit": MsgDeposit,
    "/cosmos.gov.v1.MsgSubmitProposal": MsgSubmitProposal,
    "/cosmos.authz.v1beta1.MsgGrant": MsgGrant,
    "/cosmos.authz.v1beta1.MsgRevoke": MsgRevoke,
    "/cosmos.authz.v1beta1.MsgExec": MsgExec,
    "/cosmos.feegrant.v1beta1.MsgGrantAllowance": MsgGrantAllowance,
    "/cosmos.feegrant.v1beta1.MsgRevokeAllowance": MsgRevokeAllowance,
    "/ibc.applications.transfer.v1.MsgTransfer": MsgTransfer,
}


def qorechain_registry(
    extra_types: dict[str, ProtoType] | None = None,
) -> dict[str, ProtoType]:
    """Build the full type-URL → protobuf-class map.

    Merges the standard Cosmos SDK / IBC messages and every QoreChain custom
    message. ``extra_types`` (e.g. private-module messages) is applied last and
    overrides any colliding built-in entry.

    :param extra_types: Optional additional ``{type_url: ProtoType}`` entries.
    :returns: A fresh dict the caller may mutate freely.
    """
    registry: dict[str, ProtoType] = {**COSMOS_REGISTRY_TYPES, **QORECHAIN_REGISTRY_TYPES}
    if extra_types:
        registry.update(extra_types)
    return registry


def resolve_message_type(
    type_url: str, registry: dict[str, ProtoType] | None = None
) -> ProtoType:
    """Look up the protobuf class for a ``type_url``.

    :param type_url: A canonical ``/package.Msg*`` identifier.
    :param registry: An optional registry; defaults to :func:`qorechain_registry`.
    :raises KeyError: If the type URL is not registered.
    """
    reg = registry if registry is not None else qorechain_registry()
    return reg[type_url]


def decode_any(
    type_url: str, value: bytes, registry: dict[str, ProtoType] | None = None
) -> Any:
    """Decode raw ``Any`` bytes into a typed protobuf message.

    :param type_url: The ``Any.type_url`` identifying the message.
    :param value: The ``Any.value`` (serialized message bytes).
    :param registry: An optional registry; defaults to :func:`qorechain_registry`.
    :raises KeyError: If the type URL is not registered.
    """
    msg = resolve_message_type(type_url, registry)()
    msg.ParseFromString(value)
    return msg
