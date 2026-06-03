import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      importSource: "react",
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "app/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
      "test/**/*.{test,spec}.{ts,tsx}",
      "apps/web/app/**/*.{test,spec}.{ts,tsx}",
      "apps/web/src/**/*.{test,spec}.{ts,tsx}",
      "apps/web/test/**/*.{test,spec}.{ts,tsx}",
    ],
    testTimeout: 30_000,
  },
});
