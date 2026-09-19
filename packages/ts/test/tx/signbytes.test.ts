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

describe("signBytesVersionFor — mirror of the chain's switch", () => {
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

/** A fake fetch answering applied_plan with the given body. */
function planFetch(body: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("resolveSignBytesVersion", () => {
  beforeEach(() => clearSignBytesCache());
  const REST = "https://lcd.example";

  it('reads mainnet\'s literal {"height":"0"} as NOT upgraded (the string "0" is truthy)', async () => {
    const f = planFetch({ height: "0" });
    await expect(
      resolveSignBytesVersion({ chainId: "qorechain-vladi", rest: REST, fetch: f }),
    ).resolves.toBe("v1");
    expect(f).toHaveBeenCalledWith(`${REST}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98`);
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
    expect(f).toHaveBeenCalledWith(`${REST}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98`);
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
    await resolveSignBytesVersion(o);
    await resolveSignBytesVersion(o);
    expect(f).toHaveBeenCalledTimes(1);
    await resolveSignBytesVersion({ ...o, forceRefresh: true });
    expect(f).toHaveBeenCalledTimes(2);
    await resolveSignBytesVersion({ ...o, rest: "https://other.example" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("re-asks once the TTL has passed", async () => {
    const f = planFetch({ height: "0" });
    const o = { chainId: "qorechain-vladi", rest: REST, fetch: f, ttlMs: 0 };
    await resolveSignBytesVersion(o);
    await resolveSignBytesVersion(o);
    expect(f).toHaveBeenCalledTimes(2);
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
    // First answer: not upgraded (cached). The network then upgrades.
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ height: "0" })))
      .mockResolvedValue(new Response(JSON.stringify({ height: "5746000" })));
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
    expect(f).toHaveBeenCalledTimes(2);
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
