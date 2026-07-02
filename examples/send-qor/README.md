# send-qor

Derive a native (`qor1...`) account from a mnemonic and broadcast a QOR transfer.

Shows the full signing path:

1. `deriveNativeAccount(mnemonic)` → a secp256k1 account (incl. private key)
2. `directSignerFromPrivateKey(privateKey, "qor")` → a cosmjs offline signer
3. `client.connectTx(signer)` → a `TxClient`
4. `toBase("1.5")` → `"1500000"` uqor
5. `tx.simulate()`, `client.fees.estimate()`, then `tx.bankSend()`

## Prerequisites

- A reachable **consensus RPC** (`QORE_RPC_URL`) and **REST** endpoint
  (`QORE_REST_URL`, used for the fee estimate). Defaults target localhost
  (`:26657` and `:1317`).
- A **funded account**: the address derived from `QORE_MNEMONIC` must hold QOR
  to pay the fee and the transfer. The default is the public BIP-39 test
  mnemonic (`test test ... junk`), which is **not funded** on any real network —
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
