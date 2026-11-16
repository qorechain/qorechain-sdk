# send-qor

Derive a native (`qor1...`) account from a mnemonic and broadcast a QOR transfer.

QoreChain requires a hybrid signature (secp256k1 + ML-DSA-87) on every
transaction from an account with a registered PQC key, and an account without
one can only send the registration. The example shows the full path:

1. `deriveNativeAccount(mnemonic)` → a secp256k1 account (incl. private key)
2. `derivePqcCanonical(address, mnemonic)` → the account's ML-DSA-87 key
3. `directSignerFromPrivateKey(privateKey, "qor")` → a cosmjs offline signer
4. `ensurePqcRegistered(...)` → registers the PQC key once; nothing is sent when
   this key is already registered
5. `client.connectTx(signer, { pqcKeypair })` → a `TxClient` that signs hybrid
6. `toBase("1.5")` → `"1500000"` uqor
7. `tx.bankSend()` with the default fee `"auto"` (simulates the hybrid
   transaction to size gas and fee)

## Prerequisites

- A reachable **consensus RPC** (`QORE_RPC_URL`) and **REST** endpoint
  (`QORE_REST_URL`, used for the PQC key check and the fee). Defaults target localhost
  (`:26657` and `:1317`).
- A **funded account**: the address derived from `QORE_MNEMONIC` must hold QOR
  to pay the fee and the transfer (and, on the first run, the PQC key
  registration). The default is the public BIP-39 test
  mnemonic (`test test ... junk`), which is **not funded** on any real network -
  the broadcast will fail unless you supply a funded mnemonic.

Copy `.env.example` to `.env` and edit.

> Never commit a real mnemonic. Treat `QORE_MNEMONIC` as a secret.

## Run

```bash
pnpm install
QORE_RPC_URL=https://rpc-testnet.qore.host QORE_REST_URL=https://api-testnet.qore.host \
  QORE_MNEMONIC="<your funded testnet mnemonic>" QORE_RECIPIENT=qor1... pnpm start
```

Needs a live, reachable node and a funded account to complete; otherwise it
prints a hint and exits non-zero.
