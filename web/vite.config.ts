import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The UI is built into dist/, which the Go binary embeds (see embed.go).
// In development, `pnpm dev` proxies the API to a running `whimc serve`.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://127.0.0.1:7777" },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
