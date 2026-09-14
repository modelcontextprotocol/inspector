import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// The launcher is plain Node TypeScript (no React/browser), so this mirrors
// the web client's flat config minus the React/Storybook plugins.
export default defineConfig([
  globalIgnores(["build", "coverage"]),
  {
    files: ["**/*.{ts,mts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },
  {
    // Type-aware pass for `no-floating-promises` (#1959) — see the CLI config
    // for the reasoning. Both tsconfig projects are listed because `src` and
    // `__tests__` live in different ones.
    files: ["**/*.{ts,mts}"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
]);
