import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assertCrossVmAsyncFieldsSupported,
  clearCrossVmFeatureCache,
  CROSSVM_ASYNC_GAS_PRICED_FEATURE,
  CROSSVM_ASYNC_ESCROW_FEATURE,
} from "../../src/tx/builder";

const REST = "https://lcd.example";
const msg = (value: Record<string, unknown>) => ({ typeUrl: "/qorechain.crossvm.v1.MsgCrossVMCall", value });
const node = (answer: unknown) =>
  vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    if (typeof answer === "number") return new Response("{}", { status: answer });
    return new Response(JSON.stringify({ features: answer }));
  });
const on = (names: string[]) => names.map((name) => ({ name, enabled: true, known: true, staged: false }));

describe("MsgCrossVMCall async fields need chain v3.2.8", () => {
  beforeEach(() => clearCrossVmFeatureCache());

  it("asks nothing when neither field is set", async () => {
    const f = node([]);
    await assertCrossVmAsyncFieldsSupported([msg({ asyncGasLimit: "0", asyncMaxFactor: 0 }), { typeUrl: "/x", value: {} }], { rest: REST, fetch: f });
    expect(f).not.toHaveBeenCalled();
  });

  it("allows both fields when both switches are on", async () => {
    const f = node(on([CROSSVM_ASYNC_GAS_PRICED_FEATURE, CROSSVM_ASYNC_ESCROW_FEATURE]));
    await assertCrossVmAsyncFieldsSupported([msg({ asyncGasLimit: "600000", asyncMaxFactor: "2000000" })], { rest: REST, fetch: f });
    await assertCrossVmAsyncFieldsSupported([msg({ asyncGasLimit: "600000" })], { rest: REST, fetch: f });
    expect(f).toHaveBeenCalledTimes(2); // one per switch, then cached
  });

  it("refuses field 8 on a network without the switch (the v3.2.7 shape)", async () => {
    await expect(
      assertCrossVmAsyncFieldsSupported([msg({ asyncGasLimit: 600000 })], { rest: REST, fetch: node(on(["crossvm-async-call-frame"])) }),
    ).rejects.toThrow(/async_gas_limit \(field 8\) requires chain v3\.2\.8 \(switch crossvm-async-gas-priced/);
  });

  it("refuses field 9 when its switch is listed and off", async () => {
    const off = [{ name: CROSSVM_ASYNC_ESCROW_FEATURE, enabled: false }];
    await expect(
      assertCrossVmAsyncFieldsSupported([msg({ asyncMaxFactor: "2000000" })], { rest: REST, fetch: node(off) }),
    ).rejects.toThrow(/async_max_factor \(field 9\) requires chain v3\.2\.8/);
  });

  it("refuses on a node that does not serve the switches (404)", async () => {
    await expect(
      assertCrossVmAsyncFieldsSupported([msg({ asyncGasLimit: 600000 })], { rest: REST, fetch: node(404) }),
    ).rejects.toThrow(/requires chain v3\.2\.8/);
  });

  it("says the network cannot be asked on a 500, and does not cache it", async () => {
    const f = node(500);
    await expect(assertCrossVmAsyncFieldsSupported([msg({ asyncGasLimit: 600000 })], { rest: REST, fetch: f })).rejects.toThrow(/HTTP 500/);
    await expect(assertCrossVmAsyncFieldsSupported([msg({ asyncGasLimit: 600000 })], { rest: REST, fetch: f })).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("needs a REST URL when a field is set", async () => {
    await expect(assertCrossVmAsyncFieldsSupported([msg({ asyncGasLimit: 600000 })], {})).rejects.toThrow(/skipFeatureCheck/);
  });
});
