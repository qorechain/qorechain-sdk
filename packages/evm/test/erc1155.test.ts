import { describe, it, expect, vi } from "vitest";
import {
  custom,
  encodeFunctionResult,
  decodeFunctionData,
  parseTransaction,
  toFunctionSelector,
  type Hex,
} from "viem";
import {
  createEvmClient,
  evmAccountFromPrivateKey,
  erc1155,
  ERC1155_ABI,
} from "../src/index";

const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const NFT = "0x00000000000000000000000000000000000000ff" as const;
const OWNER = "0x1111111111111111111111111111111111111111" as const;
const OPERATOR = "0x2222222222222222222222222222222222222222" as const;
const TO = "0x3333333333333333333333333333333333333333" as const;

function readTransport(call: (to: Hex, data: Hex) => Hex) {
  const request = vi.fn(
    async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_call") {
        const { to, data } = (params as { to: Hex; data: Hex }[])[0];
        return call(to, data);
      }
      throw new Error(`unexpected ${method}`);
    },
  );
  return custom({ request });
}

function writeTransport() {
  const raws: Hex[] = [];
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    const p = (params ?? []) as unknown[];
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
        raws.push(p[0] as Hex);
        return "0xtxhash";
      default:
        throw new Error(`unexpected ${method}`);
    }
  });
  return { transport: custom({ request }), raws };
}

async function walletClient(transport: ReturnType<typeof custom>) {
  const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
  return client.getWalletClient(evmAccountFromPrivateKey(TEST_KEY));
}

describe("erc1155 ABI", () => {
  it("is exported and includes the standard functions", () => {
    const names = ERC1155_ABI.filter((e) => e.type === "function").map(
      (e) => (e as { name: string }).name,
    );
    for (const fn of [
      "balanceOf",
      "balanceOfBatch",
      "uri",
      "isApprovedForAll",
      "setApprovalForAll",
      "safeTransferFrom",
      "safeBatchTransferFrom",
    ]) {
      expect(names).toContain(fn);
    }
  });
});

describe("erc1155 read helpers", () => {
  it("balanceOf forwards (account,id)", async () => {
    let seenData: Hex | undefined;
    const transport = readTransport((_to, data) => {
      seenData = data;
      return encodeFunctionResult({ abi: ERC1155_ABI, functionName: "balanceOf", result: 5n });
    });
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
    expect(await erc1155.balanceOf(client.publicClient, NFT, OWNER, 3n)).toBe(5n);
    const decoded = decodeFunctionData({ abi: ERC1155_ABI, data: seenData! });
    expect(decoded.functionName).toBe("balanceOf");
    expect(decoded.args).toEqual([OWNER, 3n]);
  });

  it("balanceOfBatch forwards (accounts[],ids[]) and decodes the array", async () => {
    let seenData: Hex | undefined;
    const transport = readTransport((_to, data) => {
      seenData = data;
      return encodeFunctionResult({
        abi: ERC1155_ABI,
        functionName: "balanceOfBatch",
        result: [1n, 2n],
      });
    });
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
    const res = await erc1155.balanceOfBatch(client.publicClient, NFT, [OWNER, OPERATOR], [1n, 2n]);
    expect(res).toEqual([1n, 2n]);
    const decoded = decodeFunctionData({ abi: ERC1155_ABI, data: seenData! });
    expect(decoded.functionName).toBe("balanceOfBatch");
    expect(decoded.args).toEqual([[OWNER, OPERATOR], [1n, 2n]]);
  });

  it("uri returns the URI template", async () => {
    const transport = readTransport(() =>
      encodeFunctionResult({ abi: ERC1155_ABI, functionName: "uri", result: "ipfs://x/{id}" }),
    );
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
    expect(await erc1155.uri(client.publicClient, NFT, 1n)).toBe("ipfs://x/{id}");
  });
});

describe("erc1155 write helpers", () => {
  it("safeTransferFrom encodes (from,to,id,amount,bytes)", async () => {
    const { transport, raws } = writeTransport();
    const wc = await walletClient(transport);
    await erc1155.safeTransferFrom(wc, NFT, OWNER, TO, 4n, 2n, "0x");
    const tx = parseTransaction(raws[0]);
    expect(tx.to?.toLowerCase()).toBe(NFT);
    expect(tx.data?.slice(0, 10)).toBe(
      toFunctionSelector("safeTransferFrom(address,address,uint256,uint256,bytes)"),
    );
    const decoded = decodeFunctionData({ abi: ERC1155_ABI, data: tx.data! });
    expect(decoded.args).toEqual([OWNER, TO, 4n, 2n, "0x"]);
  });

  it("safeBatchTransferFrom encodes (from,to,ids[],amounts[],bytes)", async () => {
    const { transport, raws } = writeTransport();
    const wc = await walletClient(transport);
    await erc1155.safeBatchTransferFrom(wc, NFT, OWNER, TO, [1n, 2n], [10n, 20n], "0x");
    const tx = parseTransaction(raws[0]);
    expect(tx.data?.slice(0, 10)).toBe(
      toFunctionSelector("safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)"),
    );
    const decoded = decodeFunctionData({ abi: ERC1155_ABI, data: tx.data! });
    expect(decoded.args).toEqual([OWNER, TO, [1n, 2n], [10n, 20n], "0x"]);
  });

  it("setApprovalForAll encodes (operator,bool)", async () => {
    const { transport, raws } = writeTransport();
    const wc = await walletClient(transport);
    await erc1155.setApprovalForAll(wc, NFT, OPERATOR, true);
    const tx = parseTransaction(raws[0]);
    const decoded = decodeFunctionData({ abi: ERC1155_ABI, data: tx.data! });
    expect(decoded.functionName).toBe("setApprovalForAll");
    expect(decoded.args).toEqual([OPERATOR, true]);
  });
});
