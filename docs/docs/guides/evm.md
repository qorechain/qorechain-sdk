---
id: evm
title: EVM guide
sidebar_position: 1
---

# EVM guide

`@qorechain/evm` is a thin, type-safe adapter over [viem](https://viem.sh) for
the QoreChain EVM Engine. It does not reimplement an EVM client — viem is a peer
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
  endpoints: { evmRpc: "https://evm.testnet.example" },
});

console.log(await client.getChainId());
// client.publicClient — a viem PublicClient for reads
```

You can also pass `rpcUrl` directly (mutually exclusive with `endpoints`), a
`wsUrl` / `endpoints.evmWs` for WebSocket, an explicit `chainId`, and `decimals`
(defaults to 18, the EVM convention for QOR — distinct from the Cosmos `uqor`
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

```ts
import { precompiles, PRECOMPILE_ADDRESSES } from "@qorechain/evm";

// Read live consensus parameters.
const params = await precompiles.rlConsensusParams(client.publicClient);

// Check whether an address has a registered PQC key.
const status = await precompiles.pqcKeyStatus(client.publicClient, account);

// QCAI helpers.
const score = await precompiles.aiRiskScore(client.publicClient, /* args */);
const anomaly = await precompiles.aiAnomalyCheck(client.publicClient, /* args */);

console.log(PRECOMPILE_ADDRESSES.crossVmBridge);
```

The precompile ABIs are exported as `IQORE_PQC_ABI`, `IQORE_AI_ABI`, and
`IQORE_CONSENSUS_ABI`.

> On a node without the QoreChain precompiles, these calls throw a "feature not
> present" error. Handle that per-call if you target heterogeneous nodes.

See the `evm-precompile` example in the repository for a runnable version.
