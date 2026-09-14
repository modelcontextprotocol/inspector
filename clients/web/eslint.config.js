// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Generated output, none of it first-party source. Web is the only client
  // that emits *two* bundles — `dist` (the Vite SPA) and `build` (the tsup
  // prod-server runner, which vendors ~1.2MB of `undici`) — and only the first
  // was originally listed, so `lint` reported a warning from inside undici's
  // own source that nobody could act on (#2043).
  globalIgnores(["build", "dist", "storybook-static", "coverage"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Promoted from the recommended set's `warn` (#2085). A stale-closure
      // defect was reported correctly on every run and still reached review,
      // because `lint` fails only on errors. `--max-warnings 0` now fails the
      // gate either way; this makes the severity read correctly in an editor
      // too, rather than depending on a CLI flag.
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    // Test setup files re-export utilities and mix components with helpers — the
    // react-refresh rule does not apply.
    files: ["src/test/**/*.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // Type-aware pass for `no-floating-promises` (#1959). The rule needs type
    // information, which `tseslint.configs.recommended` does not provide, and
    // the parser needs a project that literally contains the linted file — so
    // all four leaf projects are listed (`tsconfig.json` itself is a
    // solution file with `files: []`, so it contains nothing).
    //
    // `.d.ts` is excluded: `vitest.shims.d.ts` is pulled in through a `types`
    // reference rather than an `include`, so no project owns it, and a
    // declaration file cannot float a promise anyway.
    files: ["**/*.{ts,tsx}"],
    ignores: ["**/*.d.ts"],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.app.json",
          "./tsconfig.node.json",
          "./tsconfig.storybook.json",
          "./tsconfig.test.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  ...storybook.configs["flat/recommended"],
]);
