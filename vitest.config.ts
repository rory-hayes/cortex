import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "scripts/**/*.{test,spec}.ts",
      "apps/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.ts",
    ],
    testTimeout: 30_000,
  },
});
