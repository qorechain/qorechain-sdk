# qorechain-sdk (Go)

Idiomatic Go SDK for QoreChain — network presets, denomination/address utilities,
HD account derivation (native / EVM / SVM), post-quantum (ML-DSA-87) signing, read
clients for the REST (LCD) and `qor_*` JSON-RPC surfaces, the full native-chain
message set (49 custom messages across 11 modules + the standard Cosmos modules),
typed gRPC query clients, complete transaction lifecycle (auto-gas, error
decoding, tracking, search), utilities, and WebSocket subscriptions.

This is a self-contained Go module within the `qorechain-sdk` monorepo. It mirrors
the TypeScript and Python SDK surfaces for the native chain.

### Out of scope

Browser-wallet integrations and the EVM/SVM execution adapters are intentionally
not part of the Go SDK — Go services talk to the EVM and SVM layers with the
established libraries ([go-ethereum](https://github.com/ethereum/go-ethereum) and
[solana-go](https://github.com/gagliardetto/solana-go)). The Go SDK focuses on the
native (Cosmos SDK) chain surface, including hybrid post-quantum transactions.

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
| `qorechain/messages` | Interface registry/codec + typed composers for all 49 custom messages and the standard Cosmos modules. |
| `qorechain/tx` | Build/sign/broadcast (classical + hybrid PQC), auto-gas, error decoding, tracking/retry, tx & block search. |
| `qorechain/proto` | Generated gogoproto Go types for every chain module (committed; regenerate with `scripts/codegen-go.sh`). |
| `qorechain/utils` | Hashing (sha256/keccak256/ripemd160), unit conversion, EVM/SVM address validation + EIP-55. |
| `qorechain/subscribe` | WebSocket client for the chain RPC `/websocket` (new blocks, transactions). |
| `qorechain/crossvm` | Unified cross-VM call helper over `MsgCrossVMCall` (single + atomic triple-VM). |
| `qorechain/evm` | AI pre-flight risk/anomaly scoring over the EVM precompiles (`eth_call`). |
| `qorechain/pqcdx` | Quantum-safe DX: idempotent PQC-key registration + classical→hybrid migration. |

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

ext, _ := pqc.BuildHybridSignatureExtension(pqc.AlgorithmDilithium5, sig, kp.PublicKey)
// ext marshals to {"algorithm_id":1,"pqc_signature":"<base64>","pqc_public_key":"<base64>"}
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

// Compose any message (custom or standard Cosmos) with the typed composers.
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
exclude-extension hybrid contract the chain's ante handler verifies.

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

## Development

```sh
cd packages/go
go build ./...
go test ./...
go vet ./...
gofmt -l .
```
