# authenticator-spend

Link a Phantom (ed25519) key and build a relayer-submitted `MsgExecuteCosmos`
on QoreChain's **Native authenticator lane** (v3.1.85).

A linked external key spends from the ONE canonical PQC-required account
WITHOUT ever producing an ML-DSA co-signature. A **relayer** submits the tx and
pays fees (its own hybrid signature satisfies the ante on the envelope); the
authenticator's signature over the domain-separated, replay-bound sign-bytes IS
the authorization.

Shows:

- `signAuthenticatorLinkPhantom(...)` + `linkAuthenticatorMsgs(...)` - from
  chain v3.2.8 the key proves possession by signing the authenticator link
  message, and the owner links it in ONE transaction
  `[MsgUpdateSpendingRules, MsgRegisterAuthenticator]` with a spending rule
  that bounds every denom (the update replaces the account's rules wholesale)
- `cosmosAuthSignBytes(...)` - the byte-exact 32-byte digest the wallet signs
- `buildPhantomExecuteCosmos(...)` - sign the digest with a Phantom-style
  ed25519 wallet and get a relayer-ready `MsgExecuteCosmos`
- `qorechainRegistry().encode(...)` - prove the message encodes for broadcast

The example uses a local ed25519 keypair to stand in for Phantom (in a browser,
that is `window.solana`). It **builds and prints** the message - this runs
without a node.

## Dry run only

Broadcasting requires:

- A live **relayer** account that pays fees and broadcasts the tx.
- A **registered authenticator**: the account owner first broadcasts the link
  transaction built in step 1 (owner-signed), granting the `send` permission
  under a bounding spending rule.
- After the relayer broadcasts, `assertAuthenticatorExecutionsSucceeded(result,
  [msg])`: from chain v3.2.8 a failed execution returns `success = false` in a
  transaction with code 0 and consumes the nonce.

## Run

```bash
pnpm install
pnpm start
```

Prints the auth sign-bytes and the assembled `MsgExecuteCosmos`. See
`.env.example` for the (optional) configuration.
