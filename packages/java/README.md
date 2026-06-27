# QoreChain Java SDK

Java SDK for QoreChain with full native-chain parity to the TypeScript, Python,
Go, and Rust SDKs:

- **networks** — `Networks.get("testnet" | "mainnet")` presets (`qorechain-diana`
  / `qorechain-vladi`), bech32 prefixes, `QOR`/`uqor` coin, and per-VM endpoints.
- **denom / address** — exact `BigInteger` `toBase`/`fromBase`, bech32 ↔ hex,
  EIP-55 checksum, EVM/SVM address validators.
- **accounts** — HD derivation for native (secp256k1, `m/44'/118'/0'/0/i`), EVM
  (secp256k1, `m/44'/60'/0'/0/i`), and SVM (ed25519 SLIP-0010,
  `m/44'/501'/i'/0'`). BIP-39 mnemonic generation/validation/seed.
- **pqc** — ML-DSA-87 (FIPS-204) keygen / sign / verify via BouncyCastle, plus
  the hybrid-signature extension builder.
- **messages** — committed `protobuf-java` classes for all QoreChain modules, a
  `typeUrl → parser` registry covering all 49 custom `Msg` types, typed composers,
  and Cosmos-style `Any` pack/unpack.
- **tx** — native `bankSend` builder, hybrid (classical + PQC) transaction
  signing, gas/fee helpers, ABCI error decoding, broadcast, and `waitForTx`.
- **query** — `RestClient` (Cosmos + 8 custom routes), `JsonRpcClient`
  (EVM `eth_*`), `QorClient` (25 `qor_*` methods).
- **subscribe** — WebSocket `subscribeNewBlocks` / `subscribeTx`.
- **multilayer / rdk** — typed composers and `MultilayerQueryClient` /
  `RdkQueryClient` / `BridgeQueryClient` for sidechains, paychains, and rollups
  (v0.4.0).
- **crossvm** — `CrossVMClient`: unified cross-VM calls (single + atomic
  triple-VM) over `MsgCrossVMCall` (v0.5.0).
- **evm** — `EvmPrecompiles`: AI pre-flight risk/anomaly scoring (v0.5.0).
- **pqc** — `PqcDx`: quantum-safe DX (idempotent registration + classical→hybrid
  migration) (v0.5.0).

## Coordinates

```
io.github.qorechain:qorechain-sdk:0.3.0
```

Base Java package: `io.github.qorechain` (sub-packages `networks`, `accounts`,
`pqc`, `denom`, `address`, `tx`, `query`, `messages`, `subscribe`, `utils`).
Generated protobuf classes live under the `qorechain.*` / `cosmos.*` packages.

## Build & test

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || echo /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home)"
./gradlew build test            # compile + run the JUnit 5 suite
./gradlew publishToMavenLocal   # validate packaging (main + sources + javadoc jars)
```

## Sidechains, paychains & rollups (v0.4.0)

The multilayer (sidechains/paychains) and `rdk` (rollup) modules are covered by
the typed composers under `QorechainMessages.multilayer` / `QorechainMessages.rdk`
and the typed query clients. Build the proto `Msg`, wrap it with the composer into
a `TypedMessage`, sign/broadcast it like any other message, and read layer/rollup
state through the query clients.

```java
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.query.MultilayerQueryClient;
import io.github.qorechain.query.RdkQueryClient;
import io.github.qorechain.query.BridgeQueryClient;

// Compose a rollup-creation message.
TypedMessage create = QorechainMessages.rdk.createRollup(
        qorechain.rdk.v1.Tx.MsgCreateRollup.newBuilder()
                .setCreator(account.address()).setRollupId("r1")
                .setProfile("default").setVmType("evm").setStakeAmount(1)
                .build());

// Compose a sidechain registration.
TypedMessage register = QorechainMessages.multilayer.registerSidechain(
        qorechain.multilayer.v1.Tx.MsgRegisterSidechain.newBuilder()
                .setCreator(account.address()).setLayerId("game-l2")
                .setDescription("game sidechain").build());

// Read layer / rollup / bridge state (over the ABCI query transport).
var ml = new MultilayerQueryClient("http://localhost:26657");
var layer = ml.layer("game-l2");
var layers = ml.layers();
var stats = ml.routingStats();

var rdk = new RdkQueryClient("http://localhost:26657");
var rollup = rdk.rollup("r1");
var batch = rdk.latestBatch("r1");

var bridge = new BridgeQueryClient("http://localhost:26657");
var chains = bridge.chainConfigs();
```

See the [multilayer](../../docs/docs/guides/multilayer.md) and
[rollups](../../docs/docs/guides/rollups.md) guides.

## AI pre-flight risk scoring (v0.5.0)

`EvmPrecompiles` exposes QoreChain's on-chain AI risk/anomaly model over two EVM
precompiles, so you get an advisory verdict on a transaction before broadcasting
it. `simulateWithRiskScore` bundles a gas estimate, the `aiRiskScore` precompile
(`AI_RISK_SCORE_ADDRESS`, `0x…0B01`), and the `aiAnomalyCheck` precompile
(`AI_ANOMALY_CHECK_ADDRESS`, `0x…0B02`) into one `Preflight`.

```java
import io.github.qorechain.evm.EvmPrecompiles;
import io.github.qorechain.query.JsonRpcClient;

JsonRpcClient rpc = new JsonRpcClient("https://evm.example");

EvmPrecompiles.PreflightTx tx = new EvmPrecompiles.PreflightTx();
tx.from = "0xSender";
tx.to = "0xContract";
tx.data = "0x...";
EvmPrecompiles.Preflight verdict = EvmPrecompiles.simulateWithRiskScore(rpc, tx);
if (!verdict.safe) { /* AI pre-flight flagged the transaction */ }

// Or call the precompiles individually.
EvmPrecompiles.RiskScore risk = EvmPrecompiles.aiRiskScore(rpc, new byte[]{(byte) 0xde});
EvmPrecompiles.Anomaly anomaly =
        EvmPrecompiles.aiAnomalyCheck(rpc, "0xSender", java.math.BigInteger.valueOf(1_000_000));
```

See the [AI pre-flight](../../docs/docs/guides/ai-preflight.md) guide.

## Unified cross-VM calls (v0.5.0)

`CrossVMClient` wraps `MsgCrossVMCall` so you can route a single call — or several
atomically in **one** transaction (`callAtomic`) — across the EVM, CosmWasm, and
SVM VMs (`CrossVMClient.VMType.EVM` / `.COSMWASM` / `.SVM`). The payload is raw
bytes (`payload`) or a JSON-serializable CosmWasm object (`cosmwasm`, which is
serialized to UTF-8 JSON via Jackson).

```java
import io.github.qorechain.crossvm.CrossVMClient;
import java.util.List;
import java.util.Map;

CrossVMClient xvm = new CrossVMClient(signer, broadcaster, qor);

// Single call into a CosmWasm contract (cosmwasm is JSON-encoded).
CrossVMClient.CallOptions cw = new CrossVMClient.CallOptions();
cw.targetVm = CrossVMClient.VMType.COSMWASM;
cw.targetContract = "qor1contract…";
cw.cosmwasm = Map.of("increment", Map.of());
var res = xvm.call(cw);

// Atomic triple-VM batch in ONE tx.
CrossVMClient.CallOptions evm = new CrossVMClient.CallOptions();
evm.targetVm = CrossVMClient.VMType.EVM;
evm.targetContract = "0xC…";
evm.payload = abiCalldata;
var atomic = xvm.callAtomic(List.of(evm, cw));

var msg = xvm.buildCall(evm);     // build-only TypedMessage
var status = xvm.getMessage("42"); // read a routed message's status
```

See the [cross-VM](../../docs/docs/guides/cross-vm.md) guide.

## Quantum-safe DX (v0.5.0)

`PqcDx` makes a dApp PQC-protected in one idempotent call: check whether the
signer's Dilithium key is registered, register it if not, then sign hybrid
(ML-DSA-87 + secp256k1).

```java
import io.github.qorechain.pqc.PqcDx;
import io.github.qorechain.query.QorClient;

QorClient qor = new QorClient("https://evm.example");

// Read-only status (over the qor_ namespace).
boolean registered = PqcDx.isPqcRegistered(qor, account.address());
PqcDx.PqcStatus status = PqcDx.getPqcStatus(qor, account.address());

// Idempotent: registers the signer's Dilithium key only if it isn't already.
PqcDx.EnsureResult ensure =
        PqcDx.ensurePqcRegistered(signer, broadcaster, qor, new PqcDx.EnsureOptions());

// Migrate a classical account to hybrid signing, then sign hybrid.
PqcDx.HybridSendPath path =
        PqcDx.migrateToHybrid(signer, broadcaster, qor, new PqcDx.EnsureOptions());

// Rotate an account's on-chain PQC key (MsgMigratePQCKey).
PqcDx.migratePqcKey(signer, broadcaster, new PqcDx.MigrateOptions());
```

See the [quantum-safe](../../docs/docs/guides/quantum-safe.md) guide.

## Regenerating the protobuf classes

The generated protobuf-java classes are **committed**, so consumers need neither
`buf` nor `protoc`. To regenerate after the vendored protos change (requires
`buf` and network access to the public schema registry):

```bash
../../scripts/codegen-java.sh
```

## Publishing to Maven Central (controller only)

Publishing uses the
[`com.vanniktech.maven.publish`](https://github.com/vanniktech/gradle-maven-publish-plugin)
plugin targeting the **Central Portal**. Do **not** commit credentials. The
controller supplies them via `~/.gradle/gradle.properties` or environment, then
runs:

```bash
./gradlew publishAndReleaseToMavenCentral   # or: publishToMavenCentral (no auto-release)
```

Required properties (Gradle property names; the `ORG_GRADLE_PROJECT_<name>` env
form works too):

| Property | Purpose |
| --- | --- |
| `mavenCentralUsername` | Central Portal token username |
| `mavenCentralPassword` | Central Portal token password |
| `signingInMemoryKey` | ASCII-armored PGP private key (in-memory signing) |
| `signingInMemoryKeyPassword` | passphrase for the signing key |

Signing is enabled automatically when a signing key property is present;
`publishToMavenLocal` still succeeds without a key so packaging can be validated.
