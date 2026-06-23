---
id: cosmwasm
title: CosmWasm guide
sidebar_position: 3
---

# CosmWasm guide

The TypeScript core (`@qorechain/sdk`) includes thin, typed wrappers over
`@cosmjs/cosmwasm-stargate` for querying and executing CosmWasm contracts. Reads
use a read-only client; state changes use a signing client.

## Read-only queries

Open a read-only CosmWasm client from your `createClient()` instance — it
connects over the consensus RPC endpoint and is memoized on the client.

```ts
import {
  createClient,
  queryContractSmart,
  getContractInfo,
} from "@qorechain/sdk";

const client = createClient({
  network: "testnet",
  endpoints: { rpc: "https://rpc.testnet.example" },
});

const cw = await client.cosmwasm(); // read-only CosmWasmReadClient

// Contract metadata.
const info = await getContractInfo(cw, contractAddress);

// A smart query (the message shape is contract-specific).
const result = await queryContractSmart(cw, contractAddress, { token_info: {} });
```

You can also construct a read client directly with `createCosmWasmClient`.

## Signing: instantiate, execute, upload

For state changes, connect a signing client with `connectCosmWasmSigner` (it
takes an offline signer, the same kind produced by
`directSignerFromPrivateKey`), then use the typed wrappers:

```ts
import {
  connectCosmWasmSigner,
  uploadCode,
  instantiate,
  execute,
} from "@qorechain/sdk";

const signingCw = await connectCosmWasmSigner(rpcUrl, signer);

// Upload Wasm bytecode -> a code id.
const { codeId } = await uploadCode(signingCw, sender, wasmBytes, fee);

// Instantiate a contract from a code id.
const { contractAddress } = await instantiate(
  signingCw,
  sender,
  codeId,
  { /* init msg */ },
  "label",
  fee,
);

// Execute a message against a deployed contract.
const res = await execute(
  signingCw,
  sender,
  contractAddress,
  { /* execute msg */ },
  fee,
);
```

The exact argument shapes follow `@cosmjs/cosmwasm-stargate`; the SDK adds typed
`ContractMsg`, `FeeInput`, `InstantiateOpts`, `CosmWasmReadClient`, and
`CosmWasmSigningClient` types.

See the `cosmwasm-query` example in the repository for a runnable read example.
