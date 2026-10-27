"""Typed message composers for every transaction QoreChain supports.

The :data:`msg` namespace groups composers by module so callers write
``msg.amm.swap_exact_in(...)``, ``msg.staking.delegate(...)``,
``msg.pqc.register_pqc_key(...)``, etc. Standard Native modules
(bank/staking/distribution/gov/authz/feegrant/ibc) sit alongside the QoreChain
custom modules (amm/bridge/rdk/multilayer/pqc/svm/lightnode/license/
abstractaccount/crossvm/rlconsensus/stakingtier).

Every composer returns a :class:`Msg` (``{type_url, value}``) - pass a list of
them to :func:`qorechain.tx.send_messages` or the hybrid PQC tx path.
"""

from __future__ import annotations

from types import SimpleNamespace

from ._composer import Msg, composer
from .cosmos import (
    authz,
    bank,
    distribution,
    feegrant,
    gov,
    ibc,
    ibc_timeout_timestamp,
    staking,
)
from .qorechain import (
    abstractaccount,
    amm,
    bridge,
    crossvm,
    license,
    lightnode,
    multilayer,
    pqc,
    rdk,
    rlconsensus,
    stakingtier,
    svm,
)
from .registry import (
    COSMOS_REGISTRY_TYPES,
    QORECHAIN_REGISTRY_TYPES,
    decode_any,
    qorechain_registry,
    resolve_message_type,
)
from .spending_rules import (
    MAX_ALLOWED_EVM_CALLS,
    MAX_DENOM_LIMITS,
    validate_spending_rules,
)

#: All message composers, grouped by module. Recommended import::
#:
#:     from qorsdk import msg
#:     m = msg.amm.swap_exact_in(sender=addr, pool_id=1, denom_out="uqor", min_out="100")
msg = SimpleNamespace(
    # standard native
    bank=bank,
    staking=staking,
    distribution=distribution,
    gov=gov,
    authz=authz,
    feegrant=feegrant,
    ibc=ibc,
    # qorechain custom modules
    amm=amm,
    bridge=bridge,
    rdk=rdk,
    multilayer=multilayer,
    pqc=pqc,
    svm=svm,
    lightnode=lightnode,
    license=license,
    abstractaccount=abstractaccount,
    crossvm=crossvm,
    rlconsensus=rlconsensus,
    stakingtier=stakingtier,
)

__all__ = [
    "Msg",
    "composer",
    "msg",
    # per-module groups (tree-shakeable named imports)
    "bank",
    "staking",
    "distribution",
    "gov",
    "authz",
    "feegrant",
    "ibc",
    "ibc_timeout_timestamp",
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
    # registry
    "qorechain_registry",
    "resolve_message_type",
    "decode_any",
    "QORECHAIN_REGISTRY_TYPES",
    "COSMOS_REGISTRY_TYPES",
    # client-side checks run by the abstract-account spending-rules composer
    "validate_spending_rules",
    "MAX_DENOM_LIMITS",
    "MAX_ALLOWED_EVM_CALLS",
]
