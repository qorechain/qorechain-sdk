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
from qorechain import create_client

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
        "rest": "https://rest.qore.network",
        "evm_rpc": "https://evm.qore.network",
    },
)
print(client.network.chain_id)  # "qorechain-vladi"
```

### Derive accounts

```python
from qorechain import (
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
from qorechain import to_base, from_base

to_base("1.5")        # "1500000"  (QOR -> uqor, exponent 6)
from_base("1500000")  # "1.5"
```

All conversions use integer arithmetic — never floats — so they are exact.

### Post-quantum signing (ML-DSA-87 / Dilithium-5)

```python
from qorechain import (
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
from qorechain import AsyncRestClient, AsyncQorClient

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
from qorechain import msg, send_messages, build_hybrid_tx, generate_pqc_keypair

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
from qorechain import connect_query_clients

with connect_query_clients("localhost:9090") as q:
    res = q.crossvm.message("msg-123")     # -> QueryMessageResponse
    node = q.lightnode.light_node(native.address)
    acct = q.pqc.account(native.address)
```

### Auto-gas, errors, tracking, search

```python
from qorechain import (
    auto_fee, GasPrice, calculate_fee,        # gas
    decode_tx_error, QoreTxError,             # errors
    wait_for_tx, broadcast_and_wait, with_retry,  # tracking
    get_tx, get_block, search_txs, build_events_query,  # search
)

# Simulate -> gas_used x 1.4 x 0.025uqor.
fee = auto_fee("http://localhost:1317", built)
calculate_fee(200000, GasPrice.from_string("0.025uqor"))

# Wait for inclusion; raises a typed QoreTxError on a non-zero code.
included = wait_for_tx(client.rest, "TXHASH")

search_txs(client.rest, {"message.sender": native.address}, limit=20, order_by="desc")
```

### Websocket subscriptions

```python
from qorechain import SubscriptionClient

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
from qorechain import (
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
