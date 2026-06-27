import { describe, it, expect, vi } from "vitest";
import {
  custom,
  encodeFunctionResult,
  decodeFunctionData,
  toHex,
  type Hex,
} from "viem";
import {
  createEvmClient,
  ai,
  aiRiskScore,
  aiAnomalyCheck,
  simulateWithRiskScore,
  RISK_LEVEL_UNSAFE_THRESHOLD,
  AI_RISK_SCORE_ADDRESS,
  AI_ANOMALY_CHECK_ADDRESS,
  PRECOMPILE_ADDRESSES,
  IQORE_AI_ABI,
} from "../src/index";

const SENDER = "0x4444444444444444444444444444444444444444" as Hex;
const TO = "0x5555555555555555555555555555555555555555" as Hex;

/**
 * Build a transport that answers `eth_call` (risk + anomaly precompiles),
 * `eth_estimateGas`, and `eth_getCode`, recording the `eth_call` targets.
 */
function harness(opts: {
  risk?: [bigint, number];
  anomaly?: [bigint, boolean];
  gas?: bigint;
  code?: Hex;
}) {
  const calls: { to: Hex; data: Hex }[] = [];
  const request = vi.fn(
    async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_estimateGas") return toHex(opts.gas ?? 21_000n);
      if (method === "eth_getCode") return opts.code ?? "0x";
      if (method === "eth_call") {
        const { to, data } = (params as { to: Hex; data: Hex }[])[0];
        calls.push({ to, data });
        const decoded = decodeFunctionData({ abi: IQORE_AI_ABI, data });
        if (decoded.functionName === "aiRiskScore") {
          return encodeFunctionResult({
            abi: IQORE_AI_ABI,
            functionName: "aiRiskScore",
            result: opts.risk ?? [0n, 0],
          });
        }
        return encodeFunctionResult({
          abi: IQORE_AI_ABI,
          functionName: "aiAnomalyCheck",
          result: opts.anomaly ?? [0n, false],
        });
      }
      throw new Error(`unexpected ${method}`);
    },
  );
  return { transport: custom({ request }), calls };
}

async function client(transport: ReturnType<typeof custom>) {
  return createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
}

describe("AI precompile address constants", () => {
  it("alias the canonical precompile addresses", () => {
    expect(AI_RISK_SCORE_ADDRESS).toBe(PRECOMPILE_ADDRESSES.aiRiskScore);
    expect(AI_ANOMALY_CHECK_ADDRESS).toBe(PRECOMPILE_ADDRESSES.aiAnomalyCheck);
  });
  it("exposes the documented default unsafe threshold", () => {
    expect(RISK_LEVEL_UNSAFE_THRESHOLD).toBe(3);
  });
});

describe("aiRiskScore", () => {
  it("encodes aiRiskScore(bytes) for hex calldata and decodes the tuple", async () => {
    const txData = toHex("payload");
    const { transport, calls } = harness({ risk: [42n, 2] });
    const c = await client(transport);
    const res = await aiRiskScore(c.publicClient, txData);
    expect(res).toEqual({ score: 42n, level: 2 });
    expect(calls[0].to.toLowerCase()).toBe(
      AI_RISK_SCORE_ADDRESS.toLowerCase(),
    );
    const decoded = decodeFunctionData({ abi: IQORE_AI_ABI, data: calls[0].data });
    expect(decoded.functionName).toBe("aiRiskScore");
    expect(decoded.args).toEqual([txData]);
  });

  it("accepts a Uint8Array and hex-encodes it identically", async () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const { transport, calls } = harness({ risk: [1n, 0] });
    const c = await client(transport);
    await aiRiskScore(c.publicClient, bytes);
    const decoded = decodeFunctionData({ abi: IQORE_AI_ABI, data: calls[0].data });
    expect(decoded.args).toEqual(["0xdeadbeef"]);
  });
});

describe("aiAnomalyCheck", () => {
  it("encodes aiAnomalyCheck(address,uint256) and decodes the tuple", async () => {
    const { transport, calls } = harness({ anomaly: [99n, true] });
    const c = await client(transport);
    const res = await aiAnomalyCheck(c.publicClient, SENDER, 1000n);
    expect(res).toEqual({ anomalyScore: 99n, flagged: true });
    expect(calls[0].to.toLowerCase()).toBe(
      AI_ANOMALY_CHECK_ADDRESS.toLowerCase(),
    );
    const decoded = decodeFunctionData({ abi: IQORE_AI_ABI, data: calls[0].data });
    expect(decoded.functionName).toBe("aiAnomalyCheck");
    expect(decoded.args).toEqual([SENDER, 1000n]);
  });
});

describe("simulateWithRiskScore", () => {
  it("bundles gas + risk + anomaly and reports safe for low risk", async () => {
    const { transport, calls } = harness({
      gas: 50_000n,
      risk: [10n, 1],
      anomaly: [5n, false],
    });
    const c = await client(transport);
    const res = await simulateWithRiskScore(c.publicClient, {
      from: SENDER,
      to: TO,
      data: "0x1234",
      value: 1000n,
    });
    expect(res.gas).toBe(50_000n);
    expect(res.risk).toEqual({ score: 10n, level: 1 });
    expect(res.anomaly).toEqual({ anomalyScore: 5n, flagged: false });
    expect(res.safe).toBe(true);
    // It scored the provided calldata, not the code.
    const riskCall = calls.find((c) => {
      const d = decodeFunctionData({ abi: IQORE_AI_ABI, data: c.data });
      return d.functionName === "aiRiskScore";
    })!;
    const decoded = decodeFunctionData({ abi: IQORE_AI_ABI, data: riskCall.data });
    expect(decoded.args).toEqual(["0x1234"]);
  });

  it("marks unsafe when level >= threshold", async () => {
    const { transport } = harness({ risk: [900n, 3], anomaly: [0n, false] });
    const c = await client(transport);
    const res = await simulateWithRiskScore(c.publicClient, {
      from: SENDER,
      to: TO,
      data: "0xabcd",
    });
    expect(res.safe).toBe(false);
  });

  it("marks unsafe when the anomaly check flags it", async () => {
    const { transport } = harness({ risk: [1n, 0], anomaly: [1000n, true] });
    const c = await client(transport);
    const res = await simulateWithRiskScore(c.publicClient, {
      from: SENDER,
      to: TO,
      data: "0xabcd",
      value: 9_999_999n,
    });
    expect(res.safe).toBe(false);
  });

  it("falls back to the deployed code when no calldata is given", async () => {
    const code = "0x6080604052" as Hex;
    const { transport, calls } = harness({
      risk: [2n, 0],
      anomaly: [0n, false],
      code,
    });
    const c = await client(transport);
    await simulateWithRiskScore(c.publicClient, { from: SENDER, to: TO });
    const riskCall = calls.find((c) => {
      const d = decodeFunctionData({ abi: IQORE_AI_ABI, data: c.data });
      return d.functionName === "aiRiskScore";
    })!;
    const decoded = decodeFunctionData({ abi: IQORE_AI_ABI, data: riskCall.data });
    expect(decoded.args).toEqual([code]);
  });

  it("is exposed on the namespaced `ai` helper too", () => {
    expect(ai.aiRiskScore).toBe(aiRiskScore);
    expect(ai.aiAnomalyCheck).toBe(aiAnomalyCheck);
    expect(ai.simulateWithRiskScore).toBe(simulateWithRiskScore);
  });
});
