import { describe, it, expect, vi } from "vitest";
import { RestClient } from "../../src/query/rest";
import { estimateFee, STATIC_FALLBACK } from "../../src/tx/fees";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    statusText: "err",
    json: async () => ({}),
    text: async () => "boom",
  } as unknown as Response;
}

describe("estimateFee", () => {
  it("calls the fee-estimate REST route with the urgency query", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ suggested_fee_uqor: "1200", estimated_blocks: 1 }),
    );
    const rest = new RestClient("http://host:1317", { fetch: fetchMock });
    await estimateFee(rest, { urgency: "fast" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://host:1317/qorechain/ai/v1/fee-estimate?urgency=fast",
    );
  });

  it("defaults to normal urgency", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ suggested_fee_uqor: "1200" }),
    );
    const rest = new RestClient("http://host:1317", { fetch: fetchMock });
    await estimateFee(rest);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://host:1317/qorechain/ai/v1/fee-estimate?urgency=normal",
    );
  });

  it("parses the endpoint fee into an StdFee shape", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ suggested_fee_uqor: "1200", estimated_blocks: 2 }),
    );
    const rest = new RestClient("http://host:1317", { fetch: fetchMock });
    const fee = await estimateFee(rest, { urgency: "fast", gas: 250000 });
    expect(fee.amount).toEqual([{ denom: "uqor", amount: "1200" }]);
    expect(fee.gas).toBe("250000");
  });

  it("falls back to a static gas-price fee when the endpoint errors", async () => {
    const fetchMock = vi.fn(async () => errorResponse(503));
    const rest = new RestClient("http://host:1317", {
      fetch: fetchMock,
      retries: 0,
    });
    const fee = await estimateFee(rest, { gas: 200000 });
    // 200000 gas * 0.15 uqor/gas = 30000 uqor (ceil).
    expect(fee.gas).toBe("200000");
    expect(fee.amount).toEqual([{ denom: "uqor", amount: "30000" }]);
  });

  it("honours a custom static fallback gas price and denom", async () => {
    const fetchMock = vi.fn(async () => errorResponse(500));
    const rest = new RestClient("http://host:1317", {
      fetch: fetchMock,
      retries: 0,
    });
    const fee = await estimateFee(rest, {
      gas: 100000,
      fallbackGasPrice: "0.1",
      denom: "uqor",
    });
    expect(fee.amount).toEqual([{ denom: "uqor", amount: "10000" }]);
  });

  it("exposes the default static fallback constants", () => {
    expect(STATIC_FALLBACK.gasPrice).toBe("0.15");
    expect(STATIC_FALLBACK.denom).toBe("uqor");
    expect(STATIC_FALLBACK.gas).toBe("200000");
  });
});
