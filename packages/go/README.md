# qorechain-sdk (Go)

Idiomatic Go SDK for QoreChain — network presets, denomination/address utilities,
HD account derivation (native / EVM / SVM), post-quantum (ML-DSA-87) signing, read
clients for the REST (LCD) and `qor_*` JSON-RPC surfaces, the full native-chain
message set (61 custom messages across 11 modules + the standard Native modules),
typed gRPC query clients, complete transaction lifecycle (auto-gas, error
decoding, tracking, search), utilities, and WebSocket subscriptions.

This is a self-contained Go module within the `qorechain-sdk` monorepo. It mirrors
the TypeScript and Python SDK surfaces for the native chain.

### Out of scope

Browser-wallet integrations and the EVM/SVM execution adapters are intentionally
not part of the Go SDK — Go services talk to the EVM and SVM layers with the
established libraries ([go-ethereum](https://github.com/ethereum/go-ethereum) and
[solana-go](https://github.com/gagliardetto/solana-go)). The Go SDK focuses on the
native chain surface, including hybrid post-quantum transactions.

## Install

```sh
go get github.com/qorechain/qorechain-sdk/packages/go@latest
```

Requires Go 1.23+.

## Packages

| Package | Purpose |
|---|---|
| `qorechain/networks` | Network presets (`testnet` and `mainnet`, both live), `GetNetwork`. |
| `qorechain/denom` | `ToBase` / `FromBase` exact big.Int money math. |
| `qorechain/address` | bech32 ⇄ hex conversion and validation. |
| `qorechain/accounts` | BIP-39 mnemonics + HD derivation (native, EVM, SVM). |
| `qorechain/pqc` | ML-DSA-87 (FIPS 204) keygen / sign / verify + hybrid extension. |
| `qorechain/query` | REST client, JSON-RPC client, `qor_*` typed client, typed gRPC query clients. |
| `qorechain/client` | `CreateClient` factory composing the read clients + fees. |
| `qorechain/messages` | Interface registry/codec + typed composers for all 61 custom messages and the standard Native modules. |
| `qorechain/tx` | Build/sign/broadcast (classical + hybrid PQC), auto-gas, error decoding, tracking/retry, tx & block search. |
| `qorechain/proto` | Generated gogoproto Go types for every chain module (committed; regenerate with `scripts/codegen-go.sh`). |
| `qorechain/utils` | Hashing (sha256/keccak256/ripemd160), unit conversion, EVM/SVM address validation + EIP-55. |
| `qorechain/subscribe` | WebSocket client for the chain RPC `/websocket` (new blocks, transactions). |
| `qorechain/crossvm` | Unified cross-VM call helper over `MsgCrossVMCall` (single + atomic triple-VM). |
| `qorechain/evm` | AI pre-flight risk/anomaly scoring over the EVM precompiles (`eth_call`). |
| `qorechain/pqcdx` | Quantum-safe DX: idempotent PQC-key registration + classical→hybrid migration. |
| `qorechain/signbytes` | Hybrid / key-migration / bridge-attestation sign-bytes (v1 + v2), per-network version resolution. |

## Quickstart

### Create a client

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/client"

c, err := client.CreateClient(client.Options{}) // defaults to "testnet"
if err != nil {
    panic(err)
}
fmt.Println(c.Network.ChainID) // qorechain-diana

balances, err := c.REST.GetAllBalances("qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu")
stats, err := c.Qor.GetAIStats()
fee, err := c.Fees.Estimate("fast")
```

Mainnet (chain id `qorechain-vladi`) is live; select it and override the
localhost defaults with your node URLs:

```go
c, err := client.CreateClient(client.Options{
    Network: "mainnet",
    Endpoints: client.EndpointOverrides{
        REST:   "https://rest.example",
        EVMRPC: "https://evm.example",
    },
})
// c.Network.ChainID == "qorechain-vladi"
```

### Derive accounts

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"

mnemonic, _ := accounts.GenerateMnemonic(128)

native, _ := accounts.DeriveNativeAccount(mnemonic, 0) // qor1...
evm, _    := accounts.DeriveEVMAccount(mnemonic, 0)    // 0x... (EIP-55)
svm, _    := accounts.DeriveSVMAccount(mnemonic, 0)    // base58 ed25519
```

Derivation paths: native `m/44'/118'/0'/0/{i}`, EVM `m/44'/60'/0'/0/{i}`,
SVM `m/44'/501'/{i}'/0'`. Invalid mnemonics (wrong checksum) return an error.

### Post-quantum signing

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"

kp, _ := pqc.GeneratePQCKeypair()                 // ML-DSA-87: 2592 / 4896
sig, _ := pqc.PQCSign(kp.SecretKey, []byte("..."))// 4627-byte signature
ok := pqc.PQCVerify(kp.PublicKey, []byte("..."), sig)

ext, _ := pqc.EncodeHybridSignatureExtension(pqc.AlgorithmDilithium5, sig, kp.PublicKey)
// ext is the PROTOBUF encoding of PQCHybridSignature (algorithm_id=1,
// pqc_signature=2, pqc_public_key=3), ready for Any.Value — it begins with 0x08.
// It is NOT JSON: a leading 0x7b ('{') is rejected by the tx decoder at CheckTx.
```

### Denomination math

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/denom"

base, _    := denom.ToBase("1.5", 6)      // "1500000"
display, _ := denom.FromBase("1500000", 6) // "1.5"
```

### Build, sign, and broadcast a transaction

```go
import (
    sdk "github.com/cosmos/cosmos-sdk/types"
    "cosmossdk.io/math"
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

acc, _ := accounts.DeriveNativeAccount(mnemonic, 0)

// Compose any message (custom or standard Native) with the typed composers.
swap := messages.Amm.SwapExactIn(acc.Address, 1,
    sdk.NewCoin("uqor", math.NewInt(1_000_000)), "uusdc", math.NewInt(990_000))

// Auto-gas: simulate, then build/sign with the suggested fee.
built, _ := tx.SendMessages(tx.SendMessagesParams{
    Account:       acc,
    Messages:      []sdk.Msg{swap},
    Fee:           tx.Fee{Amount: []tx.Coin{{Denom: "uqor", Amount: "3500"}}, Gas: "140000"},
    ChainID:       "qorechain-diana",
    AccountNumber: accountNumber,
    Sequence:      sequence,
})
res, _ := tx.BroadcastAndWait(tx.BroadcastAndWaitParams{
    RestURL: "http://localhost:1317", TxBytes: built.TxRawBytes, Mode: tx.BroadcastSync,
})
fmt.Println(res.Height)
```

For a quantum-safe transaction over the same messages, use
`tx.BuildHybridMessages` with an ML-DSA-87 keypair — it preserves the
exclude-extension hybrid contract the chain's ante handler verifies — or
`tx.BroadcastHybridAndWait`, which also picks the sign-bytes form for the
target network (next section).

### Hybrid sign-bytes v1 / v2 (v0.8.2 / chain v3.2.0, testnet v3.1.98)

The ML-DSA-87 half of a hybrid tx signs B0 (the TxBody **without** the PQC
extension) and A (the AuthInfo bytes). The chain release that ships as
**v3.2.0** on mainnet (and was taken by the testnet under the earlier name
**v3.1.98**) added a second form of those sign-bytes:

```text
v1: BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A
v2: "qorechain-pqc-hybrid-v2" ‖ BE64(len chainID) ‖ chainID ‖ BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A
```

v2 adds a domain tag and binds the chain id, so the post-quantum signature
itself refuses to verify in any other context or on any other network. **Each
network verifies exactly one form at a time — there is no overlap window**; the
wrong form is refused with codespace `pqc` code `21` (`hybrid PQC signature
verification failed`).

- **Testnet** (`qorechain-diana`) applied the upgrade under the plan name
  `v3.1.98` at height 5,746,000 and verifies **only v2**.
- **Mainnet** (`qorechain-vladi`) verifies **only v1** and stays on v1 until its
  own governance upgrade, which applies the plan under the name `v3.2.0`; the
  SDK follows it automatically when that happens.
- Any other chain id starts on that release or later and verifies v2 from genesis.

**The switch has TWO plan names.** The chain registers one handler under both
(`x/pqc/types.SignBytesV2Upgrades`), and each network keeps the record of the
name it actually took: diana answers under `v3.1.98` forever, mainnet will
answer under `v3.2.0`. `signbytes.V2Upgrades` is that list, primary name first,
and `signbytes.V2Upgrade` is the primary name `"v3.2.0"` alone. A client that
asks for one name only resolves v1 on the other network, and every hybrid
transaction there is refused with `pqc` code 21 — which is exactly what
published clients up to v0.8.1 do.

**The auto rule** (`signbytes.Auto`, the default): an explicit `signbytes.V1` /
`signbytes.V2` is used as given; otherwise a non-legacy chain id is v2 with no
network call, and for `qorechain-vladi` / `qorechain-diana` the SDK asks the node
`GET {rest}/cosmos/upgrade/v1beta1/applied_plan/{name}` **for every name in
`signbytes.V2Upgrades`** (`v3.2.0`, then `v3.1.98`), stopping at the first whose
**numeric** `height` is greater than 0 — that means v2. `"0"`, `{}` or a missing
height counts as 0, and v1 is answered only when every name answers 0. Mainnet
after its own upgrade therefore costs one request and diana two. The answer (one
per resolve, not one per name) is cached per (REST URL, chain id) for 60 s
(`signbytes.ResolverOptions.TTL`; `Refresh` forces a new query,
`ClearCache` drops the cache). If a legacy chain has no REST URL, or the query
fails, resolution returns an error wrapping `signbytes.ErrUnresolvedVersion` —
it never guesses.

- The pure builders (`tx.BuildHybridTx`, `tx.BuildHybridMessages`,
  `unified.SignHybridEth`) take a `SignBytesVersion` field. Left empty on a
  legacy chain they **fail** rather than silently signing v1: resolve first.
- `tx.BroadcastHybridAndWait` (and `pqcdx.Client.MigrateToHybrid`) accept
  `Auto` + the REST URL and resolve for you. If an auto-resolved tx is refused
  with `pqc` code 21, the resolver is force-refreshed and, when it names the
  other form, the tx is re-signed and broadcast **once** more. An explicit
  version is never retried, and code 21 from another codespace (e.g. `sdk`
  "tx too large") is not treated as this case.
- `BuiltTx.SignBytesVersion` records the form a built tx used.

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"

// Resolve, then build (pure).
v, err := signbytes.Resolve(ctx, "https://api.qore.host", "qorechain-vladi", signbytes.Auto) // v1 today
// Note the order: restURL FIRST, then chainID. The other language bindings take
// (chainId, rest). Swapping them is refused with ErrUnresolvedVersion rather
// than silently answering v2 — the form mainnet refuses.
built, err := tx.BuildHybridMessages(tx.BuildHybridMessagesParams{
    /* account, keypair, messages, fee, chain id, account number, sequence */
    SignBytesVersion: v,
})

// Or resolve + sign + broadcast + one retry on a pqc 21 refusal.
out, err := tx.BroadcastHybridAndWait(tx.BroadcastHybridParams{
    Build:   tx.BuildHybridMessagesParams{ /* … SignBytesVersion left empty = auto */ },
    RestURL: "https://api-testnet.qore.host", // testnet → v2
})
fmt.Println(out.Built.SignBytesVersion, out.Retried)

// Override: force a form (no network call, no retry).
_ = signbytes.V1
```

The same package builds the other two sign-bytes that changed in the same
release, with
v1/v2 builders and a version dispatcher each: `signbytes.Migration` (both keys
of a `MsgMigratePQCKey` sign it; v2 binds the chain id, account, algorithms,
execution height and **both public keys**) and `signbytes.Bridge` (bridge
validator attestations; v2 adds the chain id). `signbytes.VersionFor(chainID,
appliedHeight)` mirrors the chain's own switch (pass the greatest height any of
`signbytes.V2Upgrades` answered).

### EVM authorisation window (v0.8.3 / chain v3.2.0)

From chain **v3.2.0** the EVM lane is no longer open by default. An EVM
transaction is admitted only from an account that has **both** a registered
post-quantum key **and** an open, unexhausted authorisation window. The testnet
(`qorechain-diana`) applied v3.2.0 at height 5,920,000, so the requirement is
live there now; mainnet gets it at its own upgrade height. Without a window the
chain refuses the transaction with

```text
account qor1… has no open EVM authorisation window; open one with
MsgOpenEVMWindow, signed on the Cosmos lane with the account's post-quantum key
```

A window is opened by an ordinary Cosmos-lane message — it travels the normal
hybrid signing path, so the classical key alone can never open one. That is the
whole point of the design: MetaMask and every other EVM client keep working
unmodified *inside* a window.

```go
import (
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

// 1. Authorise: 300 blocks, at most 5 transactions, at most 2,000,000 uqor.
open, err := messages.NewOpenEVMWindow(sender, 300, 5, "2000000")
// … hybrid-sign and broadcast `open` like any other message …

// 2. Read the status (200 with found:false when there is none, so polling is safe).
rest := query.NewRestClient("https://api-testnet.qore.host", nil)
status, err := rest.GetEVMWindowStatus(sender)
fmt.Println(status.Found, status.Live, status.RemainingTxs, status.RemainingValue)

// 3. Revoke early (takes effect in the same block).
closeMsg, err := messages.NewCloseEVMWindow(sender)
```

`messages.NewOpenEVMWindow` / `NewCloseEVMWindow` check the chain's
`ValidateBasic` bounds locally, so a wrong value costs nothing:
`blocks` in 1..`messages.MaxEVMWindowBlocks` (17280), `max_txs` in
1..`messages.MaxEVMWindowTxs` (1000), `max_value` a positive integer amount of
uqor. **Every field is required** — the chain refuses a missing one rather than
defaulting it. `messages.Pqc.OpenEVMWindow` / `Pqc.CloseEVMWindow` are the plain
composers (no validation) for callers that have already checked their input, and
both messages are registered in the interface registry like every other pqc
message.

`query.EVMWindowStatus` keeps every number exact: the counters are `uint64` and
`MaxValue` / `UsedValue` / `RemainingValue` are `math.Int` (cosmos.Int, arbitrary
precision) — never float64, which truncates above 2^53.
`query.ParseEVMWindowStatus` decodes a body you fetched yourself.

Refusals are classified by `tx.ClassifyEVMWindowError(err)` (or
`tx.ClassifyEVMWindowFailure(code, codespace, text)`), which returns
`tx.EVMWindowIssueNoWindow` (`pqc` 26), `…Exhausted` (27), `…Invalid` (28) or
`…NoPQCKey` — the *other* state code 28 carries, kept separate because the
remedy differs: register a key first, rather than open a window. Over the EVM
JSON-RPC the refusal arrives as a broadcast error carrying the chain's text and
no codespace, so the classifier matches on the text too. `Issue.Remedy()` is the
line a wallet can show.

**There is deliberately no automatic opening.** Nothing in the SDK silently
opens a window before a send: a window is an explicit authorisation the user
makes, and a wallet is expected to show it as such.

#### Three traps

1. **Ordering.** QoreChain unifies the identity, so the Cosmos sequence **is**
   the EVM nonce — and opening a window advances it (measured: nonce 2 before,
   3 after). The order is: **open the window, then read the nonce, then sign the
   EVM transaction.** Signing first gives `nonce too low`.
2. **`max_value` bounds value *plus* fees.** It counts the transferred value AND
   the maximum fee each admitted transaction could pay (gas limit × gas fee
   cap), because the holder of the classical key sets the gas price and a
   value-only bound would leave the account drainable through fees. Measured on
   the testnet: a 1,000 uqor transfer with a 21,000 gas limit at 112.5 gwei
   consumed **3,363 uqor** of the window. wei→uqor rounds **up**, so a series of
   sub-uqor transfers cannot drain a window that never appears to move.
3. **Never print "about 24 hours" for 17280 blocks.** The chain constant says so
   at 5s blocks, but no QoreChain network runs at 5s: the testnet is at ~1.03s
   (≈ 5 hours) and mainnet at ~3.1s (≈ 15 hours). Say "up to 17280 blocks", or
   compute the duration from the chain's recent block time.

#### Two other v3.2.0 rules worth knowing

- **`MsgSubmitBatch` settles only as the rollup's sequencer.** The sender must be
  `SequencerConfig.SequencerAddress`, falling back to the rollup's `Creator` when
  no sequencer is set; anyone else is refused with `ErrUnauthorized` ("%s may not
  settle batches for rollup %s"). Batches must extend the chain by index and
  cannot overwrite an existing one. `MsgPauseRollup`, `MsgResumeRollup` and
  `MsgStopRollup` now require the creator.
- **The x/ai per-sender rate limit is enforced.** It was declared but never
  applied before v3.2.0. Despite the field name `max_tx_per_minute`, the window
  is **30 blocks** (~31 s on the testnet, ~93 s on mainnet). A network born on
  this binary starts at the genesis default of 10; an upgraded one sits at 600,
  because the upgrade handler raises it so a relayer does not stall. Read the
  value from `qorechain.ai.v1.Query/Config` — never assume either number.

### Sidechains, paychains & rollups (v0.4.0)

The multilayer (sidechains/paychains) and `rdk` (rollup) modules are covered by
the typed composers in `qorechain/messages` and the typed gRPC query clients on
`query.GRPCClient`. Compose a write with `messages.Multilayer.*` /
`messages.Rdk.*`, broadcast it like any other message, and read layer/rollup
state through the query clients.

```go
import (
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
)

// Multilayer: register a sidechain / paychain, anchor state, route a tx.
register := messages.Multilayer.RegisterSidechain(
    acc.Address, "game-l2", "game sidechain", 0, 0, 0, 0, nil, nil)
route := messages.Multilayer.RouteTransaction(acc.Address, payload, "game-l2", 0, "")

// Rollups (rdk): create a rollup, submit a batch, execute a withdrawal.
create := messages.Rdk.CreateRollup(acc.Address, "r1", "default", "evm", 1)
withdraw := messages.Rdk.ExecuteWithdrawal(
    acc.Address, "r1", 0, 0, "qor1rcpt", "uqor", 100, [][]byte{{0x01}})

// Sign + broadcast them with tx.SendMessages (see above), then read state:
g, _ := query.NewGRPCClient("grpc.example:443")
defer g.Close()
layer, _ := g.Multilayer().Layer(ctx, &multilayerv1.QueryLayerRequest{LayerId: "game-l2"})
rollup, _ := g.Rdk().Rollup(ctx, &rdkv1.QueryRollupRequest{RollupId: "r1"})
chains, _ := g.Bridge().ChainConfigs(ctx, &bridgev1.QueryChainConfigsRequest{})
```

Chain v3.1.83 adds `Amm()`, `License()`, and `AbstractAccount()` typed query
clients, the `multilayer` `Anchor` / `Anchors` state-anchor queries, and
abstractaccount `RegisterAuthenticator` / `RevokeAuthenticator` message composers.

See the [multilayer](../../docs/docs/guides/multilayer.md) and
[rollups](../../docs/docs/guides/rollups.md) guides.

### AI pre-flight risk scoring (v0.5.0)

The `qorechain/evm` package exposes QoreChain's on-chain AI risk/anomaly model
over two EVM precompiles, so you get an advisory verdict on a transaction before
broadcasting it. `Client.SimulateWithRiskScore` bundles a gas estimate, the
`aiRiskScore` precompile (`0x…0B01`), and the `aiAnomalyCheck` precompile
(`0x…0B02`) into one `SimulateResult`.

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/evm"

ec := evm.NewClient("https://evm.example", nil)

res, err := ec.SimulateWithRiskScore(evm.SimulateTx{
    From: "0xSender", To: "0xContract", Data: calldata, Value: nil,
})
if err == nil && !res.Safe {
    // AI pre-flight flagged the transaction
}

// Or call the precompiles individually.
score, level, _ := ec.AIRiskScore(calldata)
anomalyScore, flagged, _ := ec.AIAnomalyCheck("0xSender", big.NewInt(1_000_000))
```

See the [AI pre-flight](../../docs/docs/guides/ai-preflight.md) guide.

### Unified cross-VM calls (v0.5.0)

The `qorechain/crossvm` package wraps `MsgCrossVMCall` so you can route a single
call — or several atomically in **one** transaction (`CallAtomic`) — across the
EVM, CosmWasm, and SVM VMs (`VMTypeEVM` / `VMTypeCosmWasm` / `VMTypeSVM`). The
payload is raw bytes (`Payload`) or a JSON-serializable CosmWasm message
(`Cosmwasm`, which is `json.Marshal`'d to UTF-8).

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/crossvm"

xvm := crossvm.New(crossvm.Signer{
    Account: acc, ChainID: "qorechain-vladi", RestURL: "https://rest.example",
    AccountNumber: accountNumber, Sequence: sequence, Fee: fee,
}, crossvm.Options{Query: g.CrossVM()})

// Single call into a CosmWasm contract (Cosmwasm is JSON-encoded).
res, _ := xvm.Call(crossvm.CallOptions{
    TargetVM: crossvm.VMTypeCosmWasm, TargetContract: "qor1contract…",
    Cosmwasm: map[string]any{"increment": map[string]any{}},
})

// Atomic triple-VM batch in ONE tx.
atomic, _ := xvm.CallAtomic([]crossvm.CallOptions{
    {TargetVM: crossvm.VMTypeEVM, TargetContract: "0xC…", Payload: abiCalldata},
    {TargetVM: crossvm.VMTypeSVM, TargetContract: "Prog…", Payload: rawBytes},
    {TargetVM: crossvm.VMTypeCosmWasm, TargetContract: "qor1…", Cosmwasm: map[string]any{"stake": map[string]any{}}},
})

built, _ := xvm.BuildCall(crossvm.CallOptions{TargetVM: crossvm.VMTypeEVM, TargetContract: "0xC…", Payload: rawBytes})
status, _ := xvm.GetMessage("42") // read a routed message's status
_ = (res, atomic, built, status)
```

**The callee's answer (chain v3.1.97).** A call executes inside the transaction
by default and returns its result in the Msg response; decode it from the
confirmed tx:

```go
out, _ := crossvm.DecodeCallResult(res)
out.MessageID // the chain's id for the cross-VM message
out.Executed  // false for a queued (async) call — the result is not known yet
out.Data      // the callee's return value
out.GasUsed   // gas the callee's execution consumed

// N calls in one tx: results come back in message order.
all, _ := crossvm.DecodeCallResults(atomic)
```

**`Async`.** `CallOptions.Async` queues the call for a later `ProcessQueue`
dispatch instead of running it now. The default (`false`) executes it in this
transaction and returns the answer, which is what a caller that needs the result
wants; with `Async: true` the response carries only the message id (`Executed`
false, no `Data`) and the outcome is polled with `GetMessage`. It is per call, so
one `CallAtomic` batch may mix queued and inline calls.

**`SourceVM` is ignored by the chain.** The origin lane is derived from the
execution context — a caller naming its own lane is not evidence of what it is.
The field is still sent and still defaults to `evm` so older nodes keep working;
setting it changes nothing on a current chain and can never claim a lane the
caller is not on.

See the [cross-VM](../../docs/docs/guides/cross-vm.md) guide.

### Quantum-safe DX (v0.5.0)

The `qorechain/pqcdx` package makes a dApp PQC-protected in one idempotent call:
check whether the signer's Dilithium key is registered, register it if not, then
sign hybrid (ML-DSA-87 + secp256k1).

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqcdx"

// Read-only status (over the qor_ namespace).
registered, _ := pqcdx.IsPQCRegistered(c.Qor, acc.Address)
status, _ := pqcdx.GetPQCStatus(c.Qor, acc.Address)

pdx := pqcdx.New(pqcdx.Signer{ /* account + key material + ctx */ }, pqcdx.Options{Qor: c.Qor})
ensure, _ := pdx.EnsurePQCRegistered(pqcdx.RegisterOptions{}) // registers only if missing
hybrid, _ := pdx.MigrateToHybrid(messages, pqcdx.MigrateToHybridOptions{})
rotate, _ := pdx.MigratePQCKey(pqcdx.MigrateOptions{ /* new key */ })
_ = (registered, status, ensure, hybrid, rotate)
```

See the [quantum-safe](../../docs/docs/guides/quantum-safe.md) guide.

### Unified eth-native wallet (v0.6.0)

One `eth_secp256k1` key = ONE 20-byte identity rendered three ways — `qor1…`
(bech32), `0x…` (EIP-55), and SVM base58 (the 20 bytes right-padded with 12 zero
bytes to 32). A deposit to any of the three lands in the **same** balance, and the
key spends on **all** lanes. `unified.DeriveUnifiedAccount` uses the Ethereum HD
path (`m/44'/60'/0'/0/{index}`); `unified.UnifiedAccountFromSeed` builds one
directly from a 32-byte secret. `unified.AddressesFrom20` / `unified.QoreAddresses`
convert between the three encodings. The legacy coin-type-118
`accounts.DeriveNativeAccount` still works (additive).

Native-lane signing over the eth key: `unified.SignClassicalEth` is a classical
secp256k1 signature over `keccak256(SignDoc)` with pubkey type
`/cosmos.evm.crypto.v1.ethsecp256k1.PubKey`; `unified.SignHybridEth` adds the
ML-DSA-87 post-quantum signature. Account parsing accepts eth_secp256k1 public keys.

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/unified"

account, _ := unified.DeriveUnifiedAccount(mnemonic, 0)
account.Cosmos // "qor1…"    — QoreChain Native lane
account.Evm    // "0x…"      — EIP-55 checksummed
account.Svm    // "<base58>" — 20 bytes + 12 zero pad

// Sign a QoreChain Native tx from the unified eth key (hybrid PQC path).
// The sign-bytes form is per network (see "Hybrid sign-bytes v1 / v2").
v, _ := signbytes.Resolve(ctx, "https://api.qore.host", "qorechain-vladi", signbytes.Auto)
txBytes, _ := unified.SignHybridEth(unified.EthSignParams{
    Account:          account,
    ChainID:          "qorechain-vladi",
    AccountNumber:    accountNumber,
    Sequence:         sequence,
    Messages:         messages,
    Fee:              fee,
    SignBytesVersion: v,
})
```

`UnifiedAccountFromSeed` takes the account's **private key**: pass real secret
entropy (32 CSPRNG bytes, or a secret only the owner holds). Never derive that
seed from a wallet signature or any other value a third party can request.

> **Removed in v0.8.0 — `unified.UnifiedAccountFromPhantomSignature`.** It now
> returns an error and derives no account. Turning a browser-wallet signature
> into a spend key is unsafe: the signature is a bearer secret any page can ask
> the wallet for, so whoever obtains it controls the account. To spend with an
> external wallet key, keep the key external and use the **authenticator lanes**
> below — register it with `MsgRegisterAuthenticator`, then spend via
> `MsgExecuteCosmos` / `MsgExecuteEVM`. Any account previously derived this way
> must be treated as exposed: move its funds.

See the [unified-wallet](../../docs/docs/guides/unified-wallet.md) guide.

## Authenticator lanes (v0.7.0 / chain v3.1.85)

A linked external key — a Phantom **ed25519** key, or a MetaMask **secp256k1**
key bound **by address** — spends from the ONE canonical PQC account through a
**relayer** that submits the tx and pays the fee (its own hybrid-PQC signature
satisfies the ante). The external key **never produces an ML-DSA co-signature**;
its signature over the domain-separated, replay-bound sign-bytes **is** the
authorization, under least-privilege, spending-limit and revocable terms
enforced on-chain.

Three messages carry the lanes, each with a composer in the `messages` package:

- `MsgExecuteEVM` (`/qorechain.abstractaccount.v1.MsgExecuteEVM`) —
  `messages.AbstractAccount.ExecuteEVM`
- `MsgExecuteCosmos` (`/qorechain.abstractaccount.v1.MsgExecuteCosmos`) —
  `messages.AbstractAccount.ExecuteCosmos`
- `MsgRotatePQCKey` (`/qorechain.pqc.v1.MsgRotatePQCKey`) —
  `messages.Pqc.RotatePQCKey`

**Sign-bytes helpers** (`authenticator` package) rebuild the exact digest the
chain re-derives: `authenticator.EVMAuthSignBytes` / `CosmosAuthSignBytes`
(32-byte SHA-256 digests) and `RotationSignBytes` (the domain-separated string
both keys sign).

**NONCE semantics:**

- `MsgExecuteEVM.Nonce` = the account's **current EVM nonce** (the relayer is a
  different account than the owner, so its envelope does **not** bump the
  account's nonce — pass it as-is, do **not** `+1`).
- `MsgExecuteCosmos.Nonce` = the **per-authenticator sequence** for
  `(account, pubkey)`, a store counter distinct from the account's own sequence.

**Permission taxonomy & errors.** Query the on-chain permission schema via
`client.AbstractAccount().PermissionSchema(ctx, &QueryPermissionSchemaRequest{})`
and compare an action to it before submitting. `tx.DecodeTxError` surfaces the
lane failures — codespace `abstractaccount`: `5` SpendingLimitExceeded, `6`
SessionKeyExpired, `10` PermissionDenied, `11` AuthenticatorReplay; codespace
`pqc`: `21` HybridVerifyFailed.

**Key rotation.** `authenticator.RotatePQCKeyMsgFromMnemonic` migrates a legacy
`shake256(mnemonic)` key to the canonical, address-bound key (dual-signs over
`RotationSignBytes`); `authenticator.DerivePQCLegacy` re-derives the old key for
the old-key half.

```go
import (
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/authenticator"
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
)

// Phantom ed25519 authenticator authorizes an EVM spend from the canonical
// account; the relayer broadcasts and pays. nonce = the account's CURRENT EVM
// nonce (relayer != owner -> no +1).
digest := authenticator.EVMAuthSignBytes(
    "qorechain-diana", "qor1canonical…", phantomPubkey, // 32-byte ed25519
    "0xRecipient…", "1000000000000000000",              // 1 QOR in aqor (wei)
    nil, currentEVMNonce,
)
signature := phantomSign(digest[:]) // your wallet signs the raw 32 bytes
execMsg := messages.AbstractAccount.ExecuteEVM(
    "qor1relayer…", "qor1canonical…", "ed25519", phantomPubkey, signature,
    "0xRecipient…", "1000000000000000000", nil, 100000, currentEVMNonce,
)

// Migrate a legacy shake256(mnemonic) key to the address-bound key.
res, _ := authenticator.RotatePQCKeyMsgFromMnemonic(
    "qor1canonical…", mnemonic, "qorechain-diana", 1,
    authenticator.DerivationLegacy, authenticator.DerivationCanonical,
)
_ = res.Msg // *pqcv1.MsgRotatePQCKey, broadcast BY the account, hybrid-cosigned
```

See the [authenticators](../../docs/docs/guides/authenticators.md) guide.

## Development

```sh
cd packages/go
go build ./...
go test ./...
go vet ./...
gofmt -l .
```
