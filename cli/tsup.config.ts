import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: false,
  sourcemap: true,
  clean: true,
  // Bundle deps so `npx create-qorechain-dapp` works without a separate install.
  noExternal: [/@clack\/prompts/, /picocolors/],
  banner: { js: "#!/usr/bin/env node" },
});
