"""High-level unified cross-VM call helper for QoreChain's ``x/crossvm`` module.

QoreChain runs several execution VMs side by side - the EVM, a CosmWasm VM, and
an SVM (Solana-style) VM. The ``x/crossvm`` module routes a call from one VM to a
contract on another as a single message, ``MsgCrossVMCall``:

    MsgCrossVMCall { sender, source_vm, target_vm, target_contract, payload,
                     funds, async }

with type URL ``/qorechain.crossvm.v1.MsgCrossVMCall`` and
``source_vm`` / ``target_vm`` drawn from :data:`VM_TYPES` (``"evm"``,
``"cosmwasm"``, ``"svm"``).

**``source_vm`` is IGNORED by the chain (v3.1.97).** The origin lane is derived
from the execution context - a caller describing itself is not evidence of what
it is - and the field is retained only so the field number stays taken and older
clients that still set it are accepted rather than rejected. The SDK still
accepts and sends it (default ``"evm"``), but setting it has no on-chain effect.

``async_`` (proto field ``async``, 7) queues the call for a later
``MsgProcessQueue`` dispatch instead of running it. The default, ``False``,
executes the call inside the transaction and returns the callee's answer - which
is what a caller that needs the result requires. A queued call's
``MsgCrossVMCallResponse`` carries ``executed=False`` and no ``data`` yet.

**Async calls into CosmWasm (chain v3.2.8).** ``async_gas_limit`` (field 8; 0 =
500,000; a set value must be 250,000..10,000,000) and ``async_max_factor`` (field
9, millionths, 1,000,000 = 1x; 0 = four times the congestion factor at
submission) apply only to async calls into CosmWasm and are refused otherwise.
The call holds an escrow of ``async_gas_limit x factor x gas price`` (about
0.2 QOR by default) refunded when it finishes, pays a queue-slot fee, and a
sender may have at most 100 pending calls.

**Gas.** A cross-VM call's gas varies widely (the first call of a contract code
in a block costs much more), so use simulation: pass ``fee="auto"`` to
:class:`CrossVmClient` rather than a fixed fee.

:func:`decode_cross_vm_responses` decodes the ``MsgCrossVMCallResponse`` entries
out of a committed transaction's result, surfacing ``message_id`` together with
``executed`` / ``data`` / ``gas_used``.

This helper mirrors the ergonomic rollup/multilayer helpers: it wraps the typed
:func:`qorsdk.messages.qorechain.crossvm.cross_vm_call` composer and the SDK's
tx surface (:func:`~qorsdk.tx.send_messages` / :func:`~qorsdk.tx.build_hybrid_tx`
+ :func:`~qorsdk.tx.broadcast`) so an app can build, sign, and broadcast a
cross-VM call - or several atomically in ONE transaction - without hand-rolling
messages.

Payload encoding (one of three sources, checked in this order):

- ``payload=<bytes>`` - used verbatim (raw VM-native calldata; the only EVM form
  supported here, since EVM ABI-encoding of high-level calls is a TS-only DX
  convenience).
- ``cosmwasm=<dict>`` - ``json.dumps`` UTF-8 encoded (CosmWasm execute message).
- ``svm=<bytes>`` - used verbatim (raw SVM instruction data).

Omitting all three sends an empty payload.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin

from .accounts import Secp256k1Account
from .gas import DEFAULT_GAS_PRICE, GasPrice, auto_fee
from .messages._composer import Msg
from .messages.qorechain import crossvm as crossvm_msg
from .pqc import PqcKeypair
from .signbytes import SignBytesVersion
from .tx import broadcast, build_hybrid_tx, hybrid_sign_and_broadcast, send_messages

#: The valid cross-VM target/source VM identifiers.
VM_TYPES: tuple[str, ...] = ("evm", "cosmwasm", "svm")

#: A cross-VM VM type: ``"evm"`` | ``"cosmwasm"`` | ``"svm"``.
VmType = Literal["evm", "cosmwasm", "svm"]

#: A Native coin as a plain dict, e.g. ``{"denom": "uqor", "amount": "1000"}``.
CoinDict = dict[str, str]
#: A Native ``StdFee``-shaped dict (as produced by :func:`qorsdk.fees.estimate_fee`).
FeeDict = dict[str, Any]

#: The ``MsgCrossVMCall`` field name for the queue flag. ``async`` is a Python
#: keyword, so the generated protobuf class only accepts it through ``**kwargs``.
_ASYNC_FIELD = "async"

#: ``async_gas_limit`` bounds for a set value (0 = the chain default, 500,000).
ASYNC_GAS_LIMIT_MIN = 250_000
ASYNC_GAS_LIMIT_MAX = 10_000_000
#: The most pending cross-VM calls one sender may have (chain v3.2.8).
MAX_PENDING_PER_SENDER = 100

#: The fee a transaction is built with for simulation only (never broadcast).
_SIMULATION_FEE: FeeDict = {"amount": [], "gas": "0"}

#: Type URL of the response the chain returns for each ``MsgCrossVMCall``.
CROSS_VM_CALL_RESPONSE_TYPE_URL = "/qorechain.crossvm.v1.MsgCrossVMCallResponse"


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
    #: The originating VM. Defaults to ``"evm"``. **Ignored by the chain** since
    #: v3.1.97 (the origin lane is derived from the execution context); still
    #: sent so older nodes keep accepting the message.
    source_vm: VmType = "evm"
    #: Funds to attach, as ``{"denom", "amount"}`` dicts.
    funds: list[CoinDict] | None = None
    #: Raw payload bytes (used verbatim).
    payload: bytes | None = None
    #: A CosmWasm execute message (``json.dumps`` UTF-8 encoded).
    cosmwasm: dict[str, Any] | None = None
    #: Raw SVM instruction data (used verbatim).
    svm: bytes | None = None
    #: Queue the call for a later ``MsgProcessQueue`` dispatch instead of
    #: executing it now. Default ``False`` - execute now and return the answer.
    async_: bool = False
    #: Gas for an async call into CosmWasm (0 = 500,000; else 250,000..10,000,000).
    async_gas_limit: int | None = None
    #: Max congestion factor for an async CosmWasm call, in millionths (0 = 4x
    #: the factor at submission).
    async_max_factor: int | None = None


@dataclass(frozen=True)
class CrossVmCallResult:
    """One decoded ``MsgCrossVMCallResponse``.

    Produced by :func:`decode_cross_vm_responses` from a committed transaction's
    result. A queued (``async_=True``) call comes back with ``executed=False``,
    empty ``data`` and ``gas_used=0`` - its answer is only known once
    ``MsgProcessQueue`` dispatches it.
    """

    #: The cross-VM message id, usable with :meth:`CrossVmClient.get_message`.
    message_id: str
    #: ``False`` for a queued call, whose result is not known yet.
    executed: bool
    #: The callee's return value (empty until the call executes).
    data: bytes
    #: Gas the cross-VM execution consumed (``0`` for a queued call).
    gas_used: int


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


def validate_async_options(
    *,
    target_vm: str,
    async_: bool,
    async_gas_limit: int | None,
    async_max_factor: int | None,
) -> tuple[int, int]:
    """Check ``async_gas_limit`` / ``async_max_factor`` (chain v3.2.8) and return
    them as ints (0 = chain default).

    :raises ValueError: If either is set on a synchronous call or a target other
        than CosmWasm, or out of range.
    """
    gas = 0 if async_gas_limit is None else async_gas_limit
    factor = 0 if async_max_factor is None else async_max_factor
    for name, v in (("async_gas_limit", gas), ("async_max_factor", factor)):
        if isinstance(v, bool) or not isinstance(v, int) or v < 0:
            raise ValueError(f"{name} must be a non-negative integer, got {v!r}")
    if gas or factor:
        if not async_:
            raise ValueError(
                "async_gas_limit / async_max_factor apply only to async calls (async_=True)"
            )
        if target_vm != "cosmwasm":
            raise ValueError(
                "async_gas_limit / async_max_factor apply only to async calls into cosmwasm, "
                f"not {target_vm!r}"
            )
    if gas and not ASYNC_GAS_LIMIT_MIN <= gas <= ASYNC_GAS_LIMIT_MAX:
        raise ValueError(
            f"async_gas_limit must be 0 (default 500,000) or {ASYNC_GAS_LIMIT_MIN:,}.."
            f"{ASYNC_GAS_LIMIT_MAX:,}, got {gas}"
        )
    return gas, factor


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
    async_: bool = False,
    async_gas_limit: int | None = None,
    async_max_factor: int | None = None,
) -> Msg:
    """Build a ``MsgCrossVMCall`` :class:`~qorsdk.messages.Msg` (no signing).

    See the module docstring for payload-source resolution. ``source_vm`` and
    ``target_vm`` are validated against :data:`VM_TYPES`.

    :param source_vm: Retained for older nodes; the chain **ignores** it and
        derives the origin lane from the execution context.
    :param async_: Queue the call for ``MsgProcessQueue`` instead of executing
        it in this transaction. Default ``False`` (execute now, return the
        answer).
    :param async_gas_limit: Gas for an async call into CosmWasm (chain v3.2.8;
        0 or ``None`` = 500,000, else 250,000..10,000,000).
    :param async_max_factor: Max congestion factor of an async CosmWasm call in
        millionths (1,000,000 = 1x; 0 or ``None`` = 4x the factor at submission).
    :raises ValueError: See :func:`validate_async_options`.
    """
    _validate_vm(source_vm, "source_vm")
    _validate_vm(target_vm, "target_vm")
    gas, factor = validate_async_options(
        target_vm=target_vm,
        async_=async_,
        async_gas_limit=async_gas_limit,
        async_max_factor=async_max_factor,
    )
    resolved = _resolve_payload(payload, cosmwasm, svm)
    message: Msg = crossvm_msg.cross_vm_call(
        sender=sender,
        source_vm=source_vm,
        target_vm=target_vm,
        target_contract=target_contract,
        payload=resolved,
        funds=_to_coins(funds),
        async_gas_limit=gas,
        async_max_factor=factor,
        **{_ASYNC_FIELD: bool(async_)},
    )
    return message


def _result_data_hex(response: Any) -> str:
    """Pull the hex-encoded ``TxMsgData`` out of whatever tx result was passed.

    Accepts a REST broadcast body (``{"tx_response": {...}}``), a bare
    ``tx_response`` dict, an :class:`~qorsdk.track.IncludedTx` (via its ``raw``),
    or the hex string itself. Returns ``""`` when the result carries no data -
    a ``sync``-mode broadcast has not executed yet, so there is nothing to
    decode.
    """
    if response is None:
        return ""
    if isinstance(response, str):
        return response
    raw = getattr(response, "raw", None)
    if raw is not None and not isinstance(response, dict):
        return _result_data_hex(raw)
    if isinstance(response, dict):
        if "tx_response" in response:
            return _result_data_hex(response["tx_response"])
        data = response.get("data")
        if isinstance(data, str):
            return data
    return ""


def decode_cross_vm_responses(response: Any) -> list[CrossVmCallResult]:
    """Decode every ``MsgCrossVMCallResponse`` in a committed tx's result.

    The chain returns the responses in the tx result's ``data`` field, a
    hex-encoded ``TxMsgData`` whose ``msg_responses`` hold one ``Any`` per
    message. Non-cross-VM responses (e.g. from other messages in the same tx)
    are skipped, so an atomic call's results come back in message order.

    Pass the REST broadcast body, a bare ``tx_response`` dict, or an
    :class:`~qorsdk.track.IncludedTx` from :func:`~qorsdk.track.wait_for_tx`.
    A ``sync``-mode broadcast response carries no result yet and yields ``[]``;
    wait for inclusion first.

    :returns: A :class:`CrossVmCallResult` per cross-VM call, in message order.
    """
    from cosmpy.protos.cosmos.base.abci.v1beta1.abci_pb2 import TxMsgData

    from .proto.qorechain.crossvm.v1 import tx_pb2 as crossvm_tx

    data_hex = _result_data_hex(response)
    if not data_hex:
        return []
    try:
        raw = bytes.fromhex(data_hex)
    except ValueError as exc:
        raise ValueError("tx result data is not hex-encoded TxMsgData") from exc
    tx_msg_data = TxMsgData()
    tx_msg_data.ParseFromString(raw)

    results: list[CrossVmCallResult] = []
    for any_msg in tx_msg_data.msg_responses:
        if any_msg.type_url != CROSS_VM_CALL_RESPONSE_TYPE_URL:
            continue
        decoded = crossvm_tx.MsgCrossVMCallResponse()
        decoded.ParseFromString(any_msg.value)
        results.append(
            CrossVmCallResult(
                message_id=decoded.message_id,
                executed=decoded.executed,
                data=bytes(decoded.data),
                gas_used=decoded.gas_used,
            )
        )
    return results


def decode_cross_vm_response(response: Any) -> CrossVmCallResult | None:
    """Decode the FIRST ``MsgCrossVMCallResponse`` in a tx result, if any.

    The single-call companion to :func:`decode_cross_vm_responses`; returns
    ``None`` when the result carries no cross-VM response.
    """
    results = decode_cross_vm_responses(response)
    return results[0] if results else None


class CrossVmClient:
    """Ergonomic build/sign/broadcast client for ``x/crossvm`` cross-VM calls.

    Bind it to a signing :class:`~qorsdk.accounts.Secp256k1Account` plus the tx
    context (chain id, account number, REST url, default fee). The account's
    address is used as the message ``sender``, so callers never repeat it.

    Provide a ``pqc_keypair`` to sign hybrid (classical + ML-DSA-87) transactions; otherwise
    a classical secp256k1 tx is built. ``sign_bytes_version`` (``"auto"`` |
    ``"v1"`` | ``"v2"``, default ``"auto"``) picks the hybrid sign-bytes form;
    ``"auto"`` asks ``rest_url`` and retries once on a ``pqc`` code 21 refusal.
    ``fee`` is a fixed ``StdFee`` dict or ``"auto"``: with ``"auto"`` each
    transaction is simulated first and its gas sized by
    :func:`~qorsdk.gas.estimate_gas` (at least 1.3x the simulated gas for a
    cross-VM call), priced at ``gas_price``. Prefer ``"auto"``: a fixed gas
    limit runs out when a contract code is first loaded in a block.
    Pass a ``query`` (a
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
        fee: FeeDict | Literal["auto"],
        sequence: int = 0,
        pqc_keypair: PqcKeypair | None = None,
        query: Any | None = None,
        qor: Any | None = None,
        sign_bytes_version: str = "auto",
        gas_price: GasPrice | str = DEFAULT_GAS_PRICE,
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
        self._sign_bytes_version = sign_bytes_version
        self._gas_price = gas_price

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
        async_: bool = False,
        async_gas_limit: int | None = None,
        async_max_factor: int | None = None,
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
            async_=async_,
            async_gas_limit=async_gas_limit,
            async_max_factor=async_max_factor,
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
            async_=opts.async_,
            async_gas_limit=opts.async_gas_limit,
            async_max_factor=opts.async_max_factor,
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
            keypair = self._pqc_keypair

            def build_with(version: SignBytesVersion, fee: FeeDict) -> Any:
                return build_hybrid_tx(
                    account=self._account,
                    pqc_keypair=keypair,
                    messages=messages,
                    fee=fee,
                    chain_id=self._chain_id,
                    account_number=self._account_number,
                    sequence=seq,
                    memo=memo,
                    sign_bytes_version=version,
                )

            def build(version: SignBytesVersion) -> Any:
                if self._fee == "auto":
                    probe = build_with(version, _SIMULATION_FEE)
                    return build_with(
                        version, auto_fee(self._rest_url, probe, gas_price=self._gas_price)
                    )
                return build_with(version, self._fee)

            return hybrid_sign_and_broadcast(
                build,
                chain_id=self._chain_id,
                rest_url=self._rest_url,
                sign_bytes_version=self._sign_bytes_version,
                mode=mode,  # type: ignore[arg-type]
            )
        else:

            def classical(fee: FeeDict) -> Any:
                return send_messages(
                    account=self._account,
                    messages=messages,
                    chain_id=self._chain_id,
                    account_number=self._account_number,
                    sequence=seq,
                    fee=fee,
                    memo=memo,
                )

            if self._fee == "auto":
                probe = classical(_SIMULATION_FEE)
                built = classical(auto_fee(self._rest_url, probe, gas_price=self._gas_price))
            else:
                built = classical(self._fee)
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
        async_: bool = False,
        async_gas_limit: int | None = None,
        async_max_factor: int | None = None,
        sequence: int | None = None,
        memo: str = "",
        mode: str = "sync",
    ) -> Any:
        """Build, sign, and broadcast a single ``MsgCrossVMCall``.

        Returns the decoded broadcast response. See the module docstring for how
        ``payload`` / ``cosmwasm`` / ``svm`` select the payload bytes. Set
        ``async_=True`` to queue the call instead of executing it now.

        Pass the result (or the :class:`~qorsdk.track.IncludedTx` from
        :func:`~qorsdk.track.wait_for_tx`) to
        :func:`decode_cross_vm_response` for the ``message_id`` / ``executed`` /
        ``data`` / ``gas_used`` the chain returned.
        """
        message = self.build_call(
            target_vm=target_vm,
            target_contract=target_contract,
            source_vm=source_vm,
            funds=funds,
            payload=payload,
            cosmwasm=cosmwasm,
            svm=svm,
            async_=async_,
            async_gas_limit=async_gas_limit,
            async_max_factor=async_max_factor,
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
        fail together. Returns the decoded broadcast response;
        :func:`decode_cross_vm_responses` turns the committed result into one
        :class:`CrossVmCallResult` per call, in message order.

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
            "get_message requires a query client or a qor client - pass query=… "
            "or qor=… to CrossVmClient"
        )


def create_cross_vm_client(
    *,
    account: Secp256k1Account,
    chain_id: str,
    account_number: int,
    rest_url: str,
    fee: FeeDict | Literal["auto"],
    sequence: int = 0,
    pqc_keypair: PqcKeypair | None = None,
    query: Any | None = None,
    qor: Any | None = None,
    sign_bytes_version: str = "auto",
    gas_price: GasPrice | str = DEFAULT_GAS_PRICE,
) -> CrossVmClient:
    """Create a :class:`CrossVmClient` bound to a signing account and tx context.

    Pass ``fee="auto"`` to size every transaction by simulation."""
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
        sign_bytes_version=sign_bytes_version,
        gas_price=gas_price,
    )


__all__ = [
    "VM_TYPES",
    "CROSS_VM_CALL_RESPONSE_TYPE_URL",
    "ASYNC_GAS_LIMIT_MIN",
    "ASYNC_GAS_LIMIT_MAX",
    "MAX_PENDING_PER_SENDER",
    "validate_async_options",
    "VmType",
    "CrossVmCallOptions",
    "CrossVmCallResult",
    "CrossVmClient",
    "build_cross_vm_call",
    "create_cross_vm_client",
    "decode_cross_vm_response",
    "decode_cross_vm_responses",
]
