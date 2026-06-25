import { describe, it, expect, vi } from "vitest";
import { requestFaucet, getNetwork } from "../src/index";

function okResponse(body = "") {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as unknown as Response;
}

describe("requestFaucet", () => {
  it("POSTs JSON { address } to the configured faucet URL", async () => {
    const fetchMock = vi.fn(async () => okResponse('{"ok":true}'));
    const res = await requestFaucet(
      { faucetUrl: "https://faucet.example" },
      "qor1abc",
      { fetch: fetchMock },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://faucet.example");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ address: "qor1abc" });
    expect(res).toEqual({ ok: true });
  });

  it("includes denom when provided", async () => {
    const fetchMock = vi.fn(async () => okResponse(""));
    await requestFaucet({ faucetUrl: "https://faucet.example" }, "qor1abc", {
      fetch: fetchMock,
      denom: "uqor",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ address: "qor1abc", denom: "uqor" });
  });

  it("honors an explicit faucetUrl override", async () => {
    const fetchMock = vi.fn(async () => okResponse(""));
    await requestFaucet({ faucetUrl: "https://preset" }, "qor1abc", {
      fetch: fetchMock,
      faucetUrl: "https://override",
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://override");
  });

  it("throws a clear error when no faucet URL is configured", async () => {
    await expect(requestFaucet({}, "qor1abc")).rejects.toThrow(
      /faucet URL not configured for this network/,
    );
  });

  it("built-in presets leave faucetUrl undefined (no baked hostname)", async () => {
    expect(getNetwork("testnet").faucetUrl).toBeUndefined();
    await expect(requestFaucet(getNetwork("testnet"), "qor1abc")).rejects.toThrow();
  });

  it("surfaces non-2xx responses", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({ ok: false, status: 429, text: async () => "rate limited" }) as unknown as Response,
    );
    await expect(
      requestFaucet({ faucetUrl: "https://faucet.example" }, "qor1abc", { fetch: fetchMock }),
    ).rejects.toThrow(/HTTP 429/);
  });
});
