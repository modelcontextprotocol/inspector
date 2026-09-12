import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// Root-level lint gate for first-party code that no client's own `eslint .`
// (each scoped to its own directory) reaches: the shared `core/` package
// (#1689) and the root-owned "shared" surface — `test-servers/src/**`, the
// root `vitest.shared.mts`, and this config file itself (#1767). `core/` is
// isomorphic TypeScript (browser-side OAuth + Node backends + shared runtime);
// the shared surface is Node-only tooling/tests.
//
// `core/react/` gets the React hook rules, and "neither surface has JSX" was
// never a reason to withhold them — the hook rules judge hooks, not JSX, and
// that directory is nothing but hooks. Until #2192 the whole
// `eslint-plugin-react-hooks` set, `set-state-in-effect` included, had never
// looked at them: every copy of the plugin was *client-local* (a devDependency
// of `clients/web` and of `clients/tui`), and Node resolution walks up rather
// than down, so the root could reach neither. That is how the prop-into-effect
// re-sync #1955 fixed sat here unreported while the identical shape was an
// error over in `clients/web/src`. The plugin is now a root devDependency too,
// and the block below applies it.
//
// Scoped to `core/react/**` rather than all of `core/**`: everything else
// there is plain isomorphic TypeScript, and the rules key off the `use`-prefix
// naming convention, so a non-React `useFoo` helper elsewhere in `core/` would
// be judged as a hook it is not.
//
// Type-aware linting for the `core/` and shared surfaces below.
// `no-floating-promises` needs type information, which
// `tseslint.configs.recommended` (the non-type-aware set) does not provide —
// so a block of its own adds a parser project (#1959).
//
// `tsconfig.lint.json` exists for this and nothing else: the root has no
// tsconfig of its own (`core/` is typechecked through `clients/web`'s
// `tsc -b`, `test-servers/src` through `clients/cli`'s test project), and a
// parser project must literally *contain* every file it is asked to lint.
const typeAware = {
  languageOptions: {
    parserOptions: {
      project: ["./tsconfig.lint.json"],
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    // The class this catches is invisible at review time: the call reads like
    // an awaited one minus four characters, and the unhandled rejection it
    // produces surfaces in a different test, in a different file, as a stack
    // pointing at SDK internals — which is how #1947 came to fail the whole
    // `npm run local:gate` chain from two un-held `callTool` promises.
    "@typescript-eslint/no-floating-promises": "error",
  },
};

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
    // #2192. `exhaustive-deps` is promoted from the recommended set's `warn`
    // for the same reason `clients/web` promotes it (#2085): `--max-warnings 0`
    // already fails the gate on it, and matching the severity keeps an editor
    // squiggle honest rather than depending on a CLI flag.
    files: ["core/react/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: [
      "test-servers/src/**/*.{ts,tsx,mts,cts}",
      "vitest.shared.mts",
      "vitest.setup.shared.mts",
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
  {
    // Type-aware pass over the same surface, minus `eslint.config.js` — it is
    // JavaScript, so no tsconfig contains it and asking the parser for a
    // project would fail it outright rather than lint it.
    files: [
      "core/**/*.{ts,tsx}",
      "test-servers/src/**/*.{ts,tsx,mts,cts}",
      "vitest.shared.mts",
      "vitest.setup.shared.mts",
    ],
    ...typeAware,
  },
]);
