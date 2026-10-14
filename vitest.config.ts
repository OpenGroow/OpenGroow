import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/dashboard"),
      "@convex": path.resolve(__dirname, "apps/convex"),
      "@opengroow/openclaw-hooks": path.resolve(__dirname, "plugins/openclaw-hooks/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/src/**/*.test.{ts,tsx}", "apps/**/test/**/*.test.{ts,tsx}", "plugins/**/src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    testTimeout: 20000,
    environmentMatchGlobs: [
      ["apps/convex/test/**", "edge-runtime"],
    ],
  }
});
