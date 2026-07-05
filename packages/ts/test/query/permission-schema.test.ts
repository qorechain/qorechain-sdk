import { describe, it, expect, vi } from "vitest";
import { createQueryClients } from "../../src/query/grpc";
import { QueryPermissionSchemaResponse } from "../../src/codegen/qorechain/abstractaccount/v1/query";
import { RestClient } from "../../src/query/rest";
import type { PermissionSchemaResponse } from "../../src/query/rest";

describe("abstractaccount.permissionSchema (gRPC)", () => {
  it("dispatches to the PermissionSchema method and decodes the response", async () => {
    const expected = QueryPermissionSchemaResponse.fromPartial({
      schemaVersion: "v3.1.85",
      permissions: ["send", "evm", "svm", "all"],
      msgPermissions: {
        "/qorechain.abstractaccount.v1.MsgExecuteEVM": "evm",
        "/qorechain.abstractaccount.v1.MsgExecuteCosmos": "send",
      },
      keyManagementMsgs: ["/qorechain.pqc.v1.MsgRotatePQCKey"],
    });
    const request = vi.fn(async () =>
      QueryPermissionSchemaResponse.encode(expected).finish(),
    );
    const clients = createQueryClients({ request } as never);

    const res = await clients.abstractaccount.permissionSchema();

    const [service, method] = request.mock.calls[0];
    expect(service).toBe("qorechain.abstractaccount.v1.Query");
    expect(method).toBe("PermissionSchema");
    expect(res.schemaVersion).toBe("v3.1.85");
    expect(res.permissions).toContain("evm");
    expect(res.msgPermissions["/qorechain.abstractaccount.v1.MsgExecuteEVM"]).toBe(
      "evm",
    );
    expect(res.keyManagementMsgs).toContain(
      "/qorechain.pqc.v1.MsgRotatePQCKey",
    );
  });
});

describe("RestClient.getPermissionSchema (REST/LCD)", () => {
  it("GETs the permission_schema route and returns the typed shape", async () => {
    const body: PermissionSchemaResponse = {
      schema_version: "v3.1.85",
      permissions: ["send", "evm", "all"],
      msg_permissions: {
        "/qorechain.abstractaccount.v1.MsgExecuteEVM": "evm",
      },
      key_management_msgs: ["/qorechain.pqc.v1.MsgRotatePQCKey"],
    };
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain(
        "/qorechain/abstractaccount/v1/permission_schema",
      );
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as Response;
    });
    const rest = new RestClient("https://rest.example", { fetch: fetchImpl as never });

    const res = await rest.getPermissionSchema();

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(res.schema_version).toBe("v3.1.85");
    expect(res.msg_permissions["/qorechain.abstractaccount.v1.MsgExecuteEVM"]).toBe(
      "evm",
    );
  });
});
