import { describe, it, expect } from "vitest";
import { getNetwork, NETWORKS } from "../../src/config/networks";

describe("networks", () => {
  it("testnet is fully populated and live", () => {
    const n = getNetwork("testnet");
    expect(n.live).toBe(true);
    expect(n.chainId).toBe("qorechain-diana");
    expect(n.coin).toEqual({ display: "QOR", base: "uqor", exponent: 6 });
    expect(n.bech32.account).toBe("qor");
    expect(n.bech32.validator).toBe("qorvaloper");
    expect(n.endpoints?.rest).toContain("1317");
    expect(n.endpoints?.evmRpc).toContain("8545");
    expect(n.endpoints?.svmRpc).toContain("8899");
  });

  it("mainnet exists in the registry but is not yet live", () => {
    expect(NETWORKS.mainnet.live).toBe(false);
    expect(NETWORKS.mainnet.chainId).toBeNull();
    expect(NETWORKS.mainnet.endpoints).toBeNull();
  });

  it("getNetwork throws a clear error for the not-yet-live mainnet", () => {
    expect(() => getNetwork("mainnet")).toThrow(/not yet live/i);
  });
});
