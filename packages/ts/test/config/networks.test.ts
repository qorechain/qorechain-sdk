import { describe, it, expect } from "vitest";
import {
  getNetwork,
  listNetworks,
  requireNetworkEndpoint,
  LOCALNET_ENDPOINTS,
  NETWORKS,
  PUBLIC_ENDPOINTS,
} from "../../src/config/networks";

describe("networks", () => {
  it("testnet is fully populated and live", () => {
    const n = getNetwork("testnet");
    expect(n.live).toBe(true);
    expect(n.chainId).toBe("qorechain-diana");
    expect(n.coin).toEqual({ display: "QOR", base: "uqor", exponent: 6 });
    expect(n.bech32.account).toBe("qor");
    expect(n.bech32.validator).toBe("qorvaloper");
    expect(n.evmChainId).toBe(9800);
    expect(n.endpoints).toEqual(PUBLIC_ENDPOINTS.testnet);
    expect(n.endpoints.rest).toMatch(/^https:\/\//);
    expect(n.endpoints.evmWs).toMatch(/^wss:\/\//);
    expect(n.endpoints.grpc).toBeUndefined();
    expect(n.endpoints.svmRpc).toBeUndefined();
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
    expect(NETWORKS.mainnet.evmChainId).toBe(9801);
    expect(NETWORKS.mainnet.endpoints).toEqual(PUBLIC_ENDPOINTS.mainnet);
    expect(Object.keys(NETWORKS.mainnet.endpoints).sort()).toEqual(["evmRpc", "rest", "rpc"]);
  });

  it("localnet keeps the localhost ports", () => {
    const n = getNetwork("localnet");
    expect(n.endpoints).toEqual(LOCALNET_ENDPOINTS);
    expect(n.endpoints.rest).toBe("http://localhost:1317");
    expect(n.endpoints.rpc).toBe("http://localhost:26657");
    expect(n.endpoints.evmRpc).toBe("http://localhost:8545");
    expect(n.endpoints.evmWs).toBe("ws://localhost:8546");
    expect(n.endpoints.svmRpc).toBe("http://localhost:8899");
    expect(n.endpoints.grpc).toBe("http://localhost:9090");
    expect(listNetworks()).toEqual(["testnet", "mainnet", "localnet"]);
  });

  it("names the endpoint a preset does not set instead of using localhost", () => {
    expect(() => requireNetworkEndpoint(getNetwork("mainnet"), "evmWs")).toThrow(
      /endpoint "evmWs" is not configured for the mainnet preset/,
    );
    expect(() => requireNetworkEndpoint(getNetwork("testnet"), "svmRpc")).toThrow(/SVM transactions are not open/);
    expect(requireNetworkEndpoint(getNetwork("testnet"), "evmWs")).toBe(PUBLIC_ENDPOINTS.testnet.evmWs);
  });

  it("getNetwork returns the live mainnet config", () => {
    const n = getNetwork("mainnet");
    expect(n.live).toBe(true);
    expect(n.chainId).toBe("qorechain-vladi");
  });
});
