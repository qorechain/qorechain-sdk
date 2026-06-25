import { describe, it, expect } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  parseAbi,
  type Abi,
} from "viem";
import { decodeEvmError } from "../src/errors";

const ABI: Abi = parseAbi([
  "error InsufficientBalance(uint256 available, uint256 required)",
  "function transfer(address to, uint256 amount)",
]);

describe("decodeEvmError", () => {
  it("decodes a string revert reason", () => {
    const revert = new ContractFunctionRevertedError({
      abi: ABI,
      functionName: "transfer",
      message: "execution reverted: not enough",
    });
    // Force the decoded Error(string) shape.
    (revert as unknown as { data: unknown }).data = {
      errorName: "Error",
      args: ["not enough"],
    };
    const wrapper = new BaseError("call failed", { cause: revert });
    const decoded = decodeEvmError(wrapper);
    expect(decoded.kind).toBe("revert");
    expect(decoded.message).toContain("not enough");
  });

  it("decodes a custom error with named args", () => {
    const revert = new ContractFunctionRevertedError({
      abi: ABI,
      functionName: "transfer",
      message: "reverted",
    });
    (revert as unknown as { data: unknown }).data = {
      errorName: "InsufficientBalance",
      args: [1n, 2n],
    };
    const wrapper = new BaseError("call failed", { cause: revert });
    const decoded = decodeEvmError(wrapper, ABI);
    expect(decoded.kind).toBe("custom_error");
    expect(decoded.errorName).toBe("InsufficientBalance");
    expect(decoded.args).toEqual([1n, 2n]);
  });

  it("decodes raw revert data against the ABI when not pre-decoded", () => {
    const data = encodeErrorResult({
      abi: ABI,
      errorName: "InsufficientBalance",
      args: [5n, 9n],
    });
    const err = new BaseError("reverted") as BaseError & { data?: unknown };
    err.data = data;
    const decoded = decodeEvmError(err, ABI);
    expect(decoded.kind).toBe("custom_error");
    expect(decoded.errorName).toBe("InsufficientBalance");
    expect(decoded.args).toEqual([5n, 9n]);
  });

  it("falls back to a readable message for a plain Error", () => {
    const decoded = decodeEvmError(new Error("nonce too low"));
    expect(decoded.kind).toBe("rpc");
    expect(decoded.message).toBe("nonce too low");
  });

  it("handles non-Error values", () => {
    const decoded = decodeEvmError("boom");
    expect(decoded.kind).toBe("unknown");
    expect(decoded.message).toBe("boom");
  });
});
