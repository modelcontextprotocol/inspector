import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// The CLI is plain Node TypeScript (no React/browser), so this mirrors the web
// client's flat config minus the React/Storybook plugins.
export default defineConfig([
  globalIgnores(["build", "coverage"]),
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },
  {
    // Type-aware pass for `no-floating-promises` (#1959). The rule needs type
    // information, which `tseslint.configs.recommended` does not provide, and
    // the parser needs a project that literally contains the linted file — so
    // both of this client's tsconfig projects are listed, exactly as
    // `npm run typecheck` runs them (`src` is in the first, `__tests__` only
    // in the second).
    files: ["**/*.ts"],
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
