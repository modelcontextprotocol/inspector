import path from "path";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Extend Vite config for Vitest (shared resolve, plugins)
export default defineConfig({
  ...viteConfig,
  plugins: viteConfig.plugins || [],
  resolve: {
    ...viteConfig.resolve,
    alias: {
      ...viteConfig.resolve?.alias,
      "\\.css$": path.resolve(__dirname, "src/__mocks__/styleMock.js"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/__tests__/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    exclude: [
      "node_modules",
      "dist",
      "bin",
      "e2e",
      "**/*.config.{js,ts,cjs,mjs}",
    ],
    coverage: {
      exclude: [
        "node_modules",
        "dist",
        "bin",
        "e2e",
        "**/*.config.{js,ts,cjs,mjs}",
        "**/__mocks__/**",
      ],
    },
  },
});
