import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Minimal Vite config for the QoreChain full-stack web starter.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
