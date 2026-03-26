import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupVitest.ts"],
    exclude: ["**/e2e/**", "**/node_modules/**", "**/dist/**"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@jest/globals": "vitest",
    },
  },
});
