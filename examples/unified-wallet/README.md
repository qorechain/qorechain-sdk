# unified-wallet

Derive a **unified eth-native** QoreChain account — one `eth_secp256k1` key
rendered as all three address encodings, sharing one on-chain balance:

- `cosmos` — `qor1…` (bech32, native lane)
- `evm` — `0x…` (EIP-55 hex, spendable on the EVM lane)
- `svm` — `<base58>` (32-byte SVM address = `addr20 ‖ 12 zero bytes`)

The 20 address bytes are the Ethereum derivation `keccak256(pubkey)[12:]`, so the
key is EVM-native and the `qor1`/`svm` forms are just other encodings of the same
bytes. The account also carries a deterministic ML-DSA-87 PQC keypair for the
mainnet hybrid signature.

Runs fully offline (derives + prints; does not broadcast).

```bash
pnpm install
pnpm start
```

The legacy coin-118 native derivation (`deriveNativeAccount`) is still supported
and unchanged; unified accounts are an additional, opt-in identity model.
