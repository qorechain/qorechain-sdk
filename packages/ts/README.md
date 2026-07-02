# @qorechain/sdk

Official TypeScript SDK for building decentralized applications on the QoreChain
network — a quantum-safe, triple-VM Layer 1 with native, EVM, and SVM accounts.

## Features

- **Full message coverage** — typed composers for every chain message (bank,
  staking, distribution, gov, authz, feegrant, IBC, and the QoreChain custom
  modules), resolved through a message registry.
- **Browser wallets** — Keplr/Leap (Cosmos); MetaMask/EIP-1193 and
  Phantom/Wallet-Standard via the `@qorechain/evm` and `@qorechain/svm` adapters.
- **Auto-gas** — simulation-based fee estimation, with EVM EIP-1559 and SVM
  compute-budget helpers in the adapters.
- **Subscriptions** — new-block and tx event streams over the consensus RPC.
- **Error decoding** — structured, human-readable transaction errors.
- **NFT helpers** — ERC-721 / ERC-1155 wrappers in `@qorechain/evm`.
- **CosmWasm lifecycle** — query, upload, instantiate/instantiate2, execute,
  migrate, and admin management.
- **PQC** — ML-DSA-87 (Dilithium-5) signing and hybrid-signature transactions,
  plus quantum-safe DX helpers (`ensurePqcRegistered` / `migrateToHybrid`).
- **Sidechains, paychains & rollups** — high-level `createMultilayerClient` and
  `createRollupClient` helpers (v0.4.0).
- **Unified cross-VM calls** — `createCrossVMClient` with atomic triple-VM
  transactions over `MsgCrossVMCall` (v0.5.0).
- **AI pre-flight** — on-chain risk/anomaly scoring (`simulateWithRiskScore`)
  over the EVM precompiles before you sign (v0.5.0).
- **React kit** — hooks + connect kit in
  [`@qorechain/react`](../react/README.md).

## Install

```sh
npm install @qorechain/sdk
```

## Quickstart

### Connect

`createClient()` targets the public testnet (chain id `qorechain-diana`) by
default. The defaults point at localhost, so pass `endpoints` to talk to a real
node.

```ts
import { createClient } from "@qorechain/sdk";

const client = createClient(); // testnet, localhost defaults

const remote = createClient({
  endpoints: {
    rest: "https://api-testnet.qore.host", // Cosmos REST (LCD)
    rpc: "https://rpc-testnet.qore.host",    // consensus RPC (for signing)
    evmRpc: "https://evm-testnet.qore.host", // EVM + qor_ JSON-RPC
  },
});
```

Mainnet (chain id `qorechain-vladi`) is live; target it with
`createClient({ network: "mainnet", endpoints })`, overriding the localhost
defaults with your node URLs.

### Accounts

One mnemonic derives native (`qor1…`), EVM (`0x…`), and SVM (base58) accounts.

```ts
import {
  generateMnemonic,
  deriveNativeAccount,
  deriveEvmAccount,
  deriveSvmAccount,
} from "@qorechain/sdk";

const mnemonic = generateMnemonic();
const native = await deriveNativeAccount(mnemonic); // native.address → "qor1..."
const evm = await deriveEvmAccount(mnemonic);        // evm.address → "0x..."
const svm = await deriveSvmAccount(mnemonic);        // svm.address → base58
```

### Read on-chain state

```ts
const balances = await client.rest.getAllBalances(native.address);
const tokenomics = await client.qor.getTokenomicsOverview();
```

### Send a transfer

```ts
import { directSignerFromPrivateKey, toBase } from "@qorechain/sdk";

const account = await deriveNativeAccount(mnemonic);
const signer = await directSignerFromPrivateKey(account.privateKey, "qor");
const tx = await client.connectTx(signer);

const fee = await client.fees.estimate(); // or "fast" | "normal" | "slow"
const result = await tx.bankSend(
  "qor1recipientaddress...",
  [{ denom: "uqor", amount: toBase("1.5") }],
  { fee },
);
console.log(result.transactionHash);
```

### Quantum-safe signing

QoreChain supports post-quantum cryptography via ML-DSA-87 (Dilithium-5) and a
hybrid posture. The key/sign/verify primitives are available today through
`generatePqcKeypair`, `pqcSign`, `pqcVerify`, and the pluggable `PqcSigner` /
`HybridSigner`. Hybrid transaction submission is being finalized for the live
network.

```ts
import { generatePqcKeypair, pqcSign, pqcVerify } from "@qorechain/sdk";

const keypair = generatePqcKeypair();
const message = new TextEncoder().encode("hello");
const signature = pqcSign(keypair.secretKey, message);
const ok = pqcVerify(keypair.publicKey, message, signature);
```

### CosmWasm contracts

Interact with CosmWasm contracts via thin wrappers over
`@cosmjs/cosmwasm-stargate`. `client.cosmwasm()` opens a read-only client at the
`rpc` endpoint; for writes, connect a `SigningCosmWasmClient` with an offline
signer.

```ts
import {
  connectCosmWasmSigner,
  queryContractSmart,
  getContractInfo,
  instantiate,
  execute,
} from "@qorechain/sdk";

// Reads
const cw = await client.cosmwasm();
const info = await getContractInfo(cw, "qor1contract...");
const state = await queryContractSmart(cw, "qor1contract...", { get_count: {} });

// Writes
const signing = await connectCosmWasmSigner("https://rpc-testnet.qore.host", signer);
const inst = await instantiate(signing, sender, codeId, { count: 0 }, "my-contract", {
  fee: "auto",
});
await execute(signing, sender, inst.contractAddress, { increment: {} }, "auto");
```

### Sidechains, paychains & rollups (v0.4.0)

QoreChain's multilayer module lets a dApp register and operate its own
sidechains/paychains, and the rollup development kit (`rdk`) provides an
optimistic rollup lifecycle. Two high-level, strongly-typed helpers wrap the
typed message composers and query clients so you never hand-build protobuf `Any`
payloads. Both bind to a connected `TxClient`; pass a typed query client (from
`connectQueryClients`) for the reads.

```ts
import {
  createClient,
  createMultilayerClient,
  createRollupClient,
  connectQueryClients,
} from "@qorechain/sdk";

const client = createClient({ endpoints });
const tx = await client.connectTx(signer);
const query = await connectQueryClients("https://grpc.example");

// --- Multilayer: register → anchor → route ---
const ml = createMultilayerClient(tx, { query });
await ml.registerSidechain({ layerId: "game-l2", description: "game sidechain" });
await ml.registerPaychain({ layerId: "pay-l2", description: "payments paychain" });
await ml.anchorState({ layerId: "game-l2", layerHeight: 100n, stateRoot, validatorSetHash });
await ml.routeTransaction({ transactionPayload, preferredLayer: "game-l2" });
// Reads
const layer = await ml.getLayer("game-l2");
const layers = await ml.listLayers();
const stats = await ml.getRoutingStats();

// --- Rollups: create → submitBatch → executeWithdrawal ---
const rollup = createRollupClient(tx, { query, qor: client.qor });
await rollup.createRollup({ rollupId: "r1", profile: "default", vmType: "evm" });
await rollup.submitBatch({ rollupId: "r1", batchIndex: 0n, stateRoot, txCount: 12n });
await rollup.executeWithdrawal({ rollupId: "r1", batchIndex: 0n, withdrawalIndex: 0n, recipient, denom: "uqor", amount: 100n, proof });
// Reads (typed gRPC + qor_ conveniences)
const r = await rollup.getRollup("r1");
const batch = await rollup.getLatestBatch("r1");
const rollupStatus = await rollup.getRollupStatus("r1");
```

Every write also has a `*Msg(...)` variant (`registerSidechainMsg`,
`submitBatchMsg`, …) that returns an `EncodeObject` for batching with other
messages. The challenge game (`challengeBatch` / `resolveChallenge`) and lifecycle
controls are exposed on the rollup client too.

You can also reach the typed query clients directly — `connectQueryClients`
returns `multilayer`, `rdk`, `bridge`, and `crossvm` clients (among others):

```ts
const layers = await query.multilayer.layers({});
const rollups = await query.rdk.rollups({});
const bridgeChains = await query.bridge.chainConfigs({});
```

See the [multilayer](../../docs/docs/guides/multilayer.md) and
[rollups](../../docs/docs/guides/rollups.md) guides.

### AI pre-flight risk scoring (v0.5.0)

QoreChain exposes an on-chain AI risk/anomaly model to any dApp through plain
`eth_call`s, so you can get an advisory verdict on a transaction **before** it is
signed or broadcast. The helpers live in `@qorechain/evm` (which owns viem) and
are re-exported from `@qorechain/sdk` for discovery — install `@qorechain/evm`
and `viem` (an optional peer) to use them.

`simulateWithRiskScore` bundles a gas estimate, a risk score from the
`aiRiskScore` precompile (`0x…0B01`), and an anomaly check from the
`aiAnomalyCheck` precompile (`0x…0B02`) into one `PreflightResult`:

```ts
import { simulateWithRiskScore, aiRiskScore, aiAnomalyCheck } from "@qorechain/sdk";
import { createPublicClient, http } from "viem";

const evm = createPublicClient({ transport: http("https://evm.example") });

const verdict = await simulateWithRiskScore(evm, {
  from: "0xSender",
  to: "0xContract",
  data: "0x…", // calldata
  value: 0n,
});
if (!verdict.safe) throw new Error("AI pre-flight flagged this transaction");

// Or call the precompiles individually:
const risk = await aiRiskScore(evm, "0xCalldata");      // { score, level }
const anomaly = await aiAnomalyCheck(evm, "0xSender", 1_000_000n); // { anomalyScore, flagged }
```

See the [AI pre-flight](../../docs/docs/guides/ai-preflight.md) guide.

### Unified cross-VM calls (v0.5.0)

QoreChain routes calls across its EVM, CosmWasm, and SVM execution environments
over a single `MsgCrossVMCall`. `createCrossVMClient` builds, signs, and
broadcasts these for you — including `callAtomic`, which packs several calls into
**one** transaction so a triple-VM workflow settles atomically.

This SDK encodes the payload per VM: an `{ evm: { abi, functionName, args } }`
payload is ABI-encoded with viem's `encodeFunctionData`, a `{ cosmwasm: {...} }`
payload is `JSON.stringify`'d to UTF-8, and a raw `{ payload }` is sent as-is.

```ts
import { createCrossVMClient, connectQueryClients } from "@qorechain/sdk";

const query = await connectQueryClients("https://grpc.example");
const xvm = createCrossVMClient(tx, { query });

// Single call into a CosmWasm contract (payload JSON-encoded).
const res = await xvm.call({
  targetVm: "cosmwasm",
  targetContract: "qor1contract…",
  payload: { cosmwasm: { increment: {} } },
});

// Atomic triple-VM batch in ONE tx.
const atomic = await xvm.callAtomic([
  { targetVm: "evm", targetContract: "0xC…", payload: { evm: { abi, functionName: "swap", args: [a, b] } } },
  { targetVm: "svm", targetContract: "Prog…", payload: { payload: rawBytes } },
  { targetVm: "cosmwasm", targetContract: "qor1…", payload: { cosmwasm: { stake: {} } } },
]);

// build-only (returns an EncodeObject) and read message status:
const msg = xvm.buildCall({ targetVm: "evm", targetContract: "0xC…", payload: { payload: rawBytes } });
const status = await xvm.getMessage("42");
```

`targetVm` is one of `"evm" | "cosmwasm" | "svm"` (see `VM_TYPES`). See the
[cross-VM](../../docs/docs/guides/cross-vm.md) guide.

### Quantum-safe DX (v0.5.0)

QoreChain enforces hybrid post-quantum signatures (ML-DSA-87 + secp256k1) by
default. These helpers make a dApp PQC-protected in one idempotent call: check
whether the signer's Dilithium key is registered, register it if not, and route
subsequent transactions through the hybrid signing path.

```ts
import {
  isPqcRegistered,
  getPqcStatus,
  ensurePqcRegistered,
  migrateToHybrid,
  migratePqcKey,
} from "@qorechain/sdk";

// Read-only status (over the qor_ namespace or the pqcKeyStatus precompile).
const registered = await isPqcRegistered(client.qor, native.address);
const status = await getPqcStatus(client.qor, native.address);

// Idempotent: registers the signer's PQC key only if it isn't already.
await ensurePqcRegistered({ tx, signer: pqcSigner /* … */ });

// Migrate an existing classical account to hybrid signing, then sign hybrid.
const path = await migrateToHybrid({ tx, signer: pqcSigner /* … */ });

// Rotate an account's on-chain PQC key (MsgMigratePQCKey).
await migratePqcKey({ tx, /* new key material … */ });
```

See the [quantum-safe](../../docs/docs/guides/quantum-safe.md) guide.

### Cross-VM message reads

You can also read cross-VM message state without the client above:

```ts
const pending = await client.crossvm.pending();
const message = await client.crossvm.message("42");
const params = await client.crossvm.params();

// Or track a message by id over the EVM JSON-RPC namespace:
const status = await client.qor.getCrossVmMessage("42");
```

## Network reference

- Mainnet chain id: `qorechain-vladi` (live).
- Testnet chain id: `qorechain-diana` (live).
- Token: `QOR` / `uqor` (10^6 base units per QOR).
- Default endpoints point at localhost — override them to reach a real node.

## License

Apache-2.0
