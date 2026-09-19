# qorechain (Python SDK)

A typed Python SDK for QoreChain — typed messages for every module, typed query
clients, auto-gas, tx tracking, error decoding, block/tx search, websocket
subscriptions, network presets, denom/address utilities, HD account derivation
(native / EVM / SVM), post-quantum (ML-DSA-87) signing, and read clients (REST +
`qor_` JSON-RPC). It mirrors the QoreChain TypeScript SDK surface with idiomatic
Python.

## Install

```bash
pip install qorechain-sdk
```

Python 3.10+ is required. The package ships type hints and a `py.typed` marker.

## Quickstart

### Connect a client

```python
from qorsdk import create_client

# Defaults to the testnet preset (localhost endpoints).
client = create_client()
print(client.network.chain_id)  # "qorechain-diana"

# Read account balances over REST.
balances = client.rest.get_all_balances("qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu")

# Call the qor_ JSON-RPC namespace.
stats = client.qor.get_ai_stats()

# Estimate a fee (AI oracle with a deterministic static fallback).
fee = client.fees.estimate("fast")

client.close()
```

Mainnet (chain id `qorechain-vladi`) is live; select it and override the
localhost defaults with your node URLs:

```python
client = create_client(
    network="mainnet",
    endpoints={
        "rest": "https://api.qore.host",
        "evm_rpc": "https://evm.qore.host",
    },
)
print(client.network.chain_id)  # "qorechain-vladi"
```

### Derive accounts

```python
from qorsdk import (
    generate_mnemonic,
    derive_native_account,
    derive_evm_account,
    derive_svm_account,
)

mnemonic = generate_mnemonic()  # 12 words; use generate_mnemonic(256) for 24

native = derive_native_account(mnemonic, 0)  # qor1...
evm = derive_evm_account(mnemonic, 0)        # 0x... (EIP-55 checksummed)
svm = derive_svm_account(mnemonic, 0)        # base58 ed25519 pubkey

print(native.address, evm.address, svm.address)
```

Derivation schemes:

| Type   | Curve     | Path                  | Address |
| ------ | --------- | --------------------- | ------- |
| native | secp256k1 | `m/44'/118'/0'/0/{i}` | bech32 `qor` of `ripemd160(sha256(pubkey))` |
| evm    | secp256k1 | `m/44'/60'/0'/0/{i}`  | `0x` + `keccak256(pubkey)[-20:]`, EIP-55 |
| svm    | ed25519   | `m/44'/501'/{i}'/0'`  | base58 of the 32-byte public key |

The mnemonic is validated (words **and** checksum) before any key is derived, so
a typo'd phrase raises rather than silently producing a wrong account.

### Denomination math

```python
from qorsdk import to_base, from_base

to_base("1.5")        # "1500000"  (QOR -> uqor, exponent 6)
from_base("1500000")  # "1.5"
```

All conversions use integer arithmetic — never floats — so they are exact.

### Post-quantum signing (ML-DSA-87 / Dilithium-5)

```python
from qorsdk import (
    generate_pqc_keypair,
    pqc_sign,
    pqc_verify,
    build_hybrid_signature_extension,
    ALGORITHM_DILITHIUM5,
)

kp = generate_pqc_keypair()           # public 2592 B, secret 4896 B
sig = pqc_sign(kp.secret_key, b"msg") # signature 4627 B
assert pqc_verify(kp.public_key, b"msg", sig)

# Build the on-chain hybrid-signature extension (protobuf-encoded into Any.value).
ext = build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, sig, kp.public_key)
```

Sizes are **strict**: `pqc_verify` returns `False` for any signature that is not
exactly 4627 bytes or any public key that is not exactly 2592 bytes (a truncated
signature and one with an extra trailing byte are both rejected), and `pqc_sign`
raises on a secret key that is not exactly 4896 bytes. The SDK checks this itself
rather than trusting the library underneath, so QoreChain's bindings cannot
disagree about whether an over-long signature is valid.

### Async clients

```python
import asyncio
from qorsdk import AsyncRestClient, AsyncQorClient

async def main():
    async with AsyncRestClient("http://localhost:1317") as rest:
        await rest.get_ai_stats()
    async with AsyncQorClient("http://localhost:8545") as qor:
        await qor.get_tokenomics_overview()

asyncio.run(main())
```

### Typed messages for every module

`msg.<module>.<name>(...)` builds any of the chain's 59 custom messages (across
amm / bridge / rdk / multilayer / pqc / svm / lightnode / license /
abstractaccount / crossvm / rlconsensus) plus the standard Native modules
(bank / staking / distribution / gov / authz / feegrant / ibc). Each returns a
`Msg` (`{type_url, value}`) you pass to `send_messages` or the hybrid PQC path.

```python
from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin
from qorsdk import msg, send_messages, build_hybrid_tx, generate_pqc_keypair

swap = msg.amm.swap_exact_in(
    sender=native.address,
    pool_id=1,
    token_in=Coin(denom="uqor", amount="1000000"),
    denom_out="uusdc",
    min_out="990000",
)
delegate = msg.staking.delegate(delegator_address=native.address, validator_address="qorvaloper1...")

# Classical tx carrying any messages.
built = send_messages(
    account=native, messages=[swap, delegate],
    chain_id="qorechain-diana", account_number=0, sequence=0,
    fee={"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"},
)

# Or a quantum-safe hybrid (classical + ML-DSA-87) tx over the same messages.
# The testnet verifies the v2 sign-bytes form (see "Hybrid sign-bytes v1 / v2").
hybrid = build_hybrid_tx(
    account=native, pqc_keypair=generate_pqc_keypair(), messages=[swap],
    fee={"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"},
    chain_id="qorechain-diana", account_number=0, sequence=0,
    sign_bytes_version="v2",
)
```

The `qorechain_registry()` type-URL → proto map and `decode_any(type_url, value)`
let you parse any supported message back into a typed object.

### Typed query clients (gRPC)

Modules with a `Query` service (crossvm, lightnode, pqc, qca, reputation,
rlconsensus, svm) expose typed callers over a gRPC channel. Chain v3.1.83 adds
`amm`, `license`, and `abstractaccount` typed query clients, the `multilayer`
`anchor` / `anchors` state-anchor queries, and abstractaccount
`register_authenticator` / `revoke_authenticator` message composers:

```python
from qorsdk import connect_query_clients

with connect_query_clients("localhost:9090") as q:
    res = q.crossvm.message("msg-123")     # -> QueryMessageResponse
    node = q.lightnode.light_node(native.address)
    acct = q.pqc.account(native.address)
```

### Sidechains, paychains & rollups (v0.4.0)

The multilayer (sidechains/paychains) and `rdk` (rollup) modules are covered by
typed message composers and typed query clients. Compose a write with
`msg.multilayer.*` / `msg.rdk.*` and broadcast it like any other message; read
layer and rollup state through the typed gRPC clients.

```python
from qorsdk import msg, send_messages, connect_query_clients

# Multilayer: register a sidechain / paychain, anchor state, route a tx.
register = msg.multilayer.register_sidechain(
    creator=native.address, layer_id="game-l2", description="game sidechain",
)
route = msg.multilayer.route_transaction(
    sender=native.address, transaction_payload=b"...", preferred_layer="game-l2",
)

# Rollups (rdk): create a rollup, submit a batch, execute a withdrawal.
create = msg.rdk.create_rollup(
    creator=native.address, rollup_id="r1", profile="default", vm_type="evm",
)
withdraw = msg.rdk.execute_withdrawal(
    submitter=native.address, rollup_id="r1", batch_index=0, withdrawal_index=0,
    recipient="qor1rcpt", denom="uqor", amount=100, proof=[b"\x01"],
)

# Typed reads over gRPC (multilayer / rdk / bridge / crossvm query services).
with connect_query_clients("localhost:9090") as q:
    layer = q.multilayer.layer("game-l2")
    layers = q.multilayer.layers()
    stats = q.multilayer.routing_stats()
    rollup = q.rdk.rollup("r1")
    batch = q.rdk.latest_batch("r1")
```

See the [multilayer](../../docs/docs/guides/multilayer.md) and
[rollups](../../docs/docs/guides/rollups.md) guides.

### AI pre-flight risk scoring (v0.5.0)

QoreChain exposes an on-chain AI risk/anomaly model over two EVM precompiles, so
you can get an advisory verdict on a transaction before broadcasting it. The
helpers in `qorsdk.precompiles` issue plain `eth_call`s through any
`eth_call`-capable client (e.g. a [web3.py](https://web3py.readthedocs.io) provider
pointed at the network's `evm_rpc`).

```python
from qorsdk import (
    simulate_with_risk_score, ai_risk_score, ai_anomaly_check,
    PRECOMPILE_AI_RISK_SCORE,     # 0x…0B01
    PRECOMPILE_AI_ANOMALY_CHECK,  # 0x…0B02
)

# Combined gas + risk + anomaly pre-flight.
verdict = simulate_with_risk_score(eth_client, {
    "from": "0xSender", "to": "0xContract", "data": "0x…", "value": 0,
})
if not verdict["safe"]:
    raise RuntimeError("AI pre-flight flagged this transaction")

# Or call the precompiles individually.
risk = ai_risk_score(eth_client, b"\xde\xad\xbe\xef")  # {"score", "level"}
anomaly = ai_anomaly_check(eth_client, "0xSender", 1_000_000)  # {"anomaly_score", "flagged"}
```

See the [AI pre-flight](../../docs/docs/guides/ai-preflight.md) guide.

### Unified cross-VM calls (v0.5.0)

`CrossVmClient` wraps `MsgCrossVMCall` so you can route a single call — or
several atomically in **one** transaction — across the EVM, CosmWasm, and SVM
VMs (`VM_TYPES`). The payload is raw bytes (`payload=`), a CosmWasm JSON message
(`cosmwasm=` is `json.dumps`'d to UTF-8), or SVM bytes (`svm=`).

```python
from qorsdk import (
    CrossVmCallOptions, create_cross_vm_client, build_cross_vm_call,
    decode_cross_vm_response, decode_cross_vm_responses,
)

xvm = create_cross_vm_client(account=native, ...)  # see docstring for context args

# Single call into a CosmWasm contract.
res = xvm.call(target_vm="cosmwasm", target_contract="qor1contract…",
               cosmwasm={"increment": {}})

# Atomic triple-VM batch in ONE tx.
atomic = xvm.call_atomic([
    CrossVmCallOptions(target_vm="evm", target_contract="0xC…", payload=abi_calldata),
    CrossVmCallOptions(target_vm="svm", target_contract="Prog…", svm=raw_bytes),
    CrossVmCallOptions(target_vm="cosmwasm", target_contract="qor1…",
                       cosmwasm={"stake": {}}),
])

status = xvm.get_message("42")  # read a routed message's status
```

**The callee's answer (chain v3.1.97).** A call executes inside the transaction
and returns its result; `decode_cross_vm_response` (or `…_responses`, one per
call, in message order) reads the `MsgCrossVMCallResponse` out of the committed
tx and gives you `message_id`, `executed`, `data` (the callee's return value) and
`gas_used`. Pass `async_=True` to queue the call for a later `MsgProcessQueue`
dispatch instead — a queued call comes back `executed=False` with no `data` yet.

```python
included = wait_for_tx(client.rest, res["tx_response"]["txhash"])
answer = decode_cross_vm_response(included)
answer.message_id, answer.executed, answer.data, answer.gas_used
```

`source_vm` is **ignored by the chain**, which derives the origin lane from the
execution context; it is still accepted (and sent, default `"evm"`) so older
nodes keep taking the message, but setting it has no on-chain effect.

`build_cross_vm_call(...)` is also available as a free function for hand-building
the message. See the [cross-VM](../../docs/docs/guides/cross-vm.md) guide.

### Quantum-safe DX (v0.5.0)

QoreChain enforces hybrid post-quantum signatures (ML-DSA-87 + secp256k1) by
default. `qorsdk.pqc_dx` makes a dApp PQC-protected in one idempotent call.

```python
from qorsdk import (
    is_pqc_registered, get_pqc_status,
    ensure_pqc_registered, migrate_to_hybrid, migrate_pqc_key,
    generate_pqc_keypair,
)

# Read-only status (over the qor_ namespace).
registered = is_pqc_registered(client.qor, native.address)
status = get_pqc_status(client.qor, native.address)

# Idempotent: registers the signer's Dilithium key only if it isn't already.
result = ensure_pqc_registered(account=native, pqc_keypair=generate_pqc_keypair(), ...)

# Migrate a classical account to hybrid signing, then sign hybrid.
path = migrate_to_hybrid(account=native, pqc_keypair=generate_pqc_keypair(), ...)

# Rotate an account's on-chain PQC key (MsgMigratePQCKey).
migrate_pqc_key(account=native, ...)
```

Async status reads are available as `is_pqc_registered_async` /
`get_pqc_status_async`. See the
[quantum-safe](../../docs/docs/guides/quantum-safe.md) guide.

### Hybrid sign-bytes v1 / v2 (v0.8.0 / chain v3.1.98)

A hybrid transaction's ML-DSA-87 signature covers `B0` (the `TxBody` without the
PQC extension) and `A` (the `AuthInfo` bytes). Chain release **v3.1.98** changed
the exact bytes that are signed:

| Form | Signed bytes |
|---|---|
| v1 | `BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A` |
| v2 | `"qorechain-pqc-hybrid-v2" ‖ BE64(len chainID) ‖ chainID ‖ BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A` |

v2 adds a domain tag (a signature made in any other context can never pass as a
tx signature) and binds the chain-id (the post-quantum signature itself refuses
to verify on another network). Each network verifies **exactly one** form at any
height, with no overlap window, so the SDK must sign the form of the *target*
network:

- **Testnet** (`qorechain-diana`) applied v3.1.98 at height 5,746,000 and now
  accepts **only v2**.
- **Mainnet** (`qorechain-vladi`) stays on **v1** until its own v3.1.98 upgrade,
  at a height chosen by governance. Nothing changes for mainnet until then.
- Any chain started on v3.1.98 or later is v2 from its first block.

The `"auto"` rule (the chain's own `SignBytesVersionFor`): ask the node
`GET {rest}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98`. If the height is above
0 → v2; else if the chain is `qorechain-vladi` / `qorechain-diana` → v1; else → v2.
The answer is cached per `(rest_url, chain_id)` for 60 s (a network can upgrade
while an app is running). If the node cannot be asked for one of those two
networks, the SDK raises `SignBytesVersionError` instead of guessing.

```python
from qorsdk import (
    build_hybrid_tx, hybrid_sign_and_broadcast, resolve_sign_bytes_version,
    SignBytesResolver, clear_sign_bytes_cache,
)

# 1. Resolve explicitly, then build (the builders are pure: no network).
version = resolve_sign_bytes_version("qorechain-diana", rest_url="https://api-testnet.qore.host")
built = build_hybrid_tx(..., chain_id="qorechain-diana", sign_bytes_version=version)
built.sign_bytes_version  # "v2"

# 2. Or let the SDK resolve, broadcast, and recover from a stale answer: on a
#    `pqc` code 21 refusal ("hybrid PQC signature verification failed") it
#    re-resolves ONCE, re-signs ONCE, and broadcasts ONCE more.
resp = hybrid_sign_and_broadcast(
    lambda v: build_hybrid_tx(..., chain_id="qorechain-diana", sign_bytes_version=v),
    chain_id="qorechain-diana",
    rest_url="https://api-testnet.qore.host",
    sign_bytes_version="auto",   # or "v1" / "v2" to override (no lookup, no retry)
)

# Cache control.
resolve_sign_bytes_version("qorechain-vladi", rest_url=..., force_refresh=True)
clear_sign_bytes_cache()
resolver = SignBytesResolver(ttl=15)  # a private resolver with its own TTL
```

`build_hybrid_tx` and `sign_hybrid_eth` take `sign_bytes_version="v1" | "v2"`.
When it is omitted they use v2 for a chain started on v3.1.98+, and **raise** for
`qorechain-vladi` / `qorechain-diana` (never a silent v1 default). The high-level
paths (`migrate_to_hybrid`, `migrate_pqc_key`, `CrossVmClient` /
`create_cross_vm_client`) take `sign_bytes_version="auto" | "v1" | "v2"` (default
`"auto"`) and use `hybrid_sign_and_broadcast` internally.

The same release changed the **PQC key-migration** and **bridge-attestation**
payloads. Builders for both forms are provided and reproduce the chain's
known-answer vectors byte-for-byte:

- `migration_sign_bytes(version, chain_id, account, from_algorithm_id,
  to_algorithm_id, execution_height, old_public_key, new_public_key)`: v1 is
  the ASCII
  `qorechain-key-migration:chain=…:from=…:to=…:account=…:height=…`; v2 is
  `"qorechain-key-migration-v2"` followed by length-prefixed fields and both
  public keys.
- `bridge_attestation_sign_bytes(version, chain_id, chain, event_type,
  operation_id, tx_hash, amount, asset)`: v1 is the pipe-joined fields with no
  chain-id; v2 is `"qorechain-bridge-attestation-v2"` then `BE64(len f) ‖ f` for
  chain-id and each field.

`is_hybrid_signature_rejection(resp_or_error)` detects the `pqc` code-21 refusal
(code 21 from any other codespace, such as `sdk` "tx too large", does not match).

### Unified eth-native wallet (v0.6.0)

One `eth_secp256k1` key = ONE 20-byte identity rendered three ways — `qor1…`
(bech32), `0x…` (EIP-55), and SVM base58 (the 20 bytes right-padded with 12 zero
bytes to 32). A deposit to any of the three lands in the **same** balance, and the
key spends on **all** lanes. `derive_unified_account` uses the Ethereum HD path
(`m/44'/60'/0'/0/{index}`); `unified_account_from_seed` builds one directly from a
32-byte secret. `addresses_from_20` / `qore_addresses` convert between the three
encodings. The legacy coin-type-118 `derive_native_account` still works (additive).

Native-lane signing over the eth key: `sign_classical_eth` is a classical
secp256k1 signature over `keccak256(SignDoc)` with pubkey type
`/cosmos.evm.crypto.v1.ethsecp256k1.PubKey`; `sign_hybrid_eth` adds the ML-DSA-87
post-quantum signature. Account parsing accepts eth_secp256k1 public keys.

```python
from qorsdk import (
    derive_unified_account, unified_account_from_seed,
    sign_hybrid_eth, resolve_sign_bytes_version,
)

account = derive_unified_account(mnemonic)
account.cosmos  # "qor1…"    — QoreChain Native lane
account.evm     # "0x…"      — EIP-55 checksummed
account.svm     # "<base58>" — 20 bytes + 12 zero pad

# Sign a QoreChain Native tx from the unified eth key (hybrid PQC path).
built = sign_hybrid_eth(
    account=account,
    chain_id="qorechain-vladi",
    account_number=account_number,
    messages=[msg.cosmos.send(...)],
    fee=fee,
    sequence=sequence,
    sign_bytes_version=resolve_sign_bytes_version(
        "qorechain-vladi", rest_url="https://api.qore.host"
    ),
)

# A unified account's seed MUST be real secret entropy.
import secrets
fresh = unified_account_from_seed(secrets.token_bytes(32))
```

`unified_account_from_seed` uses its seed verbatim as the spend key, so the seed
must be a CSPRNG draw or key material the user already keeps secret. Never derive
it from a wallet signature or any other value a third party can ask the wallet
(or the user) to produce — such a value is a bearer secret handed out on request.
Deriving an account from a wallet signature was removed in **v0.8.0**
(`unified_account_from_phantom_signature` now raises); to spend from an existing
external key, register it with `MsgRegisterAuthenticator` and use the
authenticator lanes (`MsgExecuteCosmos` / `MsgExecuteEVM`) below. Any account
previously derived from a signature must be treated as exposed — move its funds.

See the [unified-wallet](../../docs/docs/guides/unified-wallet.md) guide.

### Auto-gas, errors, tracking, search

```python
from qorsdk import (
    auto_fee, GasPrice, calculate_fee,        # gas
    decode_tx_error, QoreTxError,             # errors
    wait_for_tx, broadcast_and_wait, with_retry,  # tracking
    get_tx, get_block, search_txs, build_events_query,  # search
)

# Simulate -> gas_used x 1.4 x 0.15uqor.
fee = auto_fee("http://localhost:1317", built)
calculate_fee(200000, GasPrice.from_string("0.15uqor"))

# Wait for inclusion; raises a typed QoreTxError on a non-zero code.
included = wait_for_tx(client.rest, "TXHASH")

search_txs(client.rest, {"message.sender": native.address}, limit=20, order_by="desc")
```

### Websocket subscriptions

```python
from qorsdk import SubscriptionClient

async def run():
    sub = await SubscriptionClient.connect("http://localhost:26657")
    async def on_block(ev): print("block", ev)
    unsubscribe = await sub.subscribe_new_blocks(on_block)
    await sub.subscribe_tx({"message.sender": native.address}, lambda ev: ...)
    # ... later ...
    await unsubscribe()
    await sub.close()
```

### Utilities

```python
from qorsdk import (
    sha256_hex, keccak256_hex, ripemd160_hex,
    parse_units, format_units,
    is_valid_evm_address, is_valid_svm_address, to_checksum_address,
)

parse_units("1.5", 18)                 # 1500000000000000000
format_units(1500000000000000000, 18)  # "1.5"
to_checksum_address("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed")
```

### Authenticator lanes (v0.7.0 / chain v3.1.85)

A linked external key — a Phantom **ed25519** key, or a MetaMask **secp256k1**
key bound **by address** — spends from the ONE canonical PQC account through a
**relayer** that submits the tx and pays the fee (its own hybrid-PQC signature
satisfies the ante). The external key **never produces an ML-DSA co-signature**;
its signature over the domain-separated, replay-bound sign-bytes **is** the
authorization, under least-privilege, spending-limit and revocable terms
enforced on-chain.

Three messages carry the lanes, each with a composer:

- `MsgExecuteEVM` (`/qorechain.abstractaccount.v1.MsgExecuteEVM`) —
  `msg.abstractaccount.execute_evm`
- `MsgExecuteCosmos` (`/qorechain.abstractaccount.v1.MsgExecuteCosmos`) —
  `msg.abstractaccount.execute_cosmos`
- `MsgRotatePQCKey` (`/qorechain.pqc.v1.MsgRotatePQCKey`) —
  `msg.pqc.rotate_pqc_key`

The `execute_evm_msg` / `execute_cosmos_msg` / `rotate_pqc_key_msg` builders
compose these from primitives. **Sign-bytes helpers** rebuild the exact digest
the chain re-derives: `evm_auth_sign_bytes` / `cosmos_auth_sign_bytes` (32-byte
SHA-256 digests) and `rotation_sign_bytes` (the domain-separated string both
keys sign).

**NONCE semantics:**

- `MsgExecuteEVM.nonce` = the account's **current EVM nonce** (the relayer is a
  different account than the owner, so its envelope does **not** bump the
  account's nonce — pass it as-is, do **not** `+1`).
- `MsgExecuteCosmos.nonce` = the **per-authenticator sequence** for
  `(account, pubkey)`, a store counter distinct from the account's own sequence.

**Permission taxonomy & errors.** Fetch the on-chain permission schema with the
gRPC query client's `permission_schema()` (REST equivalent
`GET /qorechain/abstractaccount/v1/permission_schema`) and compare an action to
it before submitting. `decode_tx_error` surfaces the lane failures — codespace
`abstractaccount`: `5` SpendingLimitExceeded, `6` SessionKeyExpired, `10`
PermissionDenied, `11` AuthenticatorReplay; codespace `pqc`: `21`
HybridVerifyFailed.

**Key rotation.** `rotate_pqc_key_msg_from_mnemonic` migrates a legacy
`shake256(mnemonic)` key to the canonical, address-bound key (dual-signs over
`rotation_sign_bytes`); `derive_pqc_legacy` re-derives the old key for the
old-key half.

```python
from qorsdk import (
    evm_auth_sign_bytes, execute_evm_msg,
    rotate_pqc_key_msg_from_mnemonic,
)

# Phantom ed25519 authenticator authorizes an EVM spend from the canonical
# account; the relayer broadcasts and pays. nonce = the account's CURRENT EVM
# nonce (relayer != owner -> no +1).
digest = evm_auth_sign_bytes(
    chain_id="qorechain-diana",
    account="qor1canonical…",
    pubkey=phantom_pubkey,           # 32-byte ed25519 key
    to="0xRecipient…",
    value="1000000000000000000",     # 1 QOR in aqor (wei)
    nonce=current_evm_nonce,
)
signature = phantom_sign(digest)     # your wallet signs the raw 32 bytes
exec_msg = execute_evm_msg(
    relayer="qor1relayer…", account="qor1canonical…", scheme="ed25519",
    pubkey=phantom_pubkey, signature=signature,
    to="0xRecipient…", value="1000000000000000000", nonce=current_evm_nonce,
)

# Migrate a legacy shake256(mnemonic) key to the address-bound key.
build = rotate_pqc_key_msg_from_mnemonic(
    account="qor1canonical…", mnemonic=mnemonic, chain_id="qorechain-diana",
)
```

See the [authenticators](../../docs/docs/guides/authenticators.md) guide.

## Regenerating protobuf code (maintainers)

The generated protobuf modules under `src/qorechain/proto/` are committed, so
users never run `protoc`. To regenerate after a proto change (requires `buf`):

```bash
bash scripts/codegen-py.sh
```

It runs `buf generate` (public-registry `protocolbuffers/python` + `pyi`
plugins, pinned to the protobuf 5.29.x line), rewrites dependency imports to
`cosmpy`'s bundled protos so the gencode shares one descriptor pool, and writes
package `__init__.py` files.

## Out of scope (use a dedicated library)

Browser-wallet adapters (Keplr / MetaMask / Phantom) and viem / `@solana/web3.js`
-style EVM/SVM clients are intentionally **not** part of this SDK — they are
JS/browser-specific. In Python, talk to the EVM with [web3.py](https://web3py.readthedocs.io)
and to the SVM with [solana-py](https://michaelhly.github.io/solana-py/), pointing
them at the network's `evm_rpc` / `svm_rpc` endpoints. This SDK covers the native
Native chain surface end to end.

## Development

```bash
python -m venv .venv
.venv/bin/pip install -e "packages/py[dev]"
.venv/bin/pytest packages/py
.venv/bin/mypy packages/py/src
.venv/bin/ruff check packages/py/src packages/py/tests
```

## License

Apache-2.0
