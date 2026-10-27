import { defineConfig } from "tsup";

export default defineConfig({
  // `window` is also published as a viem-free subpath (`@qorechain/evm/window`),
  // so the native-side SDK can reuse it without loading viem.
  entry: ["src/index.ts", "src/window.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // viem is a peer dependency and must not be bundled.
  external: ["viem"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
