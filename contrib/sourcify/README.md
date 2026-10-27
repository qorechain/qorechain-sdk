# Sourcify chain support (prepared, not submitted)

Entries for a pull request to
[sourcifyeth/sourcify-chains](https://github.com/sourcifyeth/sourcify-chains),
which configures the chains [Sourcify](https://sourcify.dev) verifies
contracts on. On 27 October 2026 `https://sourcify.dev/server/chains` did not
list chain ids 9800 or 9801.

## Before opening the pull request

1. **ethereum-lists.** Sourcify requires the chains to be listed on
   [chainid.network](https://chainid.network) (ethereum-lists/chains). They were
   not listed on 27 October 2026.
2. **Test contracts.** None of the canonical contracts the Sourcify tests detect
   automatically (CreateX, Multicall3, Safe v1.4.1 SafeProxyFactory) is deployed
   on QoreChain today, so deploy Sourcify's `Storage.sol` on each network and
   put the addresses in `storage-contract-chain-addresses.json`. The deployer
   needs a registered ML-DSA-87 key and an open EVM authorisation window first
   (`pnpm window open` in the `foundry` template of `create-qorechain-dapp`).
   Sourcify's own `scripts/deployContracts.ts` sends a plain EVM transaction, so
   open the window before running it.
3. **Branch name.** `add-chain-9800-9801`; the Test New Chain workflow reads the
   chain ids from it.

## Files

| File here | Where it goes in sourcify-chains |
| --- | --- |
| `chain-overrides.json` | merge the two entries into `chain-overrides.json` |
| `storage-contract-chain-addresses.json` | merge into `storage-contract-chain-addresses.json` (fill in the addresses) |

`chain-overrides.json` is used rather than `additional-chains.json` because
QoreChain is not served by Sourcify's RPC providers, so the public RPCs are
given explicitly. Do not edit `sourcify-chains-default.json`; it is generated.

## Notes for the reviewers

- The public RPCs do not offer `debug_traceTransaction` or `trace_transaction`,
  so no `traceSupport` is declared. How Sourcify then finds the creation
  transaction of a factory-created contract is to be confirmed with the
  Sourcify team.
- There is no Etherscan-compatible explorer API to declare.

## Pull request text

Title: `Add QoreChain (9801) and QoreChain Testnet (9800)`

> Adds QoreChain mainnet (chain id 9801) and QoreChain Testnet (chain id 9800)
> through `chain-overrides.json`, with their public RPCs:
>
> - 9801: `https://evm.qore.host`
> - 9800: `https://evm-testnet.qore.host`
>
> Both are listed on chainid.network (link the ethereum-lists entries). The RPCs
> do not support tracing. `Storage.sol` is deployed at the addresses in
> `storage-contract-chain-addresses.json`. No API keys or environment variables
> are needed.
