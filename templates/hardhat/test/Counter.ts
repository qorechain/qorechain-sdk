import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

describe("Counter", async () => {
  // Runs on Hardhat's simulated network; no QoreChain endpoint is needed.
  const { viem } = await network.create();

  it("starts at the constructor value", async () => {
    const counter = await viem.deployContract("Counter", [41n]);
    assert.equal(await counter.read.count(), 41n);
  });

  it("increments and emits CountChanged", async () => {
    const counter = await viem.deployContract("Counter", [41n]);
    await viem.assertions.emitWithArgs(counter.write.increment(), counter, "CountChanged", [42n]);
    assert.equal(await counter.read.count(), 42n);
  });
});
