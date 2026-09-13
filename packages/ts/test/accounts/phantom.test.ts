import { describe, it, expect } from "vitest";
import {
  unifiedAccountFromPhantomSignature,
  connectPhantomUnified,
} from "../../src/accounts/phantom";

// The signature-derived account API was removed in v0.8.0: a wallet signature is
// a bearer secret, so it can never stand in for the secret entropy of a spend
// key. Both entry points must fail loudly and point at the authenticator lanes.

describe("unifiedAccountFromPhantomSignature (removed)", () => {
  it("throws instead of deriving an account", () => {
    expect(() =>
      unifiedAccountFromPhantomSignature(new Uint8Array(64).fill(7)),
    ).toThrow(/removed in v0\.8\.0/);
  });

  it("points at the authenticator lanes", () => {
    expect(() =>
      unifiedAccountFromPhantomSignature(new Uint8Array(64).fill(7)),
    ).toThrow(/MsgRegisterAuthenticator/);
    expect(() =>
      unifiedAccountFromPhantomSignature(new Uint8Array(64).fill(7)),
    ).toThrow(/MsgExecuteCosmos \/ MsgExecuteEVM/);
  });
});

describe("connectPhantomUnified (removed)", () => {
  it("rejects instead of connecting", async () => {
    await expect(connectPhantomUnified({})).rejects.toThrow(
      /removed in v0\.8\.0/,
    );
  });

  it("points at the authenticator lanes", async () => {
    await expect(connectPhantomUnified({})).rejects.toThrow(
      /MsgRegisterAuthenticator/,
    );
    await expect(connectPhantomUnified({})).rejects.toThrow(
      /MsgExecuteCosmos \/ MsgExecuteEVM/,
    );
  });

  it("rejects even when a working provider is supplied", async () => {
    const provider = {
      async connect() {
        return { publicKey: new Uint8Array(32).fill(9) };
      },
      publicKey: new Uint8Array(32).fill(9),
      async signMessage() {
        return { signature: new Uint8Array(64).fill(11) };
      },
    };
    await expect(connectPhantomUnified({ provider })).rejects.toThrow(
      /removed in v0\.8\.0/,
    );
  });
});
