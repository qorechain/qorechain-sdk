---
id: evm
title: EVM guide
sidebar_position: 1
---

# EVM guide

`@qorechain/evm` is a thin, type-safe adapter over [viem](https://viem.sh) for
the QoreChain EVM Engine. It does not reimplement an EVM client - viem is a peer
dependency. It adds a chain-aware client factory (with EVM chain-id
auto-detection), ERC-20 helpers, contract deploy/call wrappers, and typed
bindings for QoreChain's EVM precompiles.

```bash
npm i @qorechain/evm viem
```

## Create a client

`createEvmClient` returns a client bundle backed by viem. It auto-detects the
EVM chain id via `eth_chainId` unless you pass `chainId`.

```ts
import { createEvmClient } from "@qorechain/evm";

const client = await createEvmClient({
  endpoints: { evmRpc: "https://evm-testnet.qore.host" },
});

console.log(await client.getChainId());
// client.publicClient - a viem PublicClient for reads
```

You can also pass `rpcUrl` directly (mutually exclusive with `endpoints`), a
`wsUrl` / `endpoints.evmWs` for WebSocket, an explicit `chainId`, and `decimals`
(defaults to 18, the EVM convention for QOR - distinct from the Native `uqor`
base of 10^6).

Derive an EVM signing account from a private key:

```ts
import { evmAccountFromPrivateKey } from "@qorechain/evm";

const account = evmAccountFromPrivateKey("0x...");
```

## ERC-20 helpers

The `erc20` namespace (and the individual functions) wrap standard ERC-20 calls.
Reads take a viem public client; writes take a wallet client.

```ts
import { erc20 } from "@qorechain/evm";

const bal = await erc20.balanceOf(client.publicClient, token, account);
const meta = await erc20.metadata(client.publicClient, token); // Erc20Metadata
const allowed = await erc20.allowance(client.publicClient, token, owner, spender);

// writes (need a wallet client)
// await erc20.transfer(walletClient, token, to, amount);
// await erc20.approve(walletClient, token, spender, amount);
```

The raw ABI is exported as `ERC20_ABI` if you prefer to call viem directly.

## NFTs (ERC-721 / ERC-1155)

The `erc721` and `erc1155` namespaces mirror the `erc20` style: reads take a
viem public client, writes take a wallet client. The bundled ABIs are exported
as `ERC721_ABI` and `ERC1155_ABI`.

```ts
import { erc721, erc1155 } from "@qorechain/evm";

// ERC-721 reads
const owner = await erc721.ownerOf(client.publicClient, nft, 1n);
const uri = await erc721.tokenURI(client.publicClient, nft, 1n);
const meta = await erc721.metadata(client.publicClient, nft); // { name, symbol }
const count = await erc721.balanceOf(client.publicClient, nft, owner);
const approved = await erc721.isApprovedForAll(client.publicClient, nft, owner, operator);

// ERC-721 writes (wallet client)
// await erc721.approve(wallet, nft, to, tokenId);
// await erc721.setApprovalForAll(wallet, nft, operator, true);
// await erc721.transferFrom(wallet, nft, from, to, tokenId);
// await erc721.safeTransferFrom(wallet, nft, from, to, tokenId);          // 3-arg
// await erc721.safeTransferFrom(wallet, nft, from, to, tokenId, "0x...");  // 4-arg (with data)

// ERC-1155 reads
const bal = await erc1155.balanceOf(client.publicClient, multi, account, id);
const bals = await erc1155.balanceOfBatch(client.publicClient, multi, [a, b], [1n, 2n]);
const tmpl = await erc1155.uri(client.publicClient, multi, id);

// ERC-1155 writes
// await erc1155.setApprovalForAll(wallet, multi, operator, true);
// await erc1155.safeTransferFrom(wallet, multi, from, to, id, amount);
// await erc1155.safeBatchTransferFrom(wallet, multi, from, to, ids, amounts);
```

See the `evm-nft` example in the repository for a runnable read.

## Chain definitions

`qorechain` (EVM chain id 9801, mainnet) and `qorechainTestnet` (9800) are viem
chain objects with the public endpoints, for viem, wagmi or RainbowKit.
`QORECHAIN_CHAINS` lists both, mainnet first.

```ts
import { createPublicClient, http } from "viem";
import { qorechainTestnet } from "@qorechain/evm";

const publicClient = createPublicClient({ chain: qorechainTestnet, transport: http() });
```

## The EVM authorisation window

Before an account can send any EVM transaction, it needs a registered ML-DSA-87
key and a live authorisation window. The window is opened with a native-lane
message (`MsgOpenEVMWindow`) signed hybrid, and bounds the number of blocks,
transactions and total value (value plus the maximum fee) the EVM lane may
spend. `@qorechain/evm` reads the window and composes the message; sign it with
`@qorechain/sdk`.

```ts
import { evmWindowStatus, openEvmWindowMessage, evmWindowCost } from "@qorechain/evm";

const w = await evmWindowStatus({ rest: "https://api-testnet.qore.host", address: "0x..." });

const msg = openEvmWindowMessage({
  sender: "qor1...",
  blocks: 600,
  maxTxs: 5,
  maxValue: evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 112_500_000_000n }) * 5n,
});
```

`toQorAddress("0x...")` gives the `qor1...` form of the same account. Opening a
window advances the account's EVM nonce, so open first, then read the nonce,
then sign. The full rules and the SDK signing code are in the
[TypeScript SDK README](https://github.com/qorechain/qorechain-sdk/tree/main/packages/ts#evm-authorisation-window-v082-chain-v320);
the differences from Ethereum are in
[QoreChain EVM compared with Ethereum](evm-differences.md).

## Fees

`estimateEip1559Fees` wraps viem's fee estimation; `gasPrice` is the legacy
single-price helper. Both take a public client.

```ts
import { estimateEip1559Fees, gasPrice } from "@qorechain/evm";

const { maxFeePerGas, maxPriorityFeePerGas } = await estimateEip1559Fees(client.publicClient);
const legacy = await gasPrice(client.publicClient);
```

Pass these into a viem write (`maxFeePerGas` / `maxPriorityFeePerGas`) when you
want explicit fee control rather than viem's automatic estimation.

## Contracts

Generic deploy and call wrappers:

```ts
import { deployContract, readContract, writeContract } from "@qorechain/evm";

// const address = await deployContract(walletClient, { abi, bytecode, args });
// const value = await readContract(client.publicClient, { address, abi, functionName, args });
// const hash = await writeContract(walletClient, { address, abi, functionName, args });
```

## Precompiles

QoreChain exposes contract-callable precompiles at fixed addresses. The
`precompiles` namespace provides typed bindings, and the addresses and ABIs are
exported.

| Precompile | Function | Address |
| --- | --- | --- |
| Cross-VM Bridge | (bridge routing) | `0x0000000000000000000000000000000000000901` |
| PQC verify | `pqcVerify` | `0x0000000000000000000000000000000000000A01` |
| PQC key status | `pqcKeyStatus` | `0x0000000000000000000000000000000000000A02` |
| QCAI risk score | `aiRiskScore` | `0x0000000000000000000000000000000000000B01` |
| QCAI anomaly check | `aiAnomalyCheck` | `0x0000000000000000000000000000000000000B02` |
| Consensus params | `rlConsensusParams` | `0x0000000000000000000000000000000000000C01` |

Not every precompile is active on every network. See
[QoreChain EVM compared with Ethereum](evm-differences.md#precompiles) for the
state of each one on the testnet and on mainnet.

```ts
import {
  precompiles,
  PRECOMPILE_ADDRESSES,
  aiRiskScore,
  aiAnomalyCheck,
} from "@qorechain/evm";

// Read live consensus parameters.
const params = await precompiles.rlConsensusParams(client.publicClient);

// Check whether an address has a registered PQC key.
const status = await precompiles.pqcKeyStatus(client.publicClient, account);

// On-chain AI helpers: score raw calldata, and check a (sender, amount) pair.
const score = await aiRiskScore(client.publicClient, "0xa9059cbb...");
const anomaly = await aiAnomalyCheck(client.publicClient, account, 0n);

console.log(PRECOMPILE_ADDRESSES.crossVmBridge);
```

For a one-call pre-flight that bundles a gas estimate with the risk and anomaly
checks (`simulateWithRiskScore`), see the [AI pre-flight guide](ai-preflight.md).

The precompile ABIs are exported as `IQORE_PQC_ABI`, `IQORE_AI_ABI`, and
`IQORE_CONSENSUS_ABI`.

> On a node without the QoreChain precompiles, these calls throw a "feature not
> present" error. Handle that per-call if you target heterogeneous nodes.

See the `evm-precompile` example in the repository for a runnable version.
