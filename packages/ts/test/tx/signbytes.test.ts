import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Registry } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";

import {
  hybridSignBytes,
  hybridSignBytesV1,
  hybridSignBytesV2,
  migrationSignBytes,
  migrationSignBytesV1,
  migrationSignBytesV2,
  bridgeAttestationSignBytes,
  bridgeAttestationSignBytesV1,
  bridgeAttestationSignBytesV2,
  signBytesVersionFor,
  resolveSignBytesVersion,
  clearSignBytesCache,
  isHybridSignBytesRejection,
  SIGN_BYTES_V2_UPGRADE,
  SIGN_BYTES_V2_UPGRADES,
  PQC_SIGN_BYTES_V2_FEATURE,
  fetchSignBytesVersionFromProtocolFeatures,
} from "../../src/tx/signbytes";
import { buildHybridTx, signAndBroadcastHybrid } from "../../src/tx/hybrid-tx";
import { directSignerFromPrivateKey } from "../../src/tx/signer-adapter";
import { generatePqcKeypair, pqcVerify } from "../../src/accounts/pqc";

const KAT = JSON.parse(
  readFileSync(new URL("../fixtures/signbytes-kat-v3.1.98.json", import.meta.url), "utf8"),
) as {
  hybrid_v2: Array<{
    name: string;
    chain_id: string;
    body_without_pqc_ext_hex: string;
    auth_info_hex: string;
    sign_bytes_hex: string;
  }>;
  migration_v2: Array<{
    name: string;
    chain_id: string;
    account: string;
    from_algorithm_id: number;
    to_algorithm_id: number;
    execution_height: number;
    old_public_key_hex: string;
    new_public_key_hex: string;
    sign_bytes_hex: string;
  }>;
  bridge_attestation_v2: Array<{
    name: string;
    chain_id: string;
    chain: string;
    event_type: string;
    operation_id: string;
    tx_hash: string;
    amount: string;
    asset: string;
    sign_bytes_hex: string;
  }>;
};

const hex = (s: string): Uint8Array =>
  new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ascii = (b: Uint8Array): string => new TextDecoder().decode(b);

describe("known-answer vectors generated from the chain implementation", () => {
  it.each(KAT.hybrid_v2.map((v) => [v.name, v] as const))("hybrid v2: %s", (_, v) => {
    const b0 = hex(v.body_without_pqc_ext_hex);
    const a = hex(v.auth_info_hex);
    expect(toHex(hybridSignBytesV2(v.chain_id, b0, a))).toBe(v.sign_bytes_hex);
    expect(toHex(hybridSignBytes("v2", v.chain_id, b0, a))).toBe(v.sign_bytes_hex);
  });

  it.each(KAT.migration_v2.map((v) => [v.name, v] as const))("migration v2: %s", (_, v) => {
    const input = {
      chainId: v.chain_id,
      account: v.account,
      fromAlgorithmId: v.from_algorithm_id,
      toAlgorithmId: v.to_algorithm_id,
      height: v.execution_height,
      oldPublicKey: hex(v.old_public_key_hex),
      newPublicKey: hex(v.new_public_key_hex),
    };
    expect(toHex(migrationSignBytesV2(input))).toBe(v.sign_bytes_hex);
    expect(toHex(migrationSignBytes("v2", input))).toBe(v.sign_bytes_hex);
  });

  it.each(KAT.bridge_attestation_v2.map((v) => [v.name, v] as const))(
    "bridge attestation v2: %s",
    (_, v) => {
      const input = {
        chainId: v.chain_id,
        chain: v.chain,
        eventType: v.event_type,
        operationId: v.operation_id,
        txHash: v.tx_hash,
        amount: v.amount,
        asset: v.asset,
      };
      expect(toHex(bridgeAttestationSignBytesV2(input))).toBe(v.sign_bytes_hex);
      expect(toHex(bridgeAttestationSignBytes("v2", input))).toBe(v.sign_bytes_hex);
    },
  );

  it("covers every vector in the file", () => {
    expect(KAT.hybrid_v2).toHaveLength(5);
    expect(KAT.migration_v2).toHaveLength(3);
    expect(KAT.bridge_attestation_v2).toHaveLength(3);
  });
});

describe("the v1 (legacy) forms", () => {
  it("hybrid v1 is BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A, with no domain or chain id", () => {
    const got = hybridSignBytesV1(new Uint8Array([1, 2, 3]), new Uint8Array([9]));
    expect(toHex(got)).toBe("00000003" + "010203" + "00000001" + "09");
    expect(toHex(hybridSignBytes("v1", "qorechain-vladi", new Uint8Array([1, 2, 3]), new Uint8Array([9]))))
      .toBe(toHex(got));
  });

  it("migration v1 is the chain's legacy ASCII string", () => {
    const input = {
      chainId: "qorechain-vladi",
      account: "qor1abc",
      fromAlgorithmId: 1,
      toAlgorithmId: 2,
      height: 42,
      oldPublicKey: new Uint8Array(),
      newPublicKey: new Uint8Array(),
    };
    const want = "qorechain-key-migration:chain=qorechain-vladi:from=1:to=2:account=qor1abc:height=42";
    expect(ascii(migrationSignBytesV1(input))).toBe(want);
    expect(ascii(migrationSignBytes("v1", input))).toBe(want);
  });

  it("bridge v1 is pipe-joined and carries no chain id", () => {
    const input = {
      chainId: "qorechain-vladi",
      chain: "ethereum",
      eventType: "deposit",
      operationId: "op-1",
      txHash: "0xabc",
      amount: "1000",
      asset: "usdc",
    };
    const want = "ethereum|deposit|op-1|0xabc|1000|usdc";
    expect(ascii(bridgeAttestationSignBytesV1(input))).toBe(want);
    expect(ascii(bridgeAttestationSignBytes("v1", input))).toBe(want);
  });

  it("rejects an unknown version rather than picking one", () => {
    expect(() => hybridSignBytes("v3" as never, "c", new Uint8Array(), new Uint8Array())).toThrow(
      /v1.*v2/,
    );
  });
});

describe("signBytesVersionFor - mirror of the chain's switch", () => {
  it.each([
    ["qorechain-vladi", 0, "v1"],
    ["qorechain-vladi", 5_746_000, "v2"],
    ["qorechain-diana", 0, "v1"],
    ["qorechain-diana", 5_746_000, "v2"],
    ["some-new-chain", 0, "v2"],
    ["some-new-chain", 5_746_000, "v2"],
  ] as const)("%s at applied height %d → %s", (chain, h, want) => {
    expect(signBytesVersionFor(chain, h)).toBe(want);
    expect(signBytesVersionFor(chain, BigInt(h))).toBe(want);
  });
});

const FEATURES_PATH = "/qorechain/pqc/v1/protocol_features";

/** 404, as a node below chain v3.2.4 answers the protocol features route. */
const notServed = () => new Response("Not Implemented", { status: 404 });

/**
 * A fake fetch answering applied_plan with the given body, on a node that does
 * not serve the protocol features route (so the resolver falls back to plans).
 */
function planFetch(body: unknown, status = 200) {
  return vi.fn(async (url: string) =>
    url.endsWith(FEATURES_PATH)
      ? notServed()
      : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

/** A fake fetch serving the given protocol features; any other URL fails the test. */
function featuresFetch(features: unknown[]) {
  return vi.fn(async (url: string) => {
    if (!url.endsWith(FEATURES_PATH)) throw new Error(`unexpected request ${url}`);
    return new Response(JSON.stringify({ features, height: "120" }));
  });
}

describe("resolveSignBytesVersion", () => {
  beforeEach(() => clearSignBytesCache());
  const REST = "https://lcd.example";

  it('reads mainnet\'s literal {"height":"0"} as NOT upgraded (the string "0" is truthy)', async () => {
    const f = planFetch({ height: "0" });
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-vladi", rest: REST, fetch: f }),
    ).resolves.toBe("v1");
    // Both plan names are asked before concluding v1.
    expect(f).toHaveBeenCalledWith(`${REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.0`);
    expect(f).toHaveBeenCalledWith(`${REST}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98`);
  });

  // The chain recognises two plan names: the testnet switched under "v3.1.98"
  // and keeps that record, mainnet switches under "v3.2.0". Asking only one
  // answers v1 on the other network, and every hybrid tx is then refused with
  // pqc code 21.
  it("uses v2 when the CURRENT plan name is applied, asking once", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith(FEATURES_PATH)
        ? notServed()
        : new Response(JSON.stringify({ height: url.endsWith("v3.2.0") ? "9000000" : "0" })));
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-vladi", rest: REST, fetch: f }),
    ).resolves.toBe("v2");
    // The features route first (not served), then one plan name.
    expect(f).toHaveBeenCalledTimes(2);
    expect(f).toHaveBeenCalledWith(`${REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.0`);
  });

  it("uses v2 when only the EARLIER plan name is applied (the testnet today)", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith(FEATURES_PATH)
        ? notServed()
        : new Response(JSON.stringify({ height: url.endsWith("v3.1.98") ? "5746000" : "0" })));
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-diana", rest: REST, fetch: f }),
    ).resolves.toBe("v2");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("exposes both names, newest first", () => {
    expect(SIGN_BYTES_V2_UPGRADES).toEqual(["v3.2.0", "v3.1.98"]);
    expect(SIGN_BYTES_V2_UPGRADE).toBe("v3.2.0");
  });

  it("reads an empty {} as not upgraded", async () => {
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-vladi", rest: REST, fetch: planFetch({}) }),
    ).resolves.toBe("v1");
  });

  it("reads a positive applied height as upgraded", async () => {
    await expect(
      resolveSignBytesVersion({
        chainId: "qorechain-diana",
        rest: REST,
        fetch: planFetch({ height: "5746000" }),
      }),
    ).resolves.toBe("v2");
  });

  it("strips a trailing slash from rest", async () => {
    const f = planFetch({ height: "1" });
    await resolveSignBytesVersion({ chainId: "qorechain-diana", rest: `${REST}/`, fetch: f });
    expect(f).toHaveBeenCalledWith(`${REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.0`);
  });

  it("answers v2 for a chain born on v2 without any network call", async () => {
    const f = planFetch({ height: "0" });
    await expect(resolveSignBytesVersion({ chainId: "my-rollup-1", fetch: f })).resolves.toBe("v2");
    expect(f).not.toHaveBeenCalled();
  });

  it("returns an explicit version unchanged, without a network call", async () => {
    const f = planFetch({ height: "5746000" });
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-diana", rest: REST, fetch: f, signBytesVersion: "v1" }),
    ).resolves.toBe("v1");
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses to guess for a legacy network without rest", async () => {
    await expect(resolveSignBytesVersion({ chainId: "qorechain-vladi" })).rejects.toThrow(
      /REST endpoint/,
    );
  });

  it("refuses to guess when the node cannot be asked", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-vladi", rest: REST, fetch: down }),
    ).rejects.toThrow(/cannot ask .* pass signBytesVersion/);
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-vladi", rest: REST, fetch: planFetch({}, 503) }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("caches per (rest, chainId) within the TTL and re-asks on forceRefresh", async () => {
    const f = planFetch({ height: "0" });
    const o = { chainId: "qorechain-vladi", rest: REST, fetch: f };
    // Not upgraded on a node without the features route: the route, then both
    // plan names, so each resolve costs 3 requests.
    await resolveSignBytesVersion(o);
    await resolveSignBytesVersion(o);
    expect(f).toHaveBeenCalledTimes(3);
    await resolveSignBytesVersion({ ...o, forceRefresh: true });
    expect(f).toHaveBeenCalledTimes(6);
    await resolveSignBytesVersion({ ...o, rest: "https://other.example" });
    expect(f).toHaveBeenCalledTimes(9);
  });

  it("re-asks once the TTL has passed", async () => {
    const f = planFetch({ height: "0" });
    const o = { chainId: "qorechain-vladi", rest: REST, fetch: f, ttlMs: 0 };
    await resolveSignBytesVersion(o);
    await resolveSignBytesVersion(o);
    expect(f).toHaveBeenCalledTimes(6); // features route + 2 plan names per resolve
  });
});

describe("resolveSignBytesVersion reads the protocol features first", () => {
  beforeEach(() => clearSignBytesCache());
  const REST = "https://lcd.example";
  const v2On = { name: PQC_SIGN_BYTES_V2_FEATURE, enabled: true, known: true, staged: false };
  const v2Off = { name: PQC_SIGN_BYTES_V2_FEATURE, enabled: false, known: true, staged: false };
  const other = { name: "evm-locked-balance-scaling", enabled: true, known: true, staged: false };

  it("names the switch the chain uses", () => {
    expect(PQC_SIGN_BYTES_V2_FEATURE).toBe("pqc-sign-bytes-v2");
  });

  // A fresh network that reuses a legacy chain id enables every feature at
  // genesis and never applies an upgrade plan; it verifies v2.
  it.each(["qorechain-diana", "qorechain-vladi"])(
    "answers v2 on %s with no applied plan when the feature is enabled",
    async (chainId) => {
      const f = featuresFetch([other, v2On]);
      await expect(resolveSignBytesVersion({ chainId, rest: REST, fetch: f })).resolves.toBe("v2");
      expect(f).toHaveBeenCalledTimes(1);
      expect(f).toHaveBeenCalledWith(`${REST}${FEATURES_PATH}`);
    },
  );

  it("answers v1 when the feature is listed but disabled, without asking the plans", async () => {
    const f = featuresFetch([other, v2Off]);
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-diana", rest: REST, fetch: f }),
    ).resolves.toBe("v1");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("answers v1 when the node lists its features and the switch is absent", async () => {
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-vladi", rest: REST, fetch: featuresFetch([other]) }),
    ).resolves.toBe("v1");
  });

  it.each([
    ["v3.2.0", "v2"],
    ["v3.1.98", "v2"],
    [null, "v1"],
  ] as const)("falls back to the plans on a 404 (applied: %s -> %s)", async (applied, want) => {
    const f = vi.fn(async (url: string) =>
      url.endsWith(FEATURES_PATH)
        ? notServed()
        : new Response(JSON.stringify({ height: applied && url.endsWith(applied) ? "5746000" : "0" })),
    );
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-diana", rest: REST, fetch: f }),
    ).resolves.toBe(want);
    expect(f).toHaveBeenCalledWith(`${REST}${FEATURES_PATH}`);
    expect(f).toHaveBeenCalledWith(`${REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.0`);
  });

  it.each([
    ["a transport error", () => Promise.reject(new TypeError("fetch failed"))],
    ["a 501", () => Promise.resolve(new Response("{}", { status: 501 }))],
    ["an unparseable body", () => Promise.resolve(new Response("<html>", { status: 200 }))],
    ["an empty feature list", () => Promise.resolve(new Response(JSON.stringify({ features: [] })))],
  ] as const)("falls back to the plans on %s", async (_label, answer) => {
    const f = vi.fn(async (url: string) =>
      url.endsWith(FEATURES_PATH) ? answer() : new Response(JSON.stringify({ height: "5746000" })),
    );
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-vladi", rest: REST, fetch: f }),
    ).resolves.toBe("v2");
    expect(f).toHaveBeenCalledWith(`${REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.0`);
  });

  it("still lets an explicit version win without any request", async () => {
    const f = featuresFetch([v2On]);
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-diana", rest: REST, fetch: f, signBytesVersion: "v1" }),
    ).resolves.toBe("v1");
    expect(f).not.toHaveBeenCalled();
  });

  it("caches the features answer per (rest, chainId)", async () => {
    const f = featuresFetch([v2On]);
    const o = { chainId: "qorechain-diana", rest: REST, fetch: f };
    await resolveSignBytesVersion(o);
    await resolveSignBytesVersion(o);
    expect(f).toHaveBeenCalledTimes(1);
    await resolveSignBytesVersion({ ...o, forceRefresh: true });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("exposes the features lookup on its own", async () => {
    await expect(fetchSignBytesVersionFromProtocolFeatures(REST, featuresFetch([v2On]))).resolves.toBe("v2");
    await expect(fetchSignBytesVersionFromProtocolFeatures(REST, featuresFetch([v2Off]))).resolves.toBe("v1");
    await expect(
      fetchSignBytesVersionFromProtocolFeatures(REST, vi.fn(async () => notServed())),
    ).resolves.toBeUndefined();
  });
});

describe("isHybridSignBytesRejection", () => {
  it("matches the pqc code-21 refusal in its known shapes", () => {
    expect(isHybridSignBytesRejection({ code: 21, codespace: "pqc", log: "x" })).toBe(true);
    expect(
      isHybridSignBytesRejection({ code: 21, rawLog: "hybrid PQC signature verification failed" }),
    ).toBe(true);
    expect(
      isHybridSignBytesRejection(new Error("Broadcasting transaction failed with code 21 (codespace: pqc). Log: hybrid PQC signature verification failed")),
    ).toBe(true);
  });

  it("does not match code 21 from another codespace, or other failures", () => {
    expect(isHybridSignBytesRejection({ code: 21, codespace: "sdk", log: "tx too large" })).toBe(false);
    expect(isHybridSignBytesRejection({ code: 5, codespace: "sdk", log: "insufficient funds" })).toBe(false);
    expect(isHybridSignBytesRejection(undefined)).toBe(false);
    expect(isHybridSignBytesRejection(null)).toBe(false);
  });
});

async function hybridFixture() {
  const signer = await directSignerFromPrivateKey(
    new Uint8Array(32).map((_, i) => (i + 1) & 0xff),
    "qor",
  );
  const [account] = await signer.getAccounts();
  const pqc = generatePqcKeypair(new Uint8Array(32).fill(9));
  const msg = {
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: MsgSend.fromPartial({
      fromAddress: account.address,
      toAddress: account.address,
      amount: [{ denom: "uqor", amount: "1000" }],
    }),
  };
  return {
    registry: new Registry(defaultRegistryTypes),
    signer,
    pqcKeypair: pqc,
    messages: [msg],
    fee: { amount: [{ denom: "uqor", amount: "5000" }], gas: "200000" },
    accountNumber: 0,
    sequence: 0,
  };
}

describe("buildHybridTx signs the form the network verifies", () => {
  beforeEach(() => clearSignBytesCache());

  it("auto on the upgraded testnet signs v2, and the signature does NOT verify over v1", async () => {
    const fx = await hybridFixture();
    const built = await buildHybridTx({
      ...fx,
      chainId: "qorechain-diana",
      rest: "https://lcd.example",
      fetch: planFetch({ height: "5746000" }),
    });
    expect(built.signBytesVersion).toBe("v2");
    expect(ascii(built.pqcSignedMessage.slice(0, 23))).toBe("qorechain-pqc-hybrid-v2");
    expect(pqcVerify(fx.pqcKeypair.publicKey, built.pqcSignedMessage, built.pqcSignature)).toBe(true);
    // Strip the v2 prefix to recover the v1 bytes: the signature must not cover them.
    const prefix = 23 + 8 + "qorechain-diana".length;
    const v1 = built.pqcSignedMessage.slice(prefix);
    expect(pqcVerify(fx.pqcKeypair.publicKey, v1, built.pqcSignature)).toBe(false);
  });

  it('auto on mainnet ({"height":"0"}) signs v1', async () => {
    const fx = await hybridFixture();
    const built = await buildHybridTx({
      ...fx,
      chainId: "qorechain-vladi",
      rest: "https://lcd.example",
      fetch: planFetch({ height: "0" }),
    });
    expect(built.signBytesVersion).toBe("v1");
    expect(ascii(built.pqcSignedMessage.slice(0, 23))).not.toBe("qorechain-pqc-hybrid-v2");
  });

  it("auto on a legacy network with no rest throws instead of guessing", async () => {
    const fx = await hybridFixture();
    await expect(buildHybridTx({ ...fx, chainId: "qorechain-vladi" })).rejects.toThrow(
      /REST endpoint/,
    );
  });
});

describe("signAndBroadcastHybrid retries once on a pqc code-21 refusal", () => {
  beforeEach(() => clearSignBytesCache());

  function transportRefusingFirst(refusal: object) {
    return {
      broadcastTx: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("refused"), refusal))
        .mockResolvedValue({ code: 0, transactionHash: "OK", height: 5 }),
      broadcastTxSync: vi.fn(),
    };
  }

  it("re-resolves past the cache and resends with the new form", async () => {
    const fx = await hybridFixture();
    // First resolve: no features route, neither plan applied (cached as v1).
    // The network then upgrades, so the re-resolve sees the current plan applied.
    let asked = 0;
    const f = vi.fn(async (url: string) => {
      if (url.endsWith(FEATURES_PATH)) return notServed();
      asked += 1;
      return new Response(JSON.stringify({ height: asked <= 2 ? "0" : "5746000" }));
    });
    const transport = transportRefusingFirst({ code: 21, codespace: "pqc", log: "hybrid PQC signature verification failed" });
    const res = await signAndBroadcastHybrid({
      ...fx,
      transport: transport as never,
      chainId: "qorechain-diana",
      rest: "https://lcd.example",
      fetch: f,
    });
    expect(res.transactionHash).toBe("OK");
    expect(transport.broadcastTx).toHaveBeenCalledTimes(2);
    // Plans: 2 for the first resolve, 1 for the refresh; plus the features
    // route once per resolve.
    expect(asked).toBe(3);
    expect(f).toHaveBeenCalledTimes(5);
    const [first] = transport.broadcastTx.mock.calls[0] as [Uint8Array];
    const [second] = transport.broadcastTx.mock.calls[1] as [Uint8Array];
    expect(toHex(first)).not.toBe(toHex(second));
  });

  it("does not retry when the version was explicit", async () => {
    const fx = await hybridFixture();
    const transport = transportRefusingFirst({ code: 21, codespace: "pqc" });
    await expect(
      signAndBroadcastHybrid({
        ...fx,
        transport: transport as never,
        chainId: "qorechain-diana",
        signBytesVersion: "v1",
      }),
    ).rejects.toThrow("refused");
    expect(transport.broadcastTx).toHaveBeenCalledTimes(1);
  });

  it("does not retry on code 21 from another codespace", async () => {
    const fx = await hybridFixture();
    const transport = transportRefusingFirst({ code: 21, codespace: "sdk", log: "tx too large" });
    await expect(
      signAndBroadcastHybrid({
        ...fx,
        transport: transport as never,
        chainId: "qorechain-diana",
        rest: "https://lcd.example",
        fetch: planFetch({ height: "5746000" }),
      }),
    ).rejects.toThrow("refused");
    expect(transport.broadcastTx).toHaveBeenCalledTimes(1);
  });

  it("retries at most once", async () => {
    const fx = await hybridFixture();
    const refusal = Object.assign(new Error("refused"), { code: 21, codespace: "pqc" });
    const transport = { broadcastTx: vi.fn().mockRejectedValue(refusal), broadcastTxSync: vi.fn() };
    await expect(
      signAndBroadcastHybrid({
        ...fx,
        transport: transport as never,
        chainId: "qorechain-diana",
        rest: "https://lcd.example",
        fetch: planFetch({ height: "5746000" }),
      }),
    ).rejects.toThrow("refused");
    expect(transport.broadcastTx).toHaveBeenCalledTimes(2);
  });
});
