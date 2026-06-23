import { describe, it, expect, vi } from "vitest";
import { getJson, postJsonRpc, QoreHttpError } from "../../src/query/http";

/** Build a minimal Response-like object the helper understands. */
function jsonResponse(body: unknown, init?: { status?: number; ok?: boolean }) {
  const status = init?.status ?? 200;
  return {
    ok: init?.ok ?? (status >= 200 && status < 300),
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("getJson", () => {
  it("builds the correct URL with query params and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    const result = await getJson<{ ok: boolean }>(
      "http://host:1317/cosmos/bank/v1beta1/balances/abc",
      { query: { denom: "uqor", empty: undefined }, fetch: fetchMock },
    );
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("http://host:1317/cosmos/bank/v1beta1/balances/abc?denom=uqor");
  });

  it("throws QoreHttpError with status on non-2xx", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "nope" }, { status: 404 }));
    await expect(
      getJson("http://host/x", { fetch: fetchMock }),
    ).rejects.toMatchObject({ name: "QoreHttpError", status: 404 });
  });

  it("retries on retryable 5xx up to maxRetries then throws", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, { status: 503 }));
    await expect(
      getJson("http://host/x", { fetch: fetchMock, retries: 2, retryDelayMs: 0 }),
    ).rejects.toBeInstanceOf(QoreHttpError);
    // initial attempt + 2 retries = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("succeeds after a transient 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    const result = await getJson("http://host/x", {
      fetch: fetchMock,
      retries: 3,
      retryDelayMs: 0,
    });
    expect(result).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("passes an abort signal so the request can time out", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse({ ok: true });
    });
    await getJson("http://host/x", { fetch: fetchMock, timeoutMs: 5000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("postJsonRpc", () => {
  it("POSTs the provided body and returns the parsed response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x1" }));
    const body = { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] };
    const result = await postJsonRpc<{ result: string }>("http://host:8545", body, {
      fetch: fetchMock,
    });
    expect(result).toEqual({ jsonrpc: "2.0", id: 1, result: "0x1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://host:8545");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(body);
    expect((init?.headers as Record<string, string>)["content-type"]).toContain("application/json");
  });

  it("throws QoreHttpError on non-2xx transport error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, { status: 500 }));
    await expect(
      postJsonRpc("http://host", {}, { fetch: fetchMock, retries: 0 }),
    ).rejects.toBeInstanceOf(QoreHttpError);
  });
});
