# cross-vm-call

Invoke contracts across **EVM, SVM, and CosmWasm from one native account** with a
single signature — QoreChain's triple-VM headline. Uses the high-level
`createCrossVMClient` helper from `@qorechain/sdk` to:

- `buildCall({ ... })` — build a single `MsgCrossVMCall` offline (per-VM payload)
- `call({ evm: { abi, functionName, args } })` — call an EVM contract from a
  native account, payload ABI-encoded with viem
- `callAtomic([...])` — pack multiple calls into ONE transaction body so they
  execute atomically under one signature
- `getMessage(id)` — read message state via the typed query client (or the
  `qor_getCrossVMMessage` fallback)

Per-VM payload shapes (pick one per call): `{ payload }` (raw bytes/hex),
`{ evm: { abi, functionName, args } }`, `{ cosmwasm: object }` (JSON → UTF-8), or
`{ svm: { data } }` (raw bytes/hex).

## Prerequisites

- A reachable QoreChain node: consensus RPC (`QORE_RPC_URL`, default
  `http://localhost:26657`) and REST (`QORE_REST_URL`, default
  `http://localhost:1317`).
- For broadcast (`QORE_BROADCAST=1`): a FUNDED account via `QORE_MNEMONIC`.
- Optional targets: `QORE_EVM_CONTRACT`, `QORE_SVM_PROGRAM`,
  `QORE_EVM_RECIPIENT`.

## Run

```bash
pnpm install
# Dry run: builds + logs the messages without broadcasting.
pnpm start
# Broadcast across VMs (needs a funded account):
QORE_BROADCAST=1 QORE_MNEMONIC="..." pnpm start
```
