import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Minimal Vite config for the QoreChain viem + wagmi starter.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
