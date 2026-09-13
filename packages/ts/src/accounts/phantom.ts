/**
 * REMOVED in v0.8.0 — the Phantom signature-derived account API.
 *
 * This module used to turn a wallet signature into a spend key. That is unsafe:
 * a wallet signature is a bearer secret that any page can ask the wallet to
 * produce, so it cannot stand in for secret entropy, and anyone who obtains it
 * controls the resulting account. The exported functions remain so existing
 * imports fail loudly with an explanation instead of silently changing meaning;
 * both throw as soon as they are called. Link an external wallet key through the
 * authenticator lanes instead — register it with `MsgRegisterAuthenticator` and
 * spend via `MsgExecuteCosmos` / `MsgExecuteEVM`, which keeps the canonical
 * account's own key the only thing that can move funds. See the Authenticators
 * guide (`docs/docs/guides/authenticators.md`). Any account previously derived
 * through this API must be treated as exposed — move its funds.
 */

import type { UnifiedAccount } from "./unified";

/**
 * REMOVED in v0.8.0. Always throws.
 *
 * Use the authenticator lanes instead — see the module doc-comment and the
 * Authenticators guide.
 *
 * @throws always.
 */
export function unifiedAccountFromPhantomSignature(
  _signatureBytes: Uint8Array,
): UnifiedAccount {
  throw new Error(
    "unifiedAccountFromPhantomSignature was removed in v0.8.0: deriving a spend key " +
      "from a wallet signature is unsafe — the signature is a bearer secret that any " +
      "page can request from the wallet, so whoever obtains it controls the account. " +
      "Use the authenticator lanes instead: register the external key with " +
      "MsgRegisterAuthenticator and spend via MsgExecuteCosmos / MsgExecuteEVM (see the " +
      "Authenticators guide). Any account previously derived this way must be treated " +
      "as exposed — move its funds.",
  );
}

/**
 * The minimal shape of an injected Phantom-style provider this module once used.
 *
 * Retained only so the removed {@link connectPhantomUnified} signature still
 * type-checks for existing callers; nothing here is called any more.
 */
export interface PhantomProvider {
  connect(): Promise<{ publicKey: { toBytes(): Uint8Array } | Uint8Array }>;
  publicKey?: { toBytes(): Uint8Array } | Uint8Array | null;
  signMessage(
    message: Uint8Array,
    encoding?: string,
  ): Promise<{ signature: Uint8Array } | Uint8Array>;
}

/** Options for the removed {@link connectPhantomUnified}. */
export interface ConnectPhantomUnifiedOptions {
  /** The Phantom-style provider. Unused: the function always throws. */
  provider?: PhantomProvider;
}

/**
 * REMOVED in v0.8.0. Always throws.
 *
 * Use the authenticator lanes instead — see the module doc-comment and the
 * Authenticators guide.
 *
 * @throws always.
 */
export async function connectPhantomUnified(
  _opts: ConnectPhantomUnifiedOptions = {},
): Promise<UnifiedAccount> {
  throw new Error(
    "connectPhantomUnified was removed in v0.8.0: deriving a spend key from a wallet " +
      "signature is unsafe — the signature is a bearer secret that any page can request " +
      "from the wallet, so whoever obtains it controls the account. Use the authenticator " +
      "lanes instead: register the external key with MsgRegisterAuthenticator and spend " +
      "via MsgExecuteCosmos / MsgExecuteEVM (see the Authenticators guide). Any account " +
      "previously derived this way must be treated as exposed — move its funds.",
  );
}
