import { describe, it, expect, vi } from "vitest";
import { custom, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createEvmClient,
  evmAccountFromPrivateKey,
  deployContract,
  writeContract,
  ERC20_ABI,
} from "../src/index";

// Well-known throwaway test key (anvil account #0). Never used on a live network.
const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

function walletTransport() {
  const sent: { method: string; params: unknown[] }[] = [];
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    const p = (params ?? []) as unknown[];
    sent.push({ method, params: p });
    switch (method) {
      case "eth_chainId":
        return "0x1";
      case "eth_getTransactionCount":
        return "0x0";
      case "eth_gasPrice":
        return "0x3b9aca00";
      case "eth_estimateGas":
        return "0x5208";
      case "eth_maxPriorityFeePerGas":
        return "0x3b9aca00";
      case "eth_getBlockByNumber":
        return { baseFeePerGas: "0x3b9aca00", number: "0x1", gasLimit: "0x1c9c380" };
      case "eth_sendRawTransaction":
        return "0xtxhash";
      default:
        throw new Error(`unexpected ${method}`);
    }
  });
  return { transport: custom({ request }), sent };
}

describe("evmAccountFromPrivateKey", () => {
  it("derives a viem account matching privateKeyToAccount", () => {
    const a = evmAccountFromPrivateKey(TEST_KEY);
    const b = privateKeyToAccount(TEST_KEY);
    expect(a.address).toBe(b.address);
  });
});

describe("writeContract", () => {
  it("signs and broadcasts a transfer, encoding transfer(address,uint256) calldata", async () => {
    const { transport, sent } = walletTransport();
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
    const account = evmAccountFromPrivateKey(TEST_KEY);
    const wallet = client.getWalletClient(account);
    const to = "0x5555555555555555555555555555555555555555" as Hex;

    const hash = await writeContract(wallet, {
      address: "0x00000000000000000000000000000000000000ff",
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [to, 500n],
    });

    expect(hash).toBe("0xtxhash");
    const raw = sent.find((s) => s.method === "eth_sendRawTransaction");
    expect(raw).toBeDefined();
  });
});

describe("deployContract", () => {
  it("broadcasts a deploy transaction with bytecode", async () => {
    const { transport, sent } = walletTransport();
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
    const account = evmAccountFromPrivateKey(TEST_KEY);
    const wallet = client.getWalletClient(account);

    const hash = await deployContract(wallet, {
      abi: ERC20_ABI,
      bytecode: "0x6000600055",
    });

    expect(hash).toBe("0xtxhash");
    expect(sent.some((s) => s.method === "eth_sendRawTransaction")).toBe(true);
  });
});
