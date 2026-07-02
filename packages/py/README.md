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

# Build the on-chain hybrid-signature extension (base64-encoded, Go-JSON shape).
ext = build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, sig, kp.public_key)
```

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

`msg.<module>.<name>(...)` builds any of the chain's 49 custom messages (across
amm / bridge / rdk / multilayer / pqc / svm / lightnode / license /
abstractaccount / crossvm / rlconsensus) plus the standard Cosmos modules
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
hybrid = build_hybrid_tx(
    account=native, pqc_keypair=generate_pqc_keypair(), messages=[swap],
    fee={"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"},
    chain_id="qorechain-diana", account_number=0, sequence=0,
)
```

The `qorechain_registry()` type-URL → proto map and `decode_any(type_url, value)`
let you parse any supported message back into a typed object.

### Typed query clients (gRPC)

Modules with a `Query` service (crossvm, lightnode, pqc, qca, reputation,
rlconsensus, svm) expose typed callers over a gRPC channel:

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
from qorsdk import create_cross_vm_client, build_cross_vm_call

xvm = create_cross_vm_client(account=native, ...)  # see docstring for context args

# Single call into a CosmWasm contract.
res = xvm.call(target_vm="cosmwasm", target_contract="qor1contract…",
               cosmwasm={"increment": {}})

# Atomic triple-VM batch in ONE tx.
atomic = xvm.call_atomic([
    xvm.build_call(target_vm="evm", target_contract="0xC…", payload=abi_calldata),
    xvm.build_call(target_vm="svm", target_contract="Prog…", payload=raw_bytes),
    xvm.build_call(target_vm="cosmwasm", target_contract="qor1…", cosmwasm={"stake": {}}),
])

status = xvm.get_message("42")  # read a routed message's status
```

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
(Cosmos-SDK) chain surface end to end.

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
