"""Structured decoding of failed QoreChain Native transaction results.

When a transaction fails, the node returns an ABCI result with a non-zero
``code``, a ``codespace`` naming the module that rejected it, and a ``raw_log``
string. The numeric ``code`` is only meaningful *within* its codespace — code
``5`` in the ``sdk`` codespace is "insufficient funds", but code ``5`` in another
module means something else. :func:`decode_tx_error` maps the common ``sdk``
codespace codes to readable messages and falls back to the raw log for
module-specific codespaces (including QoreChain's custom modules).

:class:`QoreTxError` is the typed error raised by the broadcast/track paths on a
non-zero code, carrying the decoded fields so callers can branch on
``codespace``/``code`` rather than parse strings.
"""

from __future__ import annotations

from dataclasses import dataclass

#: The default codespace for results that do not name one.
DEFAULT_CODESPACE = "sdk"

#: Known error codes in the core ``sdk`` codespace, mirroring the canonical
#: QoreChain Native error registry. Only the codes a dApp commonly hits get friendly
#: text; any other ``sdk`` code still decodes (with the raw log) generically.
SDK_CODES: dict[int, tuple[str, str]] = {
    2: ("tx_decode_error", "failed to decode the transaction"),
    3: (
        "invalid_sequence",
        "account sequence mismatch (nonce out of order) — refetch the account and retry",
    ),
    4: ("unauthorized", "unauthorized: signature or signer does not match"),
    5: ("insufficient_funds", "insufficient funds to cover the transfer or fee"),
    6: ("unknown_request", "unknown request"),
    7: ("invalid_address", "invalid address"),
    8: ("invalid_pubkey", "invalid public key"),
    9: ("unknown_address", "unknown address (account does not exist on chain)"),
    10: ("invalid_coins", "invalid coin amount or denomination"),
    11: (
        "out_of_gas",
        'out of gas — raise the gas limit (or use the "auto" fee path with a '
        "higher multiplier)",
    ),
    12: ("memo_too_large", "memo is too large"),
    13: (
        "insufficient_fee",
        "insufficient fee — the offered fee is below the node's minimum gas price",
    ),
    14: ("maximum_signatures_exceeded", "transaction has too many signatures"),
    15: ("no_signatures", "transaction has no signatures"),
    16: ("json_marshal_error", "failed to marshal JSON"),
    17: ("json_unmarshal_error", "failed to unmarshal JSON"),
    18: ("invalid_request", "invalid request"),
    19: ("tx_in_mempool_cache", "transaction already exists in the mempool"),
    20: ("mempool_is_full", "mempool is full — retry later"),
    21: ("tx_too_large", "transaction is too large"),
    25: ("invalid_gas_limit", "invalid gas limit"),
    30: ("tx_timeout_height", "transaction timeout height exceeded"),
}

#: Known error codes in QoreChain custom-module codespaces (v3.1.85). Only the
#: codes a dApp / relayer commonly branches on get friendly text; any other code
#: in these codespaces still decodes generically (with the raw log). The
#: ``abstractaccount`` codes cover the authenticator lanes (EVM + Native); the
#: ``pqc`` code covers hybrid verification.
MODULE_CODES: dict[str, dict[int, tuple[str, str]]] = {
    "abstractaccount": {
        5: (
            "spending_limit_exceeded",
            "authenticator spending limit exceeded — the value/amount is over the "
            "linked key's SpendingRule",
        ),
        6: (
            "session_key_expired",
            "authenticator session key expired — re-register the linked key with a "
            "fresh expiry",
        ),
        10: (
            "permission_denied",
            "authenticator permission denied — the linked key lacks the required "
            "permission for this message",
        ),
        11: (
            "authenticator_replay",
            "authenticator replay — the nonce is not the linked key's current "
            "authenticator sequence (a per-key counter, NOT the account's EVM nonce "
            "or Cosmos sequence); re-sign with the key's next sequence",
        ),
    },
    "pqc": {
        21: (
            "hybrid_verify_failed",
            "hybrid PQC verification failed — the ML-DSA signature did not verify "
            "against the registered key",
        ),
        # v3.2.0 EVM authorisation window. Code 28 covers two states with
        # different remedies (invalid window vs. no registered post-quantum key);
        # qorsdk.evm_window.classify_evm_window_error reads the message text to
        # tell them apart.
        26: (
            "no_evm_window",
            "no open EVM authorisation window — open one with MsgOpenEVMWindow "
            "(msg.pqc.open_evm_window) on the Cosmos lane, THEN read the nonce, "
            "THEN sign the EVM transaction",
        ),
        27: (
            "evm_window_exhausted",
            "EVM authorisation window exhausted — it ran out of blocks, "
            "transactions or value; open a new one with MsgOpenEVMWindow",
        ),
        28: (
            "invalid_evm_window",
            "invalid EVM authorisation window, or the account has no registered "
            "post-quantum key — check the log text to tell the two apart",
        ),
        # v3.2.2 EIP-7702 delegation consent (qorsdk.evm_delegation).
        60: (
            "evm_delegation_no_consent",
            "no post-quantum consent for this EIP-7702 delegation — broadcast "
            "MsgAuthorizeEVMDelegation for exactly this delegate first",
        ),
        61: (
            "evm_delegation_invalid",
            "invalid EIP-7702 delegation request — check the delegate address and "
            "the blocks bound, and that the account has a registered PQC key",
        ),
    },
}

# The per-sender transaction rate limit (both lanes' ante handler) is codespace
# "ai", code 3, with the text "sender <addr> has sent <n> transactions in the
# last 30 blocks, at the configured limit of <limit> per minute". Code 3 also
# carries other AI-engine rejections, so the text decides; a transport that drops
# the codespace (EVM JSON-RPC) is matched on the text alone.


# pqc 8 and pqc 20 cover two different remedies. pqc 8 is always an account
# without a PQC key (classical fallback disabled). pqc 20 is either a keyless
# account (register the key first) or a keyed account that sent no hybrid
# extension (sign hybrid); only the text tells them apart.
_PQC_KEY_REQUIREMENT_MESSAGES = {
    "pqc_key_required": (
        "this account has no registered PQC key — register one (MsgRegisterPQCKeyV2) "
        "before sending"
    ),
    "hybrid_signature_required": (
        "this account has a registered PQC key — sign the transaction with the hybrid "
        "(ML-DSA-87) extension"
    ),
}


def _classify_pqc_key_requirement(
    codespace: str | None, code: int, raw_log: str | None
) -> str | None:
    if codespace != "pqc" or code not in (8, 20):
        return None
    low = (raw_log or "").lower()
    if "has a registered pqc key and must include" in low:
        return "hybrid_signature_required"
    if (
        code == 8
        or "has no registered pqc key" in low
        or "has no pqc key" in low
        or "must include a pqc hybrid signature extension" in low
    ):
        return "pqc_key_required"
    return None


def _is_rate_limit_log(codespace: str | None, code: int, raw_log: str | None) -> bool:
    if not raw_log:
        return False
    low = raw_log.lower()
    if "transactions in the last" not in low or "per minute" not in low:
        return False
    return not codespace or (codespace == "ai" and code == 3)


@dataclass(frozen=True)
class DecodedTxError:
    """A decoded, human-readable transaction error."""

    #: The ABCI result code.
    code: int
    #: The codespace the code belongs to.
    codespace: str
    #: A human-readable summary of what went wrong.
    message: str
    #: A short stable identifier for the error kind (e.g. ``insufficient_funds``).
    kind: str
    #: The original raw log, preserved for debugging.
    raw_log: str | None = None


def decode_tx_error(
    code: int,
    codespace: str | None = None,
    raw_log: str | None = None,
) -> DecodedTxError:
    """Decode a failed transaction result into a structured, readable error.

    For the ``sdk`` codespace, recognized codes get a friendly message;
    unrecognized ``sdk`` codes and all other codespaces (including QoreChain
    module codespaces such as ``pqc``, ``crossvm``, ``bridge``, ``amm``, …) fall
    back to the raw log, which the module itself populates with a descriptive
    reason.

    :param code: The ABCI result code (``0`` is success; non-zero is failure).
    :param codespace: The codespace (module) that produced the code; defaults to
        ``"sdk"``.
    :param raw_log: The raw ABCI log string, used as a fallback message.
    """
    space = codespace or DEFAULT_CODESPACE

    key_requirement = _classify_pqc_key_requirement(codespace, code, raw_log)
    if key_requirement:
        base = _PQC_KEY_REQUIREMENT_MESSAGES[key_requirement]
        return DecodedTxError(
            code=code,
            codespace=space,
            message=f"{base} ({raw_log})" if raw_log else base,
            kind=key_requirement,
            raw_log=raw_log,
        )

    if _is_rate_limit_log(codespace, code, raw_log):
        return DecodedTxError(
            code=code,
            codespace=space,
            message=(
                "the network is limiting this sender's transaction rate — wait and "
                f"retry ({raw_log})"
            ),
            kind="rate_limited",
            raw_log=raw_log,
        )

    if space == DEFAULT_CODESPACE and code in SDK_CODES:
        kind, base_message = SDK_CODES[code]
        message = f"{base_message} ({raw_log})" if raw_log else base_message
        return DecodedTxError(
            code=code, codespace=space, message=message, kind=kind, raw_log=raw_log
        )

    module_codes = MODULE_CODES.get(space)
    if module_codes is not None and code in module_codes:
        kind, base_message = module_codes[code]
        message = f"{base_message} ({raw_log})" if raw_log else base_message
        return DecodedTxError(
            code=code, codespace=space, message=message, kind=kind, raw_log=raw_log
        )

    # Module codespace, or an unmapped sdk code: surface the raw log verbatim.
    detail = raw_log if raw_log else "(no log provided)"
    return DecodedTxError(
        code=code,
        codespace=space,
        kind=f"{space}_{code}",
        message=f'transaction failed in module "{space}" with code {code}: {detail}',
        raw_log=raw_log,
    )


def is_tx_failure(code: int) -> bool:
    """True if the ABCI ``code`` represents a failed transaction (non-zero)."""
    return code != 0


class QoreTxError(Exception):
    """The typed error raised on a non-zero ABCI broadcast/inclusion code.

    Carries the decoded fields so callers can branch on the error kind without
    string-matching.
    """

    def __init__(self, decoded: DecodedTxError, tx_hash: str | None = None) -> None:
        suffix = f" (tx {tx_hash})" if tx_hash else ""
        super().__init__(decoded.message + suffix)
        #: ABCI result code.
        self.code = decoded.code
        #: The codespace (module) that rejected the transaction.
        self.codespace = decoded.codespace
        #: A short stable identifier for the error kind.
        self.kind = decoded.kind
        #: The raw ABCI log, when present.
        self.raw_log = decoded.raw_log
        #: The transaction hash, when known.
        self.tx_hash = tx_hash


def tx_error_from(
    code: int,
    codespace: str | None = None,
    raw_log: str | None = None,
    tx_hash: str | None = None,
) -> QoreTxError:
    """Decode the failed-tx fields and return a ready-to-raise :class:`QoreTxError`."""
    return QoreTxError(decode_tx_error(code, codespace, raw_log), tx_hash)
