import { describe, it, expect } from "vitest";
import { base58 } from "@scure/base";
import {
  unifiedAccountFromPhantomSignature,
  connectPhantomUnified,
  PHANTOM_DERIVATION_DOMAIN,
  type PhantomProvider,
} from "../../src/accounts/phantom";
import { unifiedAccountFromSeed } from "../../src/accounts/unified";
import { shake256 } from "@qorechain/pqc";

describe("unifiedAccountFromPhantomSignature", () => {
  it("derives unifiedAccountFromSeed(shake256(sig, 32))", () => {
    const sig = new Uint8Array(64).fill(7);
    const acct = unifiedAccountFromPhantomSignature(sig);
    const expected = unifiedAccountFromSeed(shake256(sig, 32));
    expect(acct.cosmos).toBe(expected.cosmos);
    expect(acct.evm).toBe(expected.evm);
    expect(acct.svm).toBe(expected.svm);
  });

  it("is deterministic for the same signature", () => {
    const sig = new Uint8Array(64).fill(3);
    expect(unifiedAccountFromPhantomSignature(sig).cosmos).toBe(
      unifiedAccountFromPhantomSignature(sig).cosmos,
    );
  });
});

describe("connectPhantomUnified", () => {
  it("signs the fixed domain-separated message and derives the account", async () => {
    const phantomPub = new Uint8Array(32).fill(9);
    let signedMessage: string | undefined;
    const fixedSignature = new Uint8Array(64).fill(11);

    const provider: PhantomProvider = {
      publicKey: phantomPub,
      async connect() {
        return { publicKey: phantomPub };
      },
      async signMessage(message: Uint8Array) {
        signedMessage = new TextDecoder().decode(message);
        return { signature: fixedSignature };
      },
    };

    const acct = await connectPhantomUnified({ provider });

    // The signed message is the domain line + newline + base58 pubkey.
    expect(signedMessage).toBe(
      `${PHANTOM_DERIVATION_DOMAIN}\n${base58.encode(phantomPub)}`,
    );
    // The derived account matches deriving directly from the signature.
    expect(acct.cosmos).toBe(
      unifiedAccountFromPhantomSignature(fixedSignature).cosmos,
    );
  });

  it("throws when no provider is available", async () => {
    await expect(connectPhantomUnified({})).rejects.toThrow(
      /no Phantom provider/,
    );
  });
});
