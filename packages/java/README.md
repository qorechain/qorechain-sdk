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
  and Native `Any` pack/unpack.
- **tx** — native `bankSend` builder, hybrid (classical + PQC) transaction
  signing with per-network sign-bytes v1/v2 (`SignBytes`, `SignBytesResolver`),
  gas/fee helpers, ABCI error decoding, broadcast, and `waitForTx`.
- **query** — `RestClient` (Native + 8 custom routes), `JsonRpcClient`
  (EVM `eth_*`), `QorClient` (25 `qor_*` methods).
- **subscribe** — WebSocket `subscribeNewBlocks` / `subscribeTx`.
- **multilayer / rdk** — typed composers and `MultilayerQueryClient` /
  `RdkQueryClient` / `BridgeQueryClient` for sidechains, paychains, and rollups
  (v0.4.0). Chain v3.1.83 adds `AmmQueryClient` / `LicenseQueryClient` /
  `AbstractAccountQueryClient`, the `multilayer` `anchor` / `anchors` state-anchor
  queries, and abstractaccount `registerAuthenticator` / `revokeAuthenticator`
  composers.
- **crossvm** — `CrossVMClient`: unified cross-VM calls (single + atomic
  triple-VM) over `MsgCrossVMCall` (v0.5.0).
- **evm** — `EvmPrecompiles`: AI pre-flight risk/anomaly scoring (v0.5.0).
- **pqc** — `PqcDx`: quantum-safe DX (idempotent registration + classical→hybrid
  migration) (v0.5.0).

## Coordinates

```
io.github.qorechain:qorechain-sdk:0.8.0
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

**Sync by default, async on request (chain v3.1.97).** A call executes inside the
transaction and returns the callee's answer. Set `opts.async = true` to queue it for
a later `ProcessQueue` dispatch instead — nothing has run yet then, and only the
message id is meaningful. The decoded `MsgCrossVMCallResponse` carries `executed`,
`data` (the callee's return value) and `gasUsed` alongside `messageId`:

```java
// Per-message responses only come back from a COMMIT broadcast — a sync broadcast
// returns before the messages have run.
signer.broadcastMode = Broadcaster.Mode.COMMIT;
var result = xvm.call(cw);
for (CrossVMClient.CallResponse r : CrossVMClient.decodeCallResponses(result)) {
    r.messageId; r.executed; r.data; r.gasUsed;
}
```

`sourceVm` is still accepted but the chain **ignores** it: the origin lane is derived
from the execution context, not from what the caller claims to be. It is retained so
older clients are not rejected.

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

## Hybrid sign-bytes v1 / v2 (v0.8.0 / chain v3.1.98)

The ML-DSA-87 half of a hybrid transaction signs a byte string built from `B0`
(the tx body WITHOUT the PQC extension) and `A` (the auth-info bytes). There are
two forms, and **each network verifies exactly one at any height** (no overlap):

| Form | Bytes | Verified by |
|---|---|---|
| v1 | `BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A` | a network that has not applied `v3.1.98` — **mainnet `qorechain-vladi` today** |
| v2 | `"qorechain-pqc-hybrid-v2" ‖ BE64(len chainId) ‖ chainId ‖ BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A` | testnet `qorechain-diana` (since height 5,746,000) and every network born on v3.1.98+ |

v2 adds a domain tag (so a signature made in another context can never pass as a
transaction signature) and binds the chain id (so the post-quantum signature
itself refuses to verify on another network). Mainnet stays on v1 until its own
governance upgrade to v3.1.98; after that the same code signs v2 automatically.

**The auto rule** (`SignBytes.Mode.AUTO`, the default in `PqcDx`):

1. chain id not `qorechain-vladi` / `qorechain-diana` → v2, no network call;
2. otherwise `GET {restUrl}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98` →
   `{"height":"<n>"}`: `n > 0` → v2, `"0"` or no height → v1;
3. no `restUrl`, or the query fails → `SignBytesResolutionException` (it never
   guesses; pass a `restUrl` or an explicit version).

Answers are cached per `(restUrl, chainId)` for 60 s (`new SignBytesResolver(ttlMs)`
to change; `resolve(..., true)` forces a refresh; `clearCache()` empties it).

**Override:** `SignBytes.Mode.V1` / `V2` (or `HybridTx.Options.signBytesVersion` /
`SignEth.Options.signBytesVersion`) forces a form with no network call.

The pure builders `HybridTx.buildHybridTx` and `SignEth.signHybridEth` never touch
the network: set `signBytesVersion` explicitly. If it is left `null` on a legacy
chain id they throw `IllegalStateException` instead of silently signing v1; on any
other chain id they use v2. The form used is reported on `Built.signBytesVersion`.

`PqcDx.HybridSendPath.send` resolves the version per `Signer.signBytesMode` /
`Signer.restUrl`. In AUTO mode, if the network refuses the tx with `pqc` code 21
(`hybrid PQC signature verification failed` — e.g. the network upgraded while the
answer was cached), it force-refreshes the version, re-signs **once** and
re-broadcasts **once**, then surfaces any error. An explicit V1/V2 never retries.

```java
import io.github.qorechain.tx.HybridTx;
import io.github.qorechain.tx.SignBytes;
import io.github.qorechain.tx.SignBytesResolver;

// Low level: resolve, then build.
HybridTx.Options opts = /* messages, keys, fee, chainId, accountNumber, sequence */;
opts.signBytesVersion = SignBytesResolver.shared()
        .resolve(SignBytes.Mode.AUTO, opts.chainId, "https://api-testnet.qore.host");
HybridTx.Built built = HybridTx.buildHybridTx(opts);
built.signBytesVersion; // V2 on testnet today, V1 on mainnet

// High level: PqcDx resolves (and retries once on pqc code 21) for you.
signer.signBytesMode = SignBytes.Mode.AUTO;           // default
signer.restUrl = "https://api.qore.host";             // needed for vladi / diana
PqcDx.migrateToHybrid(signer, broadcaster, qor, null).send(messages);
```

The same per-network rule applies to the other two post-quantum payloads, which
`SignBytes` also builds: key migration (`SignBytes.migration`, v1 ASCII
`qorechain-key-migration:chain=…:from=…:to=…:account=…:height=…` / v2
`"qorechain-key-migration-v2"` binding both public keys) and bridge attestations
(`SignBytes.bridge`, v1 `chain|eventType|operationId|txHash|amount|asset` / v2
`"qorechain-bridge-attestation-v2"` with BE64-length-prefixed fields led by the
chain id). `SignBytes.versionFor(chainId, appliedHeight)` is the pure decision
function; `SignBytes.isHybridVerifyRejection` detects the refusal.

`HybridTx.frame(b0, auth)` (which always built v1) is removed in v0.8.0; use
`HybridTx.frame(version, chainId, b0, auth)`.

## Unified eth-native wallet (v0.6.0)

One `eth_secp256k1` key = ONE 20-byte identity rendered three ways — `qor1…`
(bech32), `0x…` (EIP-55), and SVM base58 (the 20 bytes right-padded with 12 zero
bytes to 32). A deposit to any of the three lands in the **same** balance, and the
key spends on **all** lanes. `UnifiedAccounts.deriveUnifiedAccount` uses the
Ethereum HD path (`m/44'/60'/0'/0/{index}`); `UnifiedAccounts.unifiedAccountFromSeed`
builds one directly from a 32-byte secret. `UnifiedAccounts.addressesFrom20` /
`UnifiedAccounts.qoreAddresses` convert between the three encodings. The legacy
coin-type-118 `Accounts.deriveNativeAccount` still works (additive).

Native-lane signing over the eth key: `SignEth.signClassicalEth` is a classical
secp256k1 signature over `keccak256(SignDoc)` with pubkey type
`/cosmos.evm.crypto.v1.ethsecp256k1.PubKey`; `SignEth.signHybridEth` adds the
ML-DSA-87 post-quantum signature. Account parsing accepts eth_secp256k1 public keys.

```java
import io.github.qorechain.accounts.UnifiedAccounts;
import io.github.qorechain.accounts.UnifiedAccounts.UnifiedAccount;
import io.github.qorechain.tx.SignBytes;
import io.github.qorechain.tx.SignBytesResolver;
import io.github.qorechain.tx.SignEth;

UnifiedAccount account = UnifiedAccounts.deriveUnifiedAccount(mnemonic, 0);
account.cosmos; // "qor1…"    — QoreChain Native lane
account.evm;    // "0x…"      — EIP-55 checksummed
account.svm;    // "<base58>" — 20 bytes + 12 zero pad

// Sign a QoreChain Native tx from the unified eth key (hybrid PQC path).
SignEth.Options opts = new SignEth.Options();
opts.messages = messages;
opts.secp256k1PrivateKey = account.privateKey;
opts.secp256k1PublicKey = account.publicKey;
opts.pqcKeypair = account.pqc;
opts.chainId = "qorechain-vladi";
opts.accountNumber = accountNumber;
opts.sequence = sequence;
opts.fee = fee;
// The form this network verifies (see "Hybrid sign-bytes v1 / v2" above).
opts.signBytesVersion =
        SignBytesResolver.shared().resolve(SignBytes.Mode.AUTO, opts.chainId, "https://api.qore.host");
SignEth.Built built = SignEth.signHybridEth(opts);
```

> **Removed in v0.8.0 — `unifiedAccountFromPhantomSignature` now throws.** It
> derived the account's spend key from a wallet signature. A wallet signature is a
> bearer secret — any page can ask the wallet for it — so whoever obtained it
> controlled the account. To let an external wallet key act for an account, use the
> **authenticator lanes** below: register the key with `MsgRegisterAuthenticator`
> and spend via `MsgExecuteCosmos` / `MsgExecuteEVM`. Any account previously
> derived this way must be treated as exposed — move its funds.
>
> The seed passed to `UnifiedAccounts.unifiedAccountFromSeed` **is** the private
> key: it must be real secret entropy, never a wallet signature or any value a
> third party can request.

See the [unified-wallet](../../docs/docs/guides/unified-wallet.md) guide.

## Authenticator lanes (v0.7.0 / chain v3.1.85)

A linked external key — a Phantom **ed25519** key, or a MetaMask **secp256k1**
key bound **by address** — spends from the ONE canonical PQC account through a
**relayer** that submits the tx and pays the fee (its own hybrid-PQC signature
satisfies the ante). The external key **never produces an ML-DSA co-signature**;
its signature over the domain-separated, replay-bound sign-bytes **is** the
authorization, under least-privilege, spending-limit and revocable terms
enforced on-chain.

Three messages carry the lanes:

- `MsgExecuteEVM` (`/qorechain.abstractaccount.v1.MsgExecuteEVM`) — built by
  `Authenticator.executeEvmMsg`
- `MsgExecuteCosmos` (`/qorechain.abstractaccount.v1.MsgExecuteCosmos`) — built
  by `Authenticator.executeCosmosMsg`
- `MsgRotatePQCKey` (`/qorechain.pqc.v1.MsgRotatePQCKey`) — composer
  `QorechainMessages.pqc.rotatePqcKey`

**Sign-bytes helpers** rebuild the exact digest the chain re-derives:
`Authenticator.evmAuthSignBytes` / `Authenticator.cosmosAuthSignBytes` (32-byte
SHA-256 digests) and `Authenticator.rotationSignBytes` (the domain-separated
string both keys sign).

**NONCE semantics:**

- `MsgExecuteEVM.nonce` = the account's **current EVM nonce** (the relayer is a
  different account than the owner, so its envelope does **not** bump the
  account's nonce — pass it as-is, do **not** `+1`).
- `MsgExecuteCosmos.nonce` = the **per-authenticator sequence** for
  `(account, pubkey)`, a store counter distinct from the account's own sequence.

**Permission taxonomy & errors.** Query the on-chain permission schema with
`new AbstractAccountQueryClient(url).permissionSchema()` and compare an action to
it before submitting. `TxError.decode` surfaces the lane failures — codespace
`abstractaccount`: `5` SpendingLimitExceeded, `6` SessionKeyExpired, `10`
PermissionDenied, `11` AuthenticatorReplay; codespace `pqc`: `21`
HybridVerifyFailed.

**Key rotation.** `Authenticator.rotatePqcKeyMsgFromMnemonic` migrates a legacy
`shake256(mnemonic)` key to the canonical, address-bound key (dual-signs over
`rotationSignBytes`); `Authenticator.derivePqcLegacy` re-derives the old key for
the old-key half.

```java
import io.github.qorechain.tx.Authenticator;
import io.github.qorechain.messages.TypedMessage;

// Phantom ed25519 authenticator authorizes an EVM spend from the canonical
// account; the relayer broadcasts and pays. nonce = the account's CURRENT EVM
// nonce (relayer != owner -> no +1).
byte[] digest = Authenticator.evmAuthSignBytes(
        "qorechain-diana", "qor1canonical…", phantomPubkey, // 32-byte ed25519
        "0xRecipient…", "1000000000000000000",              // 1 QOR in aqor (wei)
        new byte[0], currentEvmNonce);
byte[] signature = phantomSign(digest); // your wallet signs the raw 32 bytes
TypedMessage execMsg = Authenticator.executeEvmMsg(
        "qor1relayer…", "qor1canonical…", "ed25519", phantomPubkey, signature,
        "0xRecipient…", "1000000000000000000", new byte[0], 100000L, currentEvmNonce);

// Migrate a legacy shake256(mnemonic) key to the address-bound key.
Authenticator.RotationResult rotation =
        Authenticator.rotatePqcKeyMsgFromMnemonic("qor1canonical…", mnemonic, "qorechain-diana");
TypedMessage rotateMsg = rotation.msg; // broadcast BY the account, hybrid-cosigned
```

See the [authenticators](../../docs/docs/guides/authenticators.md) guide.

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
