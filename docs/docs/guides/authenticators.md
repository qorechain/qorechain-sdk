---
id: authenticators
title: Authenticator lanes
sidebar_position: 13
---

# Authenticator lanes

**Authenticator lanes** (chain v3.1.85) let a linked external key — a Phantom
**ed25519** key, or a MetaMask / EVM **secp256k1** key — spend from the ONE
canonical **PQC-required** account under least-privilege, revocable terms,
**without the external key ever producing an ML-DSA co-signature**.

:::warning A limit applies only if you set one

A `SpendingRule` — allowed denominations, a per-transaction limit and a daily
limit — **is** enforced by the chain on both the `ExecuteCosmos` and
`ExecuteEVM` lanes, fail-closed: the spend is checked before it happens, and the
daily accumulator is credited only once the check passes.

But it applies only when a rule exists. The chain resolves, in order:

1. the authenticator's own rule, if it is set **and** `Enabled`;
2. otherwise the first `Enabled` rule on the **account**;
3. otherwise **no rule — and no limit**.

`MsgRegisterAuthenticator` carries no rule field, so a key linked with that
message alone falls to step 2 or 3. **If nobody set an account-level rule, that
key can move the whole balance.** Set a rule deliberately with
`MsgUpdateSpendingRules`; do not assume a default.

Two details worth knowing when you do. An account-level rule accumulates
account-wide, while a per-authenticator rule accumulates per key — otherwise
three linked keys would each get the owner's full daily allowance. And a rule
that is `Enabled` must constrain something: the chain refuses one with no
per-transaction limit, no daily limit and no denomination list.

A limit bounds the damage a linked key can do; it does not remove the need to
register only the permissions that key needs, and to revoke it when it is done.

:::

:::warning Never derive a spend key from a wallet signature

Do not seed an account from a wallet signature (the removed "Phantom P1a"
pattern). A wallet signature is a bearer secret that any page can request, so
anyone who obtains it controls the derived account. Link the external key as an
**authenticator** instead — that is what this guide describes.

:::

## The relayer model

A **relayer** submits the transaction and pays the fees. The relayer's own
hybrid (classical + ML-DSA-87) signature satisfies the ante handler on the
envelope, so the canonical account's PQC signature is **not** needed on-chain.
The authorization is instead the linked key's signature over a
domain-separated, replay-bound **sign-bytes** digest.

```
 Phantom / MetaMask key            Relayer (pays fees)             Chain
 ─────────────────────            ───────────────────            ─────
 sign(authSignBytes)  ──────────▶ wrap in Msg, sign envelope ──▶ verify authenticator sig
                                                                  check permission + rule
                                                                  spend FROM canonical account
```

The relayer is a **different** account than the owner, so it does not bump the
account's EVM nonce.

## The three lanes

| Lane | Message | Sign-bytes | Spends |
| --- | --- | --- | --- |
| EVM | `MsgExecuteEVM` | `evmAuthSignBytes` | native QOR / EVM call from the account's `0x` address |
| Native | `MsgExecuteCosmos` | `cosmosAuthSignBytes` | native QOR via `x/bank` from the account |
| Key rotation | `MsgRotatePQCKey` | `rotationSignBytes` | (rotates the account's PQC key) |

## Sign-bytes (byte-exact)

Two byte helpers: `BE64(n)` is an 8-byte big-endian integer; `LP(bytes)` is
`BE64(len) ‖ bytes` (length-prefixed).

**EVM lane** — `evmAuthSignBytes({ chainId, account, pubkey, to, value, data, nonce })`
returns a 32-byte digest:

```
sha256( "qorechain-evm-auth-v1"
        ‖ LP(chainId) ‖ LP(account) ‖ LP(pubkey)
        ‖ LP(to) ‖ LP(value) ‖ LP(data) ‖ BE64(nonce) )
```

`to` is the `0x`-hex recipient, `value` the decimal wei string, `data` the raw
calldata.

**Native lane** — `cosmosAuthSignBytes({ chainId, account, pubkey, to, amount, nonce })`
returns a 32-byte digest:

```
sha256( "qorechain-cosmos-auth-v1"
        ‖ LP(chainId) ‖ LP(account) ‖ LP(pubkey)
        ‖ LP(to) ‖ LP(amount) ‖ BE64(nonce) )
```

`amount` is the canonical single-coin string (e.g. `100uqor`).

**Rotation** — `rotationSignBytes(chainId, algorithmId, account, oldPub, newPub)`
returns the string both keys sign (`utf8` of it):

```
qorechain-pqc-rotate-v1|<chainId>|<algorithmId>|<account>|<oldHex>|<newHex>
```

## Building a spend

```ts
import { buildPhantomExecuteCosmos } from "@qorechain/sdk";

// window.solana is a Phantom-style wallet: { publicKey, signMessage }.
const msg = await buildPhantomExecuteCosmos({
  wallet: window.solana,
  relayer: relayerAddress,
  chainId: "qorechain-diana",
  account: canonicalAccount, // the PQC-required owner
  to: recipient,
  amount: "100uqor",
  nonce, // the per-authenticator sequence for (account, pubkey)
});
// hand `msg` to the relayer to sign the envelope + broadcast
```

MetaMask works the same way via `buildMetaMaskExecuteEvm` /
`buildMetaMaskExecuteCosmos`, which link the key by its 20-byte ETH address
(scheme `secp256k1`) and produce a 65-byte `personal_sign` (EIP-191) signature.
There are matching low-level composers (`executeEvmMsg`, `executeCosmosMsg`,
`registerEthAuthenticatorMsg`, `revokeAuthenticatorMsg`, `rotatePqcKeyMsg`).

## Nonces

- `MsgExecuteEVM.nonce` = the account's **current EVM nonce** (relayer ≠ owner,
  so do **not** add 1).
- `MsgExecuteCosmos.nonce` = the **per-authenticator sequence** for
  `(account, pubkey)` — a store counter distinct from the account's own
  sequence, incremented on each successful Native-lane spend.

Getting the nonce wrong is a replay rejection (see error codes below).

## The permission schema

The chain publishes the canonical authenticator permission taxonomy so clients
validate scopes without hardcoding strings and detect drift via
`schema_version`:

```ts
// REST (LCD):
const schema = await rest.getPermissionSchema();
// gRPC:
const schema = await clients.abstractaccount.permissionSchema();

schema.permissions;         // ["send", "evm", "svm", "all", ...]
schema.msg_permissions;     // { "/qorechain.abstractaccount.v1.MsgExecuteEVM": "evm", ... }
schema.key_management_msgs; // typeURLs NEVER delegable to a linked key
```

`GET /qorechain/abstractaccount/v1/permission_schema` is the REST route; the
module also exposes `/config`, `/accounts`, and `/account/{address}`.

## Error codes

Failures decode through `decodeTxError` with a friendly `kind`:

| Codespace | Code | Kind |
| --- | --- | --- |
| `abstractaccount` | 5 | `spending_limit_exceeded` |
| `abstractaccount` | 6 | `session_key_expired` |
| `abstractaccount` | 10 | `permission_denied` |
| `abstractaccount` | 11 | `authenticator_replay` |
| `pqc` | 21 | `hybrid_verify_failed` |

`hybrid_verify_failed` most commonly means a **hedged** (non-deterministic)
ML-DSA-87 signature — the chain accepts only deterministic signatures.

## Key rotation

Rotate an account's ML-DSA-87 key to a new key of the **same** algorithm — for
example migrating a legacy chain-bridge-derived key (`shake256(mnemonic)`) to
the canonical address-bound key
(`shake256("qorechain:pqc:v1|addr|mnemonic")`):

```ts
import { rotatePqcKeyMsgFromMnemonic } from "@qorechain/sdk";

const { msg, oldKeypair, newKeypair } = rotatePqcKeyMsgFromMnemonic({
  account,
  mnemonic,
  chainId: "qorechain-diana",
  // oldDerivation: "bridge" (legacy), newDerivation: "adapter" (canonical) by default
});
// broadcast `msg` BY the account, cosigned (hybrid) with the OLD key —
// both keys dual-sign the rotation bytes (old proves ownership, new proves control).
```

See the runnable [`authenticator-spend`](https://github.com/qorechain/qorechain-sdk/tree/main/examples/authenticator-spend)
example.
