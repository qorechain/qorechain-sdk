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
  erc721,
  ERC721_ABI,
} from "../src/index";

// Well-known throwaway test key (anvil account #0). Never used on a live network.
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

describe("erc721 ABI", () => {
  it("is exported and includes the standard functions", () => {
    const names = ERC721_ABI.filter((e) => e.type === "function").map(
      (e) => (e as { name: string }).name,
    );
    for (const fn of [
      "balanceOf",
      "ownerOf",
      "tokenURI",
      "getApproved",
      "isApprovedForAll",
      "approve",
      "setApprovalForAll",
      "transferFrom",
      "safeTransferFrom",
      "name",
      "symbol",
    ]) {
      expect(names).toContain(fn);
    }
  });
});

describe("erc721 read helpers", () => {
  it("ownerOf issues ownerOf(uint256) calldata and decodes the address", async () => {
    let seenTo: Hex | undefined;
    let seenData: Hex | undefined;
    const transport = readTransport((to, data) => {
      seenTo = to;
      seenData = data;
      return encodeFunctionResult({ abi: ERC721_ABI, functionName: "ownerOf", result: OWNER });
    });
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
    expect(await erc721.ownerOf(client.publicClient, NFT, 42n)).toBe(OWNER);
    expect(seenTo?.toLowerCase()).toBe(NFT);
    const decoded = decodeFunctionData({ abi: ERC721_ABI, data: seenData! });
    expect(decoded.functionName).toBe("ownerOf");
    expect(decoded.args).toEqual([42n]);
  });

  it("tokenURI returns the URI string", async () => {
    const transport = readTransport(() =>
      encodeFunctionResult({ abi: ERC721_ABI, functionName: "tokenURI", result: "ipfs://abc/1" }),
    );
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
    expect(await erc721.tokenURI(client.publicClient, NFT, 1n)).toBe("ipfs://abc/1");
  });

  it("metadata reads name + symbol", async () => {
    const transport = readTransport((_to, data) => {
      const { functionName } = decodeFunctionData({ abi: ERC721_ABI, data });
      if (functionName === "name")
        return encodeFunctionResult({ abi: ERC721_ABI, functionName: "name", result: "QoreApes" });
      if (functionName === "symbol")
        return encodeFunctionResult({ abi: ERC721_ABI, functionName: "symbol", result: "QAPE" });
      throw new Error(`unexpected ${functionName}`);
    });
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
    expect(await erc721.metadata(client.publicClient, NFT)).toEqual({
      name: "QoreApes",
      symbol: "QAPE",
    });
  });

  it("isApprovedForAll forwards (owner,operator)", async () => {
    let seenData: Hex | undefined;
    const transport = readTransport((_to, data) => {
      seenData = data;
      return encodeFunctionResult({
        abi: ERC721_ABI,
        functionName: "isApprovedForAll",
        result: true,
      });
    });
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
    expect(await erc721.isApprovedForAll(client.publicClient, NFT, OWNER, OPERATOR)).toBe(true);
    const decoded = decodeFunctionData({ abi: ERC721_ABI, data: seenData! });
    expect(decoded.functionName).toBe("isApprovedForAll");
    expect(decoded.args).toEqual([OWNER, OPERATOR]);
  });
});

describe("erc721 write helpers", () => {
  it("transferFrom encodes transferFrom(from,to,tokenId) to the NFT contract", async () => {
    const { transport, raws } = writeTransport();
    const wc = await walletClient(transport);
    await erc721.transferFrom(wc, NFT, OWNER, TO, 7n);
    const tx = parseTransaction(raws[0]);
    expect(tx.to?.toLowerCase()).toBe(NFT);
    expect(tx.data?.slice(0, 10)).toBe(toFunctionSelector("transferFrom(address,address,uint256)"));
    const decoded = decodeFunctionData({ abi: ERC721_ABI, data: tx.data! });
    expect(decoded.args).toEqual([OWNER, TO, 7n]);
  });

  it("setApprovalForAll encodes setApprovalForAll(operator,bool)", async () => {
    const { transport, raws } = writeTransport();
    const wc = await walletClient(transport);
    await erc721.setApprovalForAll(wc, NFT, OPERATOR, true);
    const tx = parseTransaction(raws[0]);
    const decoded = decodeFunctionData({ abi: ERC721_ABI, data: tx.data! });
    expect(decoded.functionName).toBe("setApprovalForAll");
    expect(decoded.args).toEqual([OPERATOR, true]);
  });

  it("safeTransferFrom with data uses the 4-arg overload", async () => {
    const { transport, raws } = writeTransport();
    const wc = await walletClient(transport);
    await erc721.safeTransferFrom(wc, NFT, OWNER, TO, 9n, "0xbeef");
    const tx = parseTransaction(raws[0]);
    expect(tx.data?.slice(0, 10)).toBe(
      toFunctionSelector("safeTransferFrom(address,address,uint256,bytes)"),
    );
    const decoded = decodeFunctionData({ abi: ERC721_ABI, data: tx.data! });
    expect(decoded.args).toEqual([OWNER, TO, 9n, "0xbeef"]);
  });

  it("safeTransferFrom without data uses the 3-arg overload", async () => {
    const { transport, raws } = writeTransport();
    const wc = await walletClient(transport);
    await erc721.safeTransferFrom(wc, NFT, OWNER, TO, 9n);
    const tx = parseTransaction(raws[0]);
    expect(tx.data?.slice(0, 10)).toBe(
      toFunctionSelector("safeTransferFrom(address,address,uint256)"),
    );
  });
});
