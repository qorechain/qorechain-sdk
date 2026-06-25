import { describe, it, expect, vi } from "vitest";
import { createQueryClients } from "../../src/query/grpc";
import { QueryAccountResponse } from "../../src/codegen/qorechain/pqc/v1/query";
import { QuerySlotResponse } from "../../src/codegen/qorechain/svm/v1/query";

const ADDR = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";

describe("typed query clients", () => {
  it("dispatches pqc.account by service/method and decodes the response", async () => {
    // The RPC client returns the encoded response for the requested method.
    const expected = QueryAccountResponse.fromPartial({ found: true });
    const request = vi.fn(async () =>
      QueryAccountResponse.encode(expected).finish(),
    );
    const clients = createQueryClients({ request } as never);

    const res = await clients.pqc.account({ address: ADDR });

    expect(request).toHaveBeenCalledOnce();
    const [service, method] = request.mock.calls[0];
    expect(service).toBe("qorechain.pqc.v1.Query");
    expect(method).toBe("Account");
    expect(res).toMatchObject({ found: true });
  });

  it("dispatches svm.slot to the correct service/method", async () => {
    const request = vi.fn(async () =>
      QuerySlotResponse.encode(QuerySlotResponse.fromPartial({ slot: "42" }))
        .finish(),
    );
    const clients = createQueryClients({ request } as never);

    const res = await clients.svm.slot({});

    const [service, method] = request.mock.calls[0];
    expect(service).toBe("qorechain.svm.v1.Query");
    expect(method).toBe("Slot");
    expect(res.slot).toBe("42");
  });
});
