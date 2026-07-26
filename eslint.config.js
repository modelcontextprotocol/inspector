import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// Root-level lint gate for first-party code that no client's own `eslint .`
// (each scoped to its own directory) reaches: the shared `core/` package
// (#1689) and the root-owned "shared" surface — `test-servers/src/**`, the
// root `vitest.shared.mts`, and this config file itself (#1767). `core/` is
// isomorphic TypeScript (browser-side OAuth + Node backends + shared runtime);
// the shared surface is Node-only tooling/tests. Neither has JSX, so no React
// plugin is needed.
const sharedRules = {
  // An `_`-prefix is the explicit "intentionally unused" marker —
  // interface-conformance params in fakes, destructuring-rest omissions,
  // and reserved-for-later args. Honor it rather than deleting signal.
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
};

export default defineConfig([
  globalIgnores([
    "core/**/build/**",
    "core/**/dist/**",
    "test-servers/build/**",
  ]),
  {
    files: ["core/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: sharedRules,
  },
  {
    files: [
      "test-servers/src/**/*.{ts,tsx,mts,cts}",
      "vitest.shared.mts",
      "eslint.config.js",
    ],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: sharedRules,
  },
]);
