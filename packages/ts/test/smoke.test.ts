import { describe, it, expect } from "vitest";
import { VERSION } from "../src/index";

describe("smoke", () => {
  it("exports a string VERSION", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });
});
