import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/build/**"],
    testTimeout: 30000, // 30 seconds - e2e tests spawn servers
    hookTimeout: 30000, // 30 seconds - before/after hooks may start/stop servers
  },
});
