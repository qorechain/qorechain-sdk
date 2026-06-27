# register-sidechain

Drive the multilayer (sidechain / paychain) lifecycle with the high-level
`createMultilayerClient` helper — register two layers, anchor a state root, route
a transaction, and read layer state + routing stats.

Shows:

1. `createMultilayerClient(tx, { query })` → an ergonomic, strongly-typed client
2. `registerSidechain({...})` + `registerPaychain({...})` → declare two layers
3. `anchorState({...})` → commit a sidechain state root to the main chain
4. `routeTransaction({...})` → let the router pick the best-fit layer
5. `getLayer` / `listLayers` / `routingStats` → typed reads

Every message is built and logged **offline**; broadcasting and the typed reads
need a node.

## Prerequisites

- A reachable **consensus RPC** (`QORE_RPC_URL`, default `:26657`) and **REST**
  endpoint (`QORE_REST_URL`, default `:1317`).
- To broadcast (`QORE_BROADCAST=1`): a **funded account**. The default is the
  public BIP-39 test mnemonic, which is not funded on any real network.

> Never commit a real mnemonic. Treat `QORE_MNEMONIC` as a secret.

## Run

```bash
pnpm install
# Dry run — just builds + logs the messages (no node needed):
pnpm start

# Broadcast + read against a live node:
QORE_RPC_URL=https://rpc.testnet.example QORE_REST_URL=https://rest.testnet.example \
  QORE_MNEMONIC="<your funded testnet mnemonic>" QORE_BROADCAST=1 pnpm start
```

See the [Sidechains & Paychains guide](../../docs/docs/guides/multilayer.md) for
the concepts behind register → anchor → route.
