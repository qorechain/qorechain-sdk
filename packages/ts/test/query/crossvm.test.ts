import { describe, it, expect, vi } from "vitest";
import { RestClient } from "../../src/query/rest";
import {
  getCrossVmMessage,
  getPendingCrossVmMessages,
  getCrossVmParams,
} from "../../src/query/crossvm";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function setup(body: unknown = {}) {
  const fetchMock = vi.fn(async () => jsonResponse(body));
  const rest = new RestClient("http://host:1317", { fetch: fetchMock });
  return { fetchMock, rest };
}

function calledUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return fetchMock.mock.calls[0][0] as string;
}

describe("cross-VM query helpers", () => {
  it("getCrossVmMessage hits the message-by-id path", async () => {
    const { fetchMock, rest } = setup({ message: { id: "42" } });
    await getCrossVmMessage(rest, "42");
    expect(calledUrl(fetchMock)).toBe(
      "http://host:1317/qorechain/crossvm/v1/message/42",
    );
  });

  it("getCrossVmMessage URL-encodes the id", async () => {
    const { fetchMock, rest } = setup({});
    await getCrossVmMessage(rest, "a/b c");
    expect(calledUrl(fetchMock)).toBe(
      "http://host:1317/qorechain/crossvm/v1/message/a%2Fb%20c",
    );
  });

  it("getPendingCrossVmMessages hits the pending path", async () => {
    const { fetchMock, rest } = setup({ messages: [] });
    await getPendingCrossVmMessages(rest);
    expect(calledUrl(fetchMock)).toBe(
      "http://host:1317/qorechain/crossvm/v1/pending",
    );
  });

  it("getCrossVmParams hits the params path", async () => {
    const { fetchMock, rest } = setup({ params: {} });
    await getCrossVmParams(rest);
    expect(calledUrl(fetchMock)).toBe(
      "http://host:1317/qorechain/crossvm/v1/params",
    );
  });

  it("parses and returns the JSON body", async () => {
    const { rest } = setup({ message: { id: "7", status: "pending" } });
    const res = await getCrossVmMessage(rest, "7");
    expect(res).toEqual({ message: { id: "7", status: "pending" } });
  });
});
