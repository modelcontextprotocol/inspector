import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// Root-level lint gate for the shared `core/` package. Each client's own
// `eslint .` is scoped to its own directory, so nothing reached `core/` before
// (#1689) — this config closes that gap. `core/` is isomorphic TypeScript
// (browser-side OAuth + Node backends + shared runtime), so both browser and
// Node globals apply; there is no JSX in `core/`, so no React plugin is needed.
export default defineConfig([
  globalIgnores(["core/**/build/**", "core/**/dist/**"]),
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
    rules: {
      // An `_`-prefix is `core/`'s explicit "intentionally unused" marker —
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
    },
  },
]);
