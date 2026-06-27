import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // The EVM adapter is an optional peer (re-exported for discovery only) and its
  // viem peer must never be bundled into the core cosmos-side SDK.
  external: ["@qorechain/evm", "viem"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
