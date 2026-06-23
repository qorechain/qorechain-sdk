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
  precompiles,
  PRECOMPILE_ADDRESSES,
  IQORE_PQC_ABI,
  IQORE_AI_ABI,
  IQORE_CONSENSUS_ABI,
} from "../src/index";

/** Capture the `eth_call` target + calldata, returning a caller-supplied result. */
function captureCall(respond: (to: Hex, data: Hex) => Hex) {
  const calls: { to: Hex; data: Hex }[] = [];
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_call") {
      const { to, data } = (params as { to: Hex; data: Hex }[])[0];
      calls.push({ to, data });
      return respond(to, data);
    }
    throw new Error(`unexpected ${method}`);
  });
  return { transport: custom({ request }), calls };
}

async function client(transport: ReturnType<typeof custom>) {
  return createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
}

describe("precompile addresses", () => {
  it("exposes the exact fixed addresses", () => {
    expect(PRECOMPILE_ADDRESSES).toEqual({
      crossVmBridge: "0x0000000000000000000000000000000000000901",
      pqcVerify: "0x0000000000000000000000000000000000000A01",
      pqcKeyStatus: "0x0000000000000000000000000000000000000A02",
      aiRiskScore: "0x0000000000000000000000000000000000000B01",
      aiAnomalyCheck: "0x0000000000000000000000000000000000000B02",
      rlConsensusParams: "0x0000000000000000000000000000000000000C01",
    });
  });
});

describe("precompiles.pqcVerify", () => {
  it("calls 0x..0A01 with pqcVerify calldata and decodes the bool", async () => {
    const args = { pubkey: "0xaa" as Hex, signature: "0xbb" as Hex, message: "0xcc" as Hex };
    const { transport, calls } = captureCall((_to, data) => {
      const decoded = decodeFunctionData({ abi: IQORE_PQC_ABI, data });
      expect(decoded.functionName).toBe("pqcVerify");
      expect(decoded.args).toEqual([args.pubkey, args.signature, args.message]);
      return encodeFunctionResult({ abi: IQORE_PQC_ABI, functionName: "pqcVerify", result: true });
    });
    const c = await client(transport);
    const valid = await precompiles.pqcVerify(c.publicClient, args);
    expect(valid).toBe(true);
    expect(calls[0].to.toLowerCase()).toBe(PRECOMPILE_ADDRESSES.pqcVerify.toLowerCase());
  });
});

describe("precompiles.pqcKeyStatus", () => {
  it("calls 0x..0A02 with pqcKeyStatus(address) and decodes the tuple", async () => {
    const account = "0x3333333333333333333333333333333333333333" as Hex;
    const { transport, calls } = captureCall((_to, data) => {
      const decoded = decodeFunctionData({ abi: IQORE_PQC_ABI, data });
      expect(decoded.functionName).toBe("pqcKeyStatus");
      expect(decoded.args).toEqual([account]);
      return encodeFunctionResult({
        abi: IQORE_PQC_ABI,
        functionName: "pqcKeyStatus",
        result: [true, 1, "0xdeadbeef"],
      });
    });
    const c = await client(transport);
    const res = await precompiles.pqcKeyStatus(c.publicClient, account);
    expect(res).toEqual({ registered: true, algorithmId: 1, pubkey: "0xdeadbeef" });
    expect(calls[0].to.toLowerCase()).toBe(PRECOMPILE_ADDRESSES.pqcKeyStatus.toLowerCase());
  });
});

describe("precompiles.aiRiskScore", () => {
  it("calls 0x..0B01 with aiRiskScore(bytes) and decodes the tuple", async () => {
    const txData = toHex("payload");
    const { transport, calls } = captureCall((_to, data) => {
      const decoded = decodeFunctionData({ abi: IQORE_AI_ABI, data });
      expect(decoded.functionName).toBe("aiRiskScore");
      expect(decoded.args).toEqual([txData]);
      return encodeFunctionResult({
        abi: IQORE_AI_ABI,
        functionName: "aiRiskScore",
        result: [42n, 2],
      });
    });
    const c = await client(transport);
    const res = await precompiles.aiRiskScore(c.publicClient, txData);
    expect(res).toEqual({ score: 42n, level: 2 });
    expect(calls[0].to.toLowerCase()).toBe(PRECOMPILE_ADDRESSES.aiRiskScore.toLowerCase());
  });
});

describe("precompiles.aiAnomalyCheck", () => {
  it("calls 0x..0B02 with aiAnomalyCheck(address,uint256) and decodes the tuple", async () => {
    const sender = "0x4444444444444444444444444444444444444444" as Hex;
    const { transport, calls } = captureCall((_to, data) => {
      const decoded = decodeFunctionData({ abi: IQORE_AI_ABI, data });
      expect(decoded.functionName).toBe("aiAnomalyCheck");
      expect(decoded.args).toEqual([sender, 1000n]);
      return encodeFunctionResult({
        abi: IQORE_AI_ABI,
        functionName: "aiAnomalyCheck",
        result: [99n, true],
      });
    });
    const c = await client(transport);
    const res = await precompiles.aiAnomalyCheck(c.publicClient, { sender, amount: 1000n });
    expect(res).toEqual({ anomalyScore: 99n, flagged: true });
    expect(calls[0].to.toLowerCase()).toBe(PRECOMPILE_ADDRESSES.aiAnomalyCheck.toLowerCase());
  });
});

describe("precompiles.rlConsensusParams", () => {
  it("calls 0x..0C01 with rlConsensusParams() and decodes the tuple", async () => {
    const { transport, calls } = captureCall((_to, data) => {
      const decoded = decodeFunctionData({ abi: IQORE_CONSENSUS_ABI, data });
      expect(decoded.functionName).toBe("rlConsensusParams");
      return encodeFunctionResult({
        abi: IQORE_CONSENSUS_ABI,
        functionName: "rlConsensusParams",
        result: [5n, 1_000_000_000n, 21n, 7n],
      });
    });
    const c = await client(transport);
    const res = await precompiles.rlConsensusParams(c.publicClient);
    expect(res).toEqual({
      blockTime: 5n,
      baseGasPrice: 1_000_000_000n,
      validatorSetSize: 21n,
      epoch: 7n,
    });
    expect(calls[0].to.toLowerCase()).toBe(PRECOMPILE_ADDRESSES.rlConsensusParams.toLowerCase());
  });
});
