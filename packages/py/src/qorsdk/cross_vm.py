"""High-level unified cross-VM call helper for QoreChain's ``x/crossvm`` module.

QoreChain runs several execution VMs side by side — the EVM, a CosmWasm VM, and
an SVM (Solana-style) VM. The ``x/crossvm`` module routes a call from one VM to a
contract on another as a single message, ``MsgCrossVMCall``:

    MsgCrossVMCall { sender, source_vm, target_vm, target_contract, payload, funds }

with type URL ``/qorechain.crossvm.v1.MsgCrossVMCall`` and
``source_vm`` / ``target_vm`` drawn from :data:`VM_TYPES` (``"evm"``,
``"cosmwasm"``, ``"svm"``).

This helper mirrors the ergonomic rollup/multilayer helpers: it wraps the typed
:func:`qorsdk.messages.qorechain.crossvm.cross_vm_call` composer and the SDK's
tx surface (:func:`~qorsdk.tx.send_messages` / :func:`~qorsdk.tx.build_hybrid_tx`
+ :func:`~qorsdk.tx.broadcast`) so an app can build, sign, and broadcast a
cross-VM call — or several atomically in ONE transaction — without hand-rolling
messages.

Payload encoding (one of three sources, checked in this order):

- ``payload=<bytes>`` — used verbatim (raw VM-native calldata; the only EVM form
  supported here, since EVM ABI-encoding of high-level calls is a TS-only DX
  convenience).
- ``cosmwasm=<dict>`` — ``json.dumps`` UTF-8 encoded (CosmWasm execute message).
- ``svm=<bytes>`` — used verbatim (raw SVM instruction data).

Omitting all three sends an empty payload.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin

from .accounts import Secp256k1Account
from .messages._composer import Msg
from .messages.qorechain import crossvm as crossvm_msg
from .pqc import PqcKeypair
from .tx import broadcast, build_hybrid_tx, send_messages

#: The valid cross-VM target/source VM identifiers.
VM_TYPES: tuple[str, ...] = ("evm", "cosmwasm", "svm")

#: A cross-VM VM type: ``"evm"`` | ``"cosmwasm"`` | ``"svm"``.
VmType = Literal["evm", "cosmwasm", "svm"]

#: A Cosmos coin as a plain dict, e.g. ``{"denom": "uqor", "amount": "1000"}``.
CoinDict = dict[str, str]
#: A Cosmos ``StdFee``-shaped dict (as produced by :func:`qorsdk.fees.estimate_fee`).
FeeDict = dict[str, Any]


@dataclass(frozen=True)
class CrossVmCallOptions:
    """One cross-VM call's parameters (shared by ``call`` / ``build_call`` / atomic).

    Exactly one of ``payload`` / ``cosmwasm`` / ``svm`` selects the payload
    bytes; omit all three for an empty payload.
    """

    #: The target VM the call routes to (one of :data:`VM_TYPES`).
    target_vm: VmType
    #: The contract/program address on the target VM.
    target_contract: str
    #: The originating VM. Defaults to ``"evm"``.
    source_vm: VmType = "evm"
    #: Funds to attach, as ``{"denom", "amount"}`` dicts.
    funds: list[CoinDict] | None = None
    #: Raw payload bytes (used verbatim).
    payload: bytes | None = None
    #: A CosmWasm execute message (``json.dumps`` UTF-8 encoded).
    cosmwasm: dict[str, Any] | None = None
    #: Raw SVM instruction data (used verbatim).
    svm: bytes | None = None


def _validate_vm(vm: str, field: str) -> None:
    if vm not in VM_TYPES:
        raise ValueError(f"{field} must be one of {VM_TYPES!r}, got {vm!r}")


def _resolve_payload(
    payload: bytes | None,
    cosmwasm: dict[str, Any] | None,
    svm: bytes | None,
) -> bytes:
    """Resolve the single payload source into raw bytes (empty when all omitted)."""
    provided = [s for s in (payload, cosmwasm, svm) if s is not None]
    if len(provided) > 1:
        raise ValueError(
            "provide at most one of payload / cosmwasm / svm for the cross-VM payload"
        )
    if payload is not None:
        return payload
    if cosmwasm is not None:
        return json.dumps(cosmwasm, separators=(",", ":")).encode("utf-8")
    if svm is not None:
        return svm
    return b""


def _to_coins(funds: list[CoinDict] | None) -> list[Coin]:
    return [Coin(denom=c["denom"], amount=str(c["amount"])) for c in (funds or [])]


def build_cross_vm_call(
    *,
    sender: str,
    target_vm: VmType,
    target_contract: str,
    source_vm: VmType = "evm",
    funds: list[CoinDict] | None = None,
    payload: bytes | None = None,
    cosmwasm: dict[str, Any] | None = None,
    svm: bytes | None = None,
) -> Msg:
    """Build a ``MsgCrossVMCall`` :class:`~qorsdk.messages.Msg` (no signing).

    See the module docstring for payload-source resolution. ``source_vm`` and
    ``target_vm`` are validated against :data:`VM_TYPES`.
    """
    _validate_vm(source_vm, "source_vm")
    _validate_vm(target_vm, "target_vm")
    resolved = _resolve_payload(payload, cosmwasm, svm)
    message: Msg = crossvm_msg.cross_vm_call(
        sender=sender,
        source_vm=source_vm,
        target_vm=target_vm,
        target_contract=target_contract,
        payload=resolved,
        funds=_to_coins(funds),
    )
    return message


class CrossVmClient:
    """Ergonomic build/sign/broadcast client for ``x/crossvm`` cross-VM calls.

    Bind it to a signing :class:`~qorsdk.accounts.Secp256k1Account` plus the tx
    context (chain id, account number, REST url, default fee). The account's
    address is used as the message ``sender``, so callers never repeat it.

    Provide a ``pqc_keypair`` to sign quantum-safe hybrid transactions; otherwise
    a classical secp256k1 tx is built. Pass a ``query`` (a
    :class:`~qorsdk.query.grpc.CrossVmQueryClient`) and/or a ``qor``
    (:class:`~qorsdk.qor.QorClient`) to enable :meth:`get_message`.
    """

    def __init__(
        self,
        *,
        account: Secp256k1Account,
        chain_id: str,
        account_number: int,
        rest_url: str,
        fee: FeeDict,
        sequence: int = 0,
        pqc_keypair: PqcKeypair | None = None,
        query: Any | None = None,
        qor: Any | None = None,
    ) -> None:
        self._account = account
        self._chain_id = chain_id
        self._account_number = account_number
        self._rest_url = rest_url
        self._fee = fee
        self._sequence = sequence
        self._pqc_keypair = pqc_keypair
        self._query = query
        self._qor = qor

    @property
    def sender(self) -> str:
        """The bound account address used as every message's ``sender``."""
        return self._account.address

    def build_call(
        self,
        *,
        target_vm: VmType,
        target_contract: str,
        source_vm: VmType = "evm",
        funds: list[CoinDict] | None = None,
        payload: bytes | None = None,
        cosmwasm: dict[str, Any] | None = None,
        svm: bytes | None = None,
    ) -> Msg:
        """Build a ``MsgCrossVMCall`` for the bound sender, without broadcasting."""
        return build_cross_vm_call(
            sender=self.sender,
            target_vm=target_vm,
            target_contract=target_contract,
            source_vm=source_vm,
            funds=funds,
            payload=payload,
            cosmwasm=cosmwasm,
            svm=svm,
        )

    def _build_msg_from_options(self, opts: CrossVmCallOptions) -> Msg:
        return build_cross_vm_call(
            sender=self.sender,
            target_vm=opts.target_vm,
            target_contract=opts.target_contract,
            source_vm=opts.source_vm,
            funds=opts.funds,
            payload=opts.payload,
            cosmwasm=opts.cosmwasm,
            svm=opts.svm,
        )

    def _sign_and_broadcast(
        self,
        messages: list[Msg],
        *,
        sequence: int | None = None,
        memo: str = "",
        mode: str = "sync",
    ) -> Any:
        seq = self._sequence if sequence is None else sequence
        if self._pqc_keypair is not None:
            built = build_hybrid_tx(
                account=self._account,
                pqc_keypair=self._pqc_keypair,
                messages=messages,
                fee=self._fee,
                chain_id=self._chain_id,
                account_number=self._account_number,
                sequence=seq,
                memo=memo,
            )
        else:
            built = send_messages(
                account=self._account,
                messages=messages,
                chain_id=self._chain_id,
                account_number=self._account_number,
                sequence=seq,
                fee=self._fee,
                memo=memo,
            )
        return broadcast(self._rest_url, built.tx_raw_bytes, mode=mode)  # type: ignore[arg-type]

    def call(
        self,
        *,
        target_vm: VmType,
        target_contract: str,
        source_vm: VmType = "evm",
        funds: list[CoinDict] | None = None,
        payload: bytes | None = None,
        cosmwasm: dict[str, Any] | None = None,
        svm: bytes | None = None,
        sequence: int | None = None,
        memo: str = "",
        mode: str = "sync",
    ) -> Any:
        """Build, sign, and broadcast a single ``MsgCrossVMCall``.

        Returns the decoded broadcast response. See the module docstring for how
        ``payload`` / ``cosmwasm`` / ``svm`` select the payload bytes.
        """
        message = self.build_call(
            target_vm=target_vm,
            target_contract=target_contract,
            source_vm=source_vm,
            funds=funds,
            payload=payload,
            cosmwasm=cosmwasm,
            svm=svm,
        )
        return self._sign_and_broadcast(
            [message], sequence=sequence, memo=memo, mode=mode
        )

    def call_atomic(
        self,
        options: list[CrossVmCallOptions],
        *,
        sequence: int | None = None,
        memo: str = "",
        mode: str = "sync",
    ) -> Any:
        """Broadcast N cross-VM calls atomically in ONE transaction.

        All ``MsgCrossVMCall`` messages share a single tx, so they succeed or
        fail together. Returns the decoded broadcast response.

        :raises ValueError: If ``options`` is empty.
        """
        if not options:
            raise ValueError("call_atomic requires at least one cross-VM call")
        messages = [self._build_msg_from_options(o) for o in options]
        return self._sign_and_broadcast(
            messages, sequence=sequence, memo=memo, mode=mode
        )

    def get_message(self, message_id: str) -> Any:
        """Read a cross-VM message by id.

        Prefers the typed ``query`` client's ``Message`` route; falls back to the
        ``qor_getCrossVMMessage`` JSON-RPC method on the ``qor`` client.

        :raises ValueError: If neither a ``query`` nor a ``qor`` client was given.
        """
        if self._query is not None:
            return self._query.message(message_id)
        if self._qor is not None:
            return self._qor.get_cross_vm_message(message_id)
        raise ValueError(
            "get_message requires a query client or a qor client — pass query=… "
            "or qor=… to CrossVmClient"
        )


def create_cross_vm_client(
    *,
    account: Secp256k1Account,
    chain_id: str,
    account_number: int,
    rest_url: str,
    fee: FeeDict,
    sequence: int = 0,
    pqc_keypair: PqcKeypair | None = None,
    query: Any | None = None,
    qor: Any | None = None,
) -> CrossVmClient:
    """Create a :class:`CrossVmClient` bound to a signing account and tx context."""
    return CrossVmClient(
        account=account,
        chain_id=chain_id,
        account_number=account_number,
        rest_url=rest_url,
        fee=fee,
        sequence=sequence,
        pqc_keypair=pqc_keypair,
        query=query,
        qor=qor,
    )


__all__ = [
    "VM_TYPES",
    "VmType",
    "CrossVmCallOptions",
    "CrossVmClient",
    "build_cross_vm_call",
    "create_cross_vm_client",
]
