"""Typed message composers for the QoreChain custom modules.

Each composer takes the message's fields as keyword arguments (proto snake_case)
and returns a :class:`~qorechain.messages._composer.Msg` (``{type_url, value}``)
ready to pass to :func:`qorechain.tx.send_messages` / the hybrid PQC tx path.

Composers are grouped per module into a small namespace object, so callers write
e.g. ``msg.amm.swap_exact_in(...)`` or ``msg.pqc.register_pqc_key(...)`` - the
exact module/name surface of the TypeScript SDK, snake_cased.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from ..abstractaccount import (
    UPDATE_ABSTRACT_ACCOUNT_CONFIG_TYPE_URL,
    validate_update_config,
)
from ..evm_delegation import (
    AUTHORIZE_EVM_DELEGATION_TYPE_URL,
    CLEAR_EVM_DELEGATION_TYPE_URL,
    validate_evm_delegation_consent,
)
from ..evm_window import (
    CLOSE_EVM_WINDOW_TYPE_URL,
    OPEN_EVM_WINDOW_TYPE_URL,
    validate_evm_window_ibc_receivers,
    validate_evm_window_params,
    validate_evm_window_staking_validators,
    validate_evm_window_targets,
    validate_evm_window_validators,
)
from ..governance import (
    CROSSVM_UPDATE_PARAMS_FIELDS,
    RDK_UPDATE_PARAMS_FIELDS,
    UPDATE_CROSSVM_PARAMS_TYPE_URL,
    UPDATE_RDK_PARAMS_TYPE_URL,
    UPDATE_SVM_PARAMS_TYPE_URL,
    _non_negative_int,
    require_fields,
    validate_crossvm_target_pins,
    validate_crossvm_update_params,
    validate_rdk_update_params,
    validate_svm_params,
)
from ..kem import (
    KEM_ALGORITHM_ML_KEM_1024,
    REGISTER_KEM_KEY_TYPE_URL,
    REMOVE_KEM_KEY_TYPE_URL,
    validate_kem_public_key,
)
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
from ..proto.qorechain.stakingtier.v1 import tx_pb2 as stakingtier_tx
from ..proto.qorechain.svm.v1 import tx_pb2 as svm_tx
from ..stakingtier import (
    CLAIM_BONUS_TYPE_URL,
    LOCK_DELEGATION_TYPE_URL,
    UNLOCK_EARLY_TYPE_URL,
    UPDATE_STAKING_TIER_PARAMS_TYPE_URL,
    validate_lock_delegation,
)
from ._composer import Msg, composer
from .spending_rules import validate_spending_rules

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
    # From chain v3.2.4 the registration carries ``proof_of_possession``: the
    # PQC key's own signature in the x/pqc format with the validator address as
    # the account, from ``qorsdk.sign_proof_of_possession(chain_id=...,
    # account=validator_address, keypair=...)``.
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
    # v3.2.2: a chain's single-transfer and daily circuit-breaker limits, in the
    # chain's base unit ("0" = unlimited). Bridge admin, qcb_bridge licence
    # holder, or governance.
    update_circuit_breaker_limits=composer(
        "/qorechain.bridge.v1.MsgUpdateCircuitBreakerLimits",
        bridge_tx.MsgUpdateCircuitBreakerLimits,
    ),
)

# --------------------------------------------------------------------------- #
# RDK (rollup development kit)
# --------------------------------------------------------------------------- #


_RDK_V328_FIELDS = (
    "finalized_batch_retention_blocks",
    "max_posted_data_bytes",
    "max_posted_data_bytes_per_block",
    "posted_data_fee_per_byte",
    "posted_data_retention_blocks",
    "min_submitter_bond",
)


def _rdk_update_params(**fields: Any) -> Msg:
    """Build rdk ``MsgUpdateParams`` (governance only): replaces every rdk
    parameter at once.

    Every field is required (chain v3.2.8 added fields 9..14): ``authority`` and
    each of :data:`~qorsdk.governance.RDK_UPDATE_PARAMS_FIELDS`. A field left out
    would be reset to zero, so a missing or ``None`` field is refused. The
    v3.2.8 fields may be 0 (the chain default). Build a proposal from the values
    in force with :func:`~qorsdk.governance.rdk_update_params_from_current`.

    :raises ValueError: Naming the missing fields, or the field that fails
        :func:`~qorsdk.governance.validate_rdk_update_params`.
    """
    what = "rdk update_params"
    unknown = set(fields) - {"authority", *RDK_UPDATE_PARAMS_FIELDS}
    if unknown:
        raise ValueError(f"{what}: unknown field(s): {', '.join(sorted(unknown))}")
    require_fields(what, fields, ("authority", *RDK_UPDATE_PARAMS_FIELDS))
    validate_rdk_update_params(
        **{k: v for k, v in fields.items() if k not in _RDK_V328_FIELDS}
    )
    for name in _RDK_V328_FIELDS:
        _non_negative_int(fields[name], name, what)
    return Msg(type_url=UPDATE_RDK_PARAMS_TYPE_URL, value=rdk_tx.MsgUpdateParams(**fields))


_rdk_update_params.__name__ = "MsgUpdateParams"
_rdk_update_params.__qualname__ = "MsgUpdateParams"

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
    # Replace the module parameters (governance only). Every field required.
    update_params=_rdk_update_params,
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
    # v3.2.2: replace the module parameters. Governance only.
    update_params=composer(
        "/qorechain.multilayer.v1.MsgUpdateParams",
        multilayer_tx.MsgUpdateParams,
    ),
)

# --------------------------------------------------------------------------- #
# PQC (post-quantum key registry / algorithm governance / EVM window)
# --------------------------------------------------------------------------- #


def _open_evm_window(
    *,
    sender: str,
    blocks: int,
    max_txs: int,
    max_value: str | int,
    native_only: bool = False,
    allowed_targets: list[str] | tuple[str, ...] = (),
    validators: list[str] | tuple[str, ...] = (),
    staking_validators: list[str] | tuple[str, ...] = (),
    ibc_receivers: list[str] | tuple[str, ...] = (),
) -> Msg:
    """Build ``MsgOpenEVMWindow`` (chain v3.2.0), validating the chain's bounds.

    An EVM-lane transaction is admitted only from an account that has a
    registered post-quantum key AND an open, unexhausted window. This message
    travels the Cosmos lane, so it carries the account's hybrid signature - the
    classical key alone can never open a window.

    Every field is required: the chain refuses an omitted field rather than
    defaulting it. ``blocks`` must be in ``1..17280``, ``max_txs`` in ``1..1000``
    and ``max_value`` a positive integer uqor amount that covers the transferred
    value PLUS the maximum fee (gas limit x gas fee cap) of every admitted
    transaction. Opening replaces any existing window.

    Three traps, in full in :mod:`qorsdk.evm_window`: opening ADVANCES the
    account's sequence, which is also the EVM nonce (open, then read the nonce,
    then sign the EVM transaction); ``max_value`` covers fees as well as value;
    and 17280 blocks is NOT "about 24 hours" on any live QoreChain network -
    quote blocks, or compute from the chain's recent block time.

    ``native_only`` narrows the window to plain native transfers and
    ``allowed_targets`` (at most 16) to those recipients (chain v3.2.3). Both are
    new fields: a node below v3.2.3 refuses the whole transaction when either is
    set, so set them only once the network has applied v3.2.3.

    :raises ValueError: If a bound is violated, naming the bound.
    """
    params = validate_evm_window_params(
        blocks=blocks, max_txs=max_txs, max_value=max_value
    )
    targets = validate_evm_window_targets(allowed_targets)
    return Msg(
        type_url=OPEN_EVM_WINDOW_TYPE_URL,
        value=pqc_tx.MsgOpenEVMWindow(
            sender=sender,
            blocks=params.blocks,
            max_txs=params.max_txs,
            max_value=params.max_value,
            native_only=native_only,
            allowed_targets=targets,
            validators=validate_evm_window_validators(validators),
            staking_validators=validate_evm_window_staking_validators(staking_validators),
            ibc_receivers=validate_evm_window_ibc_receivers(ibc_receivers),
        ),
    )


def _close_evm_window(*, sender: str) -> Msg:
    """Build ``MsgCloseEVMWindow``: closes the sender's window in the same block."""
    return Msg(
        type_url=CLOSE_EVM_WINDOW_TYPE_URL,
        value=pqc_tx.MsgCloseEVMWindow(sender=sender),
    )


def _authorize_evm_delegation(*, sender: str, delegate: str, blocks: int) -> Msg:
    """Build ``MsgAuthorizeEVMDelegation`` (chain v3.2.2), validating its bounds.

    The account's post-quantum consent to one EIP-7702 delegation of its own
    account: from v3.2.2 the EVM lane refuses a type-4 transaction that would
    change an account's code unless that account consented to exactly that
    delegate. Single use, bounded in blocks (``1..17280``), replaces any earlier
    consent, revoked by ``MsgCloseEVMWindow``. Broadcasting it ADVANCES the
    account's nonce; see :mod:`qorsdk.evm_delegation` for the ordering.

    :raises ValueError: If the delegate or the bound is invalid.
    """
    delegate, blocks = validate_evm_delegation_consent(delegate=delegate, blocks=blocks)
    return Msg(
        type_url=AUTHORIZE_EVM_DELEGATION_TYPE_URL,
        value=pqc_tx.MsgAuthorizeEVMDelegation(
            sender=sender, delegate=delegate, blocks=blocks
        ),
    )


def _clear_evm_delegation(*, sender: str) -> Msg:
    """Build ``MsgClearEVMDelegation`` (chain v3.2.2): remove the sender's
    installed delegation on the Cosmos lane, with no EVM transaction."""
    return Msg(
        type_url=CLEAR_EVM_DELEGATION_TYPE_URL,
        value=pqc_tx.MsgClearEVMDelegation(sender=sender),
    )


_authorize_evm_delegation.__name__ = "MsgAuthorizeEVMDelegation"
_authorize_evm_delegation.__qualname__ = "MsgAuthorizeEVMDelegation"
_clear_evm_delegation.__name__ = "MsgClearEVMDelegation"
_clear_evm_delegation.__qualname__ = "MsgClearEVMDelegation"
_open_evm_window.__name__ = "MsgOpenEVMWindow"
_open_evm_window.__qualname__ = "MsgOpenEVMWindow"
_close_evm_window.__name__ = "MsgCloseEVMWindow"
_close_evm_window.__qualname__ = "MsgCloseEVMWindow"

def _register_kem_key(
    *, sender: str, public_key: bytes, algorithm_id: int = KEM_ALGORITHM_ML_KEM_1024
) -> Msg:
    """Build ``MsgRegisterKEMKey`` (chain v3.2.5): publish the sender's
    key-encapsulation public key (ML-KEM-1024 by default, 1568 bytes). Sending
    it again replaces the published key. Always needs the hybrid signature.

    :raises ValueError: From :func:`~qorsdk.kem.validate_kem_public_key`.
    """
    if not sender:
        raise ValueError("register_kem_key: sender is required")
    validate_kem_public_key(bytes(public_key), algorithm_id)
    return Msg(
        type_url=REGISTER_KEM_KEY_TYPE_URL,
        value=pqc_tx.MsgRegisterKEMKey(
            sender=sender, algorithm_id=algorithm_id, public_key=bytes(public_key)
        ),
    )


def _remove_kem_key(*, sender: str) -> Msg:
    """Build ``MsgRemoveKEMKey`` (chain v3.2.5): withdraw the sender's published
    KEM key. Always needs the hybrid signature."""
    if not sender:
        raise ValueError("remove_kem_key: sender is required")
    return Msg(type_url=REMOVE_KEM_KEY_TYPE_URL, value=pqc_tx.MsgRemoveKEMKey(sender=sender))


_register_kem_key.__name__ = "MsgRegisterKEMKey"
_register_kem_key.__qualname__ = "MsgRegisterKEMKey"
_remove_kem_key.__name__ = "MsgRemoveKEMKey"
_remove_kem_key.__qualname__ = "MsgRemoveKEMKey"

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
    rotate_pqc_key=composer(
        "/qorechain.pqc.v1.MsgRotatePQCKey", pqc_tx.MsgRotatePQCKey
    ),
    deprecate_algorithm=composer(
        "/qorechain.pqc.v1.MsgDeprecateAlgorithm", pqc_tx.MsgDeprecateAlgorithm
    ),
    disable_algorithm=composer(
        "/qorechain.pqc.v1.MsgDisableAlgorithm", pqc_tx.MsgDisableAlgorithm
    ),
    # v3.2.0 EVM authorisation window. Validating composers: the bounds the
    # chain enforces in ValidateBasic are checked here so a caller fails fast
    # instead of paying for a refused transaction.
    open_evm_window=_open_evm_window,
    close_evm_window=_close_evm_window,
    # v3.2.2 EIP-7702 delegation consent.
    authorize_evm_delegation=_authorize_evm_delegation,
    clear_evm_delegation=_clear_evm_delegation,
    # v3.2.5 KEM key registry.
    register_kem_key=_register_kem_key,
    remove_kem_key=_remove_kem_key,
)

# --------------------------------------------------------------------------- #
# SVM (Solana-style VM programs/accounts)
# --------------------------------------------------------------------------- #


def _svm_update_params(*, authority: str = "", params: Any = None) -> Msg:
    """Build svm ``MsgUpdateParams`` (governance only): replaces ``SVMParams``
    wholesale, among them whether the lane is enabled.

    ``params`` is a mapping with EVERY ``SVMParams`` field
    (:data:`~qorsdk.governance.SVM_PARAMS_FIELDS`, including the v3.2.8 custody
    ceilings ``max_custody_uqor``, ``max_custody_hard_uqor`` and
    ``max_account_excess_uqor``): a field left out would be zero, which removes
    that ceiling. ``enabled = true`` with ``max_custody_hard_uqor == 0`` is
    refused: governance must set a hard custody ceiling before opening the lane.
    Build a proposal with :func:`~qorsdk.governance.svm_update_params_from_current`.

    :raises ValueError: Naming the missing fields or the violated rule.
    """
    if not authority:
        raise ValueError("svm update_params: authority (the governance module account) is required")
    validate_svm_params(params)
    return Msg(
        type_url=UPDATE_SVM_PARAMS_TYPE_URL,
        value=svm_tx.MsgUpdateParams(
            authority=authority, params=svm_tx.SVMParams(**dict(params))
        ),
    )


_svm_update_params.__name__ = "MsgUpdateParams"
_svm_update_params.__qualname__ = "MsgUpdateParams"

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
    # Governance-only (authority = the gov module account): replaces the SVM
    # runtime parameters (``SVMParams``) wholesale, so the lane's limits - and
    # whether it is enabled at all - are a proposal rather than a binary release.
    # Every field required (v3.2.8).
    update_params=_svm_update_params,
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
    # v3.2.3: replace the licence grant authority. Governance only.
    update_authority=composer(
        "/qorechain.license.v1.MsgUpdateAuthority", license_tx.MsgUpdateAuthority
    ),
)

# --------------------------------------------------------------------------- #
# Abstract account (programmable accounts / spending rules)
# --------------------------------------------------------------------------- #
_compose_update_spending_rules = composer(
    "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
    abstractaccount_tx.MsgUpdateSpendingRules,
)


def _update_spending_rules(**fields: Any) -> Msg:
    """Build ``MsgUpdateSpendingRules`` (owner-signed), checking the rules first.

    The rules are checked by
    :func:`~qorsdk.messages.spending_rules.validate_spending_rules`: an enabled
    rule that bounds nothing, or a denom limit that sets no amount, is refused
    here rather than stored as a limit that limits nothing.

    :raises ValueError: Naming the rule and the problem.
    """
    built = _compose_update_spending_rules(**fields)
    validate_spending_rules(built.value.rules)  # type: ignore[attr-defined]
    return built


_update_spending_rules.__name__ = "MsgUpdateSpendingRules"
_update_spending_rules.__qualname__ = "MsgUpdateSpendingRules"

_compose_register_authenticator = composer(
    "/qorechain.abstractaccount.v1.MsgRegisterAuthenticator",
    abstractaccount_tx.MsgRegisterAuthenticator,
)


def _register_authenticator(**fields: Any) -> Msg:
    """Build ``MsgRegisterAuthenticator`` (owner-signed): link a foreign-scheme
    key to an account.

    From chain v3.2.8 ``possession_proof`` is required: the signature of the key
    being linked over
    :func:`qorsdk.authenticator.authenticator_link_message` (chain id, account,
    scheme, key). An empty proof is refused here. A key with the ``send``,
    ``evm``, ``deploy``, ``svm`` or ``all`` permission also needs a spending rule
    on the account; :func:`qorsdk.authenticator.link_authenticator_msgs` builds
    both messages and checks the rule.

    :raises ValueError: If ``possession_proof`` is empty, or ``pubkey`` is a
        65-byte uncompressed key.
    """
    if not fields.get("possession_proof"):
        raise ValueError(
            "register_authenticator: possession_proof is required from chain v3.2.8. Sign "
            "qorsdk.authenticator.authenticator_link_message(chain_id, account_address, scheme, "
            "pubkey) with the key being linked (Phantom signMessage, MetaMask personal_sign, or "
            "link_proof_ed25519 / link_proof_secp256k1 / link_proof_eth) and pass the signature"
        )
    if len(bytes(fields.get("pubkey") or b"")) == 65:
        raise ValueError(
            "register_authenticator: a 65-byte uncompressed key is refused; link the 33-byte "
            "compressed key or the 20-byte Ethereum address"
        )
    return _compose_register_authenticator(**fields)


_register_authenticator.__name__ = "MsgRegisterAuthenticator"
_register_authenticator.__qualname__ = "MsgRegisterAuthenticator"


def _update_config(
    *,
    authority: str,
    enabled: bool,
    max_session_keys: int,
    max_spending_rules: int,
    default_session_ttl: int,
) -> Msg:
    """Build ``MsgUpdateConfig`` (chain v3.2.5, governance only): replace the
    abstractaccount configuration wholesale. ``enabled`` gates account
    creation, authenticator registration and both execute lanes.

    :raises ValueError: From :func:`~qorsdk.abstractaccount.validate_update_config`.
    """
    validate_update_config(
        authority=authority,
        max_session_keys=max_session_keys,
        max_spending_rules=max_spending_rules,
        default_session_ttl=default_session_ttl,
    )
    return Msg(
        type_url=UPDATE_ABSTRACT_ACCOUNT_CONFIG_TYPE_URL,
        value=abstractaccount_tx.MsgUpdateConfig(
            authority=authority,
            enabled=bool(enabled),
            max_session_keys=max_session_keys,
            max_spending_rules=max_spending_rules,
            default_session_ttl=default_session_ttl,
        ),
    )


_update_config.__name__ = "MsgUpdateConfig"
_update_config.__qualname__ = "MsgUpdateConfig"

abstractaccount = SimpleNamespace(
    create_abstract_account=composer(
        "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
        abstractaccount_tx.MsgCreateAbstractAccount,
    ),
    update_spending_rules=_update_spending_rules,
    # possession_proof required from v3.2.8.
    register_authenticator=_register_authenticator,
    revoke_authenticator=composer(
        "/qorechain.abstractaccount.v1.MsgRevokeAuthenticator",
        abstractaccount_tx.MsgRevokeAuthenticator,
    ),
    execute_evm=composer(
        "/qorechain.abstractaccount.v1.MsgExecuteEVM",
        abstractaccount_tx.MsgExecuteEVM,
    ),
    execute_cosmos=composer(
        "/qorechain.abstractaccount.v1.MsgExecuteCosmos",
        abstractaccount_tx.MsgExecuteCosmos,
    ),
    # v3.2.5: replace the module configuration. Governance only.
    update_config=_update_config,
)

# --------------------------------------------------------------------------- #
# Cross-VM (inter-VM messaging)
# --------------------------------------------------------------------------- #
def _crossvm_update_params(**fields: Any) -> Msg:
    """Build crossvm ``MsgUpdateParams`` (governance only): replaces every
    crossvm parameter at once, among them the allowlist of
    ``"cosmwasm:<contract>"`` targets the EVM bridge precompile may call and
    their code pins.

    Every field is required (chain v3.2.8 added fields 7..18): ``authority`` and
    each of :data:`~qorsdk.governance.CROSSVM_UPDATE_PARAMS_FIELDS`. A field left
    out would be zero (``bridge_target_pins`` wiped), so a missing or ``None``
    field is refused; zero given explicitly is allowed for the v3.2.8 limits
    (the chain default). ``bridge_target_pins`` is a list of
    ``{"target", "code_id", "history_len"}`` mappings (or ``BridgeTargetPin``).
    Build a proposal from the values in force with
    :func:`~qorsdk.governance.crossvm_update_params_from_current`.

    :raises ValueError: Naming the missing fields, or from
        :func:`~qorsdk.governance.validate_crossvm_update_params`.
    """
    what = "crossvm update_params"
    unknown = set(fields) - {"authority", *CROSSVM_UPDATE_PARAMS_FIELDS}
    if unknown:
        raise ValueError(f"{what}: unknown field(s): {', '.join(sorted(unknown))}")
    require_fields(what, fields, ("authority", *CROSSVM_UPDATE_PARAMS_FIELDS))
    targets = list(fields["bridge_allowed_targets"])
    validate_crossvm_update_params(
        authority=fields["authority"],
        max_message_size=fields["max_message_size"],
        max_queue_size=fields["max_queue_size"],
        queue_timeout_blocks=fields["queue_timeout_blocks"],
        enabled=fields["enabled"],
        bridge_allowed_targets=targets,
    )
    pins = list(fields["bridge_target_pins"])
    validate_crossvm_target_pins(pins, targets, what)
    extra = {
        name: _non_negative_int(fields[name], name, what)
        for name in CROSSVM_UPDATE_PARAMS_FIELDS[6:]
    }
    return Msg(
        type_url=UPDATE_CROSSVM_PARAMS_TYPE_URL,
        value=crossvm_tx.MsgUpdateParams(
            authority=fields["authority"],
            max_message_size=fields["max_message_size"],
            max_queue_size=fields["max_queue_size"],
            queue_timeout_blocks=fields["queue_timeout_blocks"],
            enabled=bool(fields["enabled"]),
            bridge_allowed_targets=targets,
            bridge_target_pins=[
                p
                if isinstance(p, crossvm_tx.BridgeTargetPin)
                else crossvm_tx.BridgeTargetPin(
                    target=p["target"], code_id=p["code_id"], history_len=p["history_len"]
                )
                for p in pins
            ],
            **extra,
        ),
    )


_crossvm_update_params.__name__ = "MsgUpdateParams"
_crossvm_update_params.__qualname__ = "MsgUpdateParams"

crossvm = SimpleNamespace(
    cross_vm_call=composer(
        "/qorechain.crossvm.v1.MsgCrossVMCall", crossvm_tx.MsgCrossVMCall
    ),
    process_queue=composer(
        "/qorechain.crossvm.v1.MsgProcessQueue", crossvm_tx.MsgProcessQueue
    ),
    # Replace the module parameters (governance only). Every field required.
    update_params=_crossvm_update_params,
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

# --------------------------------------------------------------------------- #
# Staking tiers (chain v3.2.4): lock part of a delegation for 3, 6 or 12 months
# for a bonus on top of the staking reward, leave a lock early (a penalty is
# burned and the bonus forfeited), and claim the accrued bonus.
# --------------------------------------------------------------------------- #


def _lock_delegation(*, delegator: str, validator: str, amount: str, months: int) -> Msg:
    """Build ``MsgLockDelegation``: lock ``amount`` (base units) of the
    delegator's existing delegation to ``validator`` for ``months`` (3, 6 or 12).

    :raises ValueError: Naming the field, from
        :func:`~qorsdk.stakingtier.validate_lock_delegation`.
    """
    validate_lock_delegation(
        delegator=delegator, validator=validator, amount=amount, months=months
    )
    return Msg(
        type_url=LOCK_DELEGATION_TYPE_URL,
        value=stakingtier_tx.MsgLockDelegation(
            delegator=delegator, validator=validator, amount=amount, months=months
        ),
    )


_lock_delegation.__name__ = "MsgLockDelegation"
_lock_delegation.__qualname__ = "MsgLockDelegation"

stakingtier = SimpleNamespace(
    lock_delegation=_lock_delegation,
    # Release lock ``lock_id`` before its term ends.
    unlock_early=composer(UNLOCK_EARLY_TYPE_URL, stakingtier_tx.MsgUnlockEarly),
    # Claim the holder's accrued bonus.
    claim_bonus=composer(CLAIM_BONUS_TYPE_URL, stakingtier_tx.MsgClaimBonus),
    # Governance: replace the module parameters.
    update_params=composer(
        UPDATE_STAKING_TIER_PARAMS_TYPE_URL, stakingtier_tx.MsgUpdateParams
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
    "stakingtier",
]
