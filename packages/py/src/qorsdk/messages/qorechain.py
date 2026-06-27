"""Typed message composers for the QoreChain custom modules.

Each composer takes the message's fields as keyword arguments (proto snake_case)
and returns a :class:`~qorechain.messages._composer.Msg` (``{type_url, value}``)
ready to pass to :func:`qorechain.tx.send_messages` / the hybrid PQC tx path.

Composers are grouped per module into a small namespace object, so callers write
e.g. ``msg.amm.swap_exact_in(...)`` or ``msg.pqc.register_pqc_key(...)`` — the
exact module/name surface of the TypeScript SDK, snake_cased.
"""

from __future__ import annotations

from types import SimpleNamespace

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
from ._composer import composer

# --------------------------------------------------------------------------- #
# AMM (automated market maker)
# --------------------------------------------------------------------------- #
amm = SimpleNamespace(
    create_pool=composer("/qorechain.amm.v1.MsgCreatePool", amm_tx.MsgCreatePool),
    add_liquidity=composer("/qorechain.amm.v1.MsgAddLiquidity", amm_tx.MsgAddLiquidity),
    remove_liquidity=composer(
        "/qorechain.amm.v1.MsgRemoveLiquidity", amm_tx.MsgRemoveLiquidity
    ),
    swap_exact_in=composer("/qorechain.amm.v1.MsgSwapExactIn", amm_tx.MsgSwapExactIn),
    swap_exact_out=composer("/qorechain.amm.v1.MsgSwapExactOut", amm_tx.MsgSwapExactOut),
    pause_pool=composer("/qorechain.amm.v1.MsgPausePool", amm_tx.MsgPausePool),
    resume_pool=composer("/qorechain.amm.v1.MsgResumePool", amm_tx.MsgResumePool),
)

# --------------------------------------------------------------------------- #
# Bridge (cross-chain asset transfer)
# --------------------------------------------------------------------------- #
bridge = SimpleNamespace(
    bridge_deposit=composer(
        "/qorechain.bridge.v1.MsgBridgeDeposit", bridge_tx.MsgBridgeDeposit
    ),
    bridge_withdraw=composer(
        "/qorechain.bridge.v1.MsgBridgeWithdraw", bridge_tx.MsgBridgeWithdraw
    ),
    register_bridge_validator=composer(
        "/qorechain.bridge.v1.MsgRegisterBridgeValidator",
        bridge_tx.MsgRegisterBridgeValidator,
    ),
    bridge_attestation=composer(
        "/qorechain.bridge.v1.MsgBridgeAttestation", bridge_tx.MsgBridgeAttestation
    ),
    update_eth_light_client=composer(
        "/qorechain.bridge.v1.MsgUpdateEthLightClient",
        bridge_tx.MsgUpdateEthLightClient,
    ),
    update_chain_config=composer(
        "/qorechain.bridge.v1.MsgUpdateChainConfig",
        bridge_tx.MsgUpdateChainConfig,
    ),
    set_verifier_bootstrap=composer(
        "/qorechain.bridge.v1.MsgSetVerifierBootstrap",
        bridge_tx.MsgSetVerifierBootstrap,
    ),
)

# --------------------------------------------------------------------------- #
# RDK (rollup development kit)
# --------------------------------------------------------------------------- #
rdk = SimpleNamespace(
    create_rollup=composer("/qorechain.rdk.v1.MsgCreateRollup", rdk_tx.MsgCreateRollup),
    submit_batch=composer("/qorechain.rdk.v1.MsgSubmitBatch", rdk_tx.MsgSubmitBatch),
    challenge_batch=composer(
        "/qorechain.rdk.v1.MsgChallengeBatch", rdk_tx.MsgChallengeBatch
    ),
    resolve_challenge=composer(
        "/qorechain.rdk.v1.MsgResolveChallenge", rdk_tx.MsgResolveChallenge
    ),
    pause_rollup=composer("/qorechain.rdk.v1.MsgPauseRollup", rdk_tx.MsgPauseRollup),
    resume_rollup=composer("/qorechain.rdk.v1.MsgResumeRollup", rdk_tx.MsgResumeRollup),
    stop_rollup=composer("/qorechain.rdk.v1.MsgStopRollup", rdk_tx.MsgStopRollup),
    execute_withdrawal=composer(
        "/qorechain.rdk.v1.MsgExecuteWithdrawal", rdk_tx.MsgExecuteWithdrawal
    ),
)

# --------------------------------------------------------------------------- #
# Multilayer (sidechains / paychains / anchoring)
# --------------------------------------------------------------------------- #
multilayer = SimpleNamespace(
    register_sidechain=composer(
        "/qorechain.multilayer.v1.MsgRegisterSidechain",
        multilayer_tx.MsgRegisterSidechain,
    ),
    register_paychain=composer(
        "/qorechain.multilayer.v1.MsgRegisterPaychain",
        multilayer_tx.MsgRegisterPaychain,
    ),
    anchor_state=composer(
        "/qorechain.multilayer.v1.MsgAnchorState", multilayer_tx.MsgAnchorState
    ),
    route_transaction=composer(
        "/qorechain.multilayer.v1.MsgRouteTransaction",
        multilayer_tx.MsgRouteTransaction,
    ),
    update_layer_status=composer(
        "/qorechain.multilayer.v1.MsgUpdateLayerStatus",
        multilayer_tx.MsgUpdateLayerStatus,
    ),
    challenge_anchor=composer(
        "/qorechain.multilayer.v1.MsgChallengeAnchor",
        multilayer_tx.MsgChallengeAnchor,
    ),
)

# --------------------------------------------------------------------------- #
# PQC (post-quantum key registry / algorithm governance)
# --------------------------------------------------------------------------- #
pqc = SimpleNamespace(
    register_pqc_key=composer(
        "/qorechain.pqc.v1.MsgRegisterPQCKey", pqc_tx.MsgRegisterPQCKey
    ),
    register_pqc_key_v2=composer(
        "/qorechain.pqc.v1.MsgRegisterPQCKeyV2", pqc_tx.MsgRegisterPQCKeyV2
    ),
    migrate_pqc_key=composer(
        "/qorechain.pqc.v1.MsgMigratePQCKey", pqc_tx.MsgMigratePQCKey
    ),
    deprecate_algorithm=composer(
        "/qorechain.pqc.v1.MsgDeprecateAlgorithm", pqc_tx.MsgDeprecateAlgorithm
    ),
    disable_algorithm=composer(
        "/qorechain.pqc.v1.MsgDisableAlgorithm", pqc_tx.MsgDisableAlgorithm
    ),
)

# --------------------------------------------------------------------------- #
# SVM (Solana-style VM programs/accounts)
# --------------------------------------------------------------------------- #
svm = SimpleNamespace(
    deploy_program=composer(
        "/qorechain.svm.v1.MsgDeployProgram", svm_tx.MsgDeployProgram
    ),
    create_account=composer(
        "/qorechain.svm.v1.MsgCreateAccount", svm_tx.MsgCreateAccount
    ),
    execute_program=composer(
        "/qorechain.svm.v1.MsgExecuteProgram", svm_tx.MsgExecuteProgram
    ),
    register_svm_pqc_key=composer(
        "/qorechain.svm.v1.MsgRegisterSVMPQCKey", svm_tx.MsgRegisterSVMPQCKey
    ),
)

# --------------------------------------------------------------------------- #
# Lightnode (light-node lifecycle / rewards)
# --------------------------------------------------------------------------- #
lightnode = SimpleNamespace(
    register_light_node=composer(
        "/qorechain.lightnode.v1.MsgRegisterLightNode",
        lightnode_tx.MsgRegisterLightNode,
    ),
    heartbeat=composer("/qorechain.lightnode.v1.MsgHeartbeat", lightnode_tx.MsgHeartbeat),
    deregister_light_node=composer(
        "/qorechain.lightnode.v1.MsgDeregisterLightNode",
        lightnode_tx.MsgDeregisterLightNode,
    ),
    claim_light_node_rewards=composer(
        "/qorechain.lightnode.v1.MsgClaimLightNodeRewards",
        lightnode_tx.MsgClaimLightNodeRewards,
    ),
)

# --------------------------------------------------------------------------- #
# License (feature licensing)
# --------------------------------------------------------------------------- #
license = SimpleNamespace(
    grant_license=composer(
        "/qorechain.license.v1.MsgGrantLicense", license_tx.MsgGrantLicense
    ),
    revoke_license=composer(
        "/qorechain.license.v1.MsgRevokeLicense", license_tx.MsgRevokeLicense
    ),
    suspend_license=composer(
        "/qorechain.license.v1.MsgSuspendLicense", license_tx.MsgSuspendLicense
    ),
    resume_license=composer(
        "/qorechain.license.v1.MsgResumeLicense", license_tx.MsgResumeLicense
    ),
)

# --------------------------------------------------------------------------- #
# Abstract account (programmable accounts / spending rules)
# --------------------------------------------------------------------------- #
abstractaccount = SimpleNamespace(
    create_abstract_account=composer(
        "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
        abstractaccount_tx.MsgCreateAbstractAccount,
    ),
    update_spending_rules=composer(
        "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
        abstractaccount_tx.MsgUpdateSpendingRules,
    ),
)

# --------------------------------------------------------------------------- #
# Cross-VM (inter-VM messaging)
# --------------------------------------------------------------------------- #
crossvm = SimpleNamespace(
    cross_vm_call=composer(
        "/qorechain.crossvm.v1.MsgCrossVMCall", crossvm_tx.MsgCrossVMCall
    ),
    process_queue=composer(
        "/qorechain.crossvm.v1.MsgProcessQueue", crossvm_tx.MsgProcessQueue
    ),
)

# --------------------------------------------------------------------------- #
# RL consensus (reinforcement-learning agent governance)
# --------------------------------------------------------------------------- #
rlconsensus = SimpleNamespace(
    set_agent_mode=composer(
        "/qorechain.rlconsensus.v1.MsgSetAgentMode", rlconsensus_tx.MsgSetAgentMode
    ),
    resume_agent=composer(
        "/qorechain.rlconsensus.v1.MsgResumeAgent", rlconsensus_tx.MsgResumeAgent
    ),
    update_policy=composer(
        "/qorechain.rlconsensus.v1.MsgUpdatePolicy", rlconsensus_tx.MsgUpdatePolicy
    ),
    update_reward_weights=composer(
        "/qorechain.rlconsensus.v1.MsgUpdateRewardWeights",
        rlconsensus_tx.MsgUpdateRewardWeights,
    ),
)

__all__ = [
    "amm",
    "bridge",
    "rdk",
    "multilayer",
    "pqc",
    "svm",
    "lightnode",
    "license",
    "abstractaccount",
    "crossvm",
    "rlconsensus",
]
