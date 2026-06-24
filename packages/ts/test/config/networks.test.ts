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

  it("mainnet is fully populated and live", () => {
    expect(NETWORKS.mainnet.live).toBe(true);
    expect(NETWORKS.mainnet.chainId).toBe("qorechain-vladi");
    expect(NETWORKS.mainnet.bech32.account).toBe("qor");
    expect(NETWORKS.mainnet.bech32.validator).toBe("qorvaloper");
    expect(NETWORKS.mainnet.bech32.consensus).toBe("qorvalcons");
    expect(NETWORKS.mainnet.coin).toEqual({
      display: "QOR",
      base: "uqor",
      exponent: 6,
    });
    expect(NETWORKS.mainnet.endpoints?.rest).toContain("1317");
    expect(NETWORKS.mainnet.endpoints?.evmRpc).toContain("8545");
    expect(NETWORKS.mainnet.endpoints?.svmRpc).toContain("8899");
  });

  it("getNetwork returns the live mainnet config", () => {
    const n = getNetwork("mainnet");
    expect(n.live).toBe(true);
    expect(n.chainId).toBe("qorechain-vladi");
  });
});
