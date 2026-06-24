# qorechain (Python SDK)

A typed Python SDK for QoreChain — network presets, denom/address utilities,
HD account derivation (native / EVM / SVM), post-quantum (ML-DSA-87) signing
primitives, and read clients (REST + `qor_` JSON-RPC). It mirrors the QoreChain
TypeScript SDK surface with idiomatic Python.

## Install

```bash
pip install qorechain
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
