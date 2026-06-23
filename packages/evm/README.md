# @qorechain/evm

A thin, type-safe adapter over [viem](https://viem.sh) for the **QoreChain EVM
Engine**. It does not reimplement an EVM client — `viem` is a peer dependency —
it adds QoreChain-specific conveniences: a chain-aware client factory with EVM
chain-id auto-detection, ERC-20 helpers, contract deploy/call wrappers, and
typed bindings for QoreChain's EVM precompiles.

## Install

`viem` is a peer dependency, so install it alongside this package:

```bash
pnpm add @qorechain/evm viem
# or: npm install @qorechain/evm viem
```

## Quickstart

### Connect

The numeric EVM chain id is **auto-detected** at connect time via `eth_chainId`.
You can also pass `chainId` explicitly to skip detection.

```ts
import { createEvmClient } from "@qorechain/evm";

const client = await createEvmClient({
  rpcUrl: "http://localhost:8545", // or pass an endpoints object: { endpoints: { evmRpc, evmWs } }
});

console.log("chain id:", await client.getChainId());
```

The native currency defaults to `QOR` with **18 decimals** (the EVM convention).
This is the EVM-side representation and is distinct from the Cosmos `uqor` base
denomination (10^6). Override with `{ decimals }` if your node differs; confirm
the canonical value against your target node.

### Read an ERC-20 balance

```ts
import { erc20 } from "@qorechain/evm";

const token = "0x...";
const holder = "0x...";

const balance = await erc20.balanceOf(client.publicClient, token, holder);
const meta = await erc20.metadata(client.publicClient, token); // { name, symbol, decimals }
```

### Sign and send

Pair with `@qorechain/sdk`'s `deriveEvmAccount(mnemonic)`, which returns the
`privateKey`:

```ts
import { evmAccountFromPrivateKey, writeContract, ERC20_ABI } from "@qorechain/evm";

const account = evmAccountFromPrivateKey("0x..."); // privateKey from deriveEvmAccount
const wallet = client.getWalletClient(account);

const hash = await writeContract(wallet, {
  address: token,
  abi: ERC20_ABI,
  functionName: "transfer",
  args: ["0xrecipient", 1_000n],
});
```

### Call a precompile

QoreChain exposes on-chain precompiles for post-quantum verification, AI-based
risk/anomaly checks, and live consensus parameters. These are available on
QoreChain network nodes; on a default or community node a call may return a
"not available" error.

```ts
import { precompiles } from "@qorechain/evm";

const params = await precompiles.rlConsensusParams(client.publicClient);
// { blockTime, baseGasPrice, validatorSetSize, epoch }

const { valid } = { valid: await precompiles.pqcVerify(client.publicClient, {
  pubkey: "0x...",
  signature: "0x...",
  message: "0x...",
}) };
```

The precompile addresses and interface ABIs are also exported directly:
`PRECOMPILE_ADDRESSES`, `IQORE_PQC_ABI`, `IQORE_AI_ABI`, `IQORE_CONSENSUS_ABI`.

## License

Apache-2.0
