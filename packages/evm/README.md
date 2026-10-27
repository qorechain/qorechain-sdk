# @qorechain/evm

A thin, type-safe adapter over [viem](https://viem.sh) for the **QoreChain EVM
Engine**. It does not reimplement an EVM client - `viem` is a peer dependency -
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
This is the EVM-side representation and is distinct from the Native `uqor` base
denomination (10^6). Override with `{ decimals }` if your node differs; confirm
the canonical value against your target node.

### Chain definitions

`qorechain` (chain id 9801) and `qorechainTestnet` (9800) are viem chains with
the public endpoints, ready for viem, wagmi or RainbowKit:

```ts
import { createPublicClient, http } from "viem";
import { qorechainTestnet, QORECHAIN_CHAINS } from "@qorechain/evm";

const client = createPublicClient({ chain: qorechainTestnet, transport: http() });
// wagmi / RainbowKit: chains: QORECHAIN_CHAINS (mainnet first)
```

### Before you send: the EVM authorisation window

Every EVM transaction on QoreChain needs a registered ML-DSA-87 key and a live
authorisation window for the sender. The window is opened by a native-lane
message signed hybrid (secp256k1 + ML-DSA-87). This package reads the window
and composes the message; sign and broadcast it with `@qorechain/sdk`.

```ts
import { evmWindowStatus, openEvmWindowMessage, evmWindowCost } from "@qorechain/evm";

const w = await evmWindowStatus({ rest: "https://api-testnet.qore.host", address: "0x..." });
// w.live, w.remainingTxs, w.remainingValue (uqor), w.remainingBlocks

const msg = openEvmWindowMessage({
  sender: "qor1...", // the same account; toQorAddress("0x...") converts
  blocks: 600,
  maxTxs: 5,
  maxValue: evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 112_500_000_000n }) * 5n,
});
// Sign `msg` hybrid on the native lane, then read the nonce (opening advances it).
```

`classifyEvmWindowRejection(err)` tells a refused transaction apart:
`"no-pqc-key"`, `"no-window"`, `"exhausted"` or `"invalid"`. The window helpers
are also published viem-free at `@qorechain/evm/window`.

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

QoreChain defines on-chain precompiles for post-quantum verification, AI-based
risk/anomaly checks, and live consensus parameters.

> **Activation differs per network.** On the testnet (`qorechain-diana`) the
> chain's `/cosmos/evm/vm/v1/params` lists `0x0A01`, `0x0A02` and `0x0C01` as
> active; on mainnet (`qorechain-vladi`) it lists none. A call to an inactive
> precompile returns empty data (the helpers then throw). Check that list
> before you rely on them.


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
