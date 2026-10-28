import { defineConfig } from "tsdown";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");

// Mirrors clients/cli/tsdown.config.ts (which documents each entry's story):
// this client declares NO runtime dependencies (AGENTS.md dependency-
// placement rule), so tsdown's nearest-manifest auto-externalization sees
// nothing — every root-declared runtime package `core/` imports must be named
// here or Rolldown inlines it, and inlining a CJS module into this ESM bundle
// leaves a `require(...)` shim that throws at first use (#2067).
// `npm run verify:bundle-externals` reads this array as text and enforces it
// against the built output, so keep it a literal of plain strings;
// `neverBundle` below expands each name to cover its subpaths.
const EXTERNALS = [
  "undici",
  "@napi-rs/keyring",
  "proper-lockfile",
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/core",
  "@modelcontextprotocol/ext-apps",
  "@modelcontextprotocol/ext-tasks",
  "commander",
  "pino",
  "ajv",
  "atomically",
  "open",
  "zod",
  "yaml",
  "chokidar",
  "hono",
  "react",
];

/**
 * A plain string in `neverBundle` matches only that exact specifier, unlike
 * tsup's `external`, which also covered subpaths. Without the regex,
 * `zod/v4` and `@modelcontextprotocol/client/stdio` are inlined while the bare
 * names stay external — and the build still succeeds.
 */
function withSubpaths(name: string): (string | RegExp)[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return [name, new RegExp(`^${escaped}/`)];
}

export default defineConfig({
  // Two entries, so the code they share lands in a hashed chunk beside them in
  // `build/`. `src/daemon/ensure.ts` finds the daemon as a sibling
  // `mcpdod.js` of whichever chunk it was emitted into, which holds because
  // every chunk is written flat into `outDir`.
  entry: {
    "mcp-bin": "src/mcp-bin.ts",
    mcpdod: "src/daemon/run.ts",
  },
  format: ["esm"],
  outDir: "build",
  clean: true,
  // No source maps in the published bundle — they roughly double the on-disk
  // size and aren't needed at runtime (debug via `npm run dev` on the source).
  sourcemap: false,
  dts: false,
  target: "node22",
  platform: "node",
  // tsdown defaults to `.mjs` on `platform: "node"`; `bin`, `main`,
  // `src/daemon/ensure.ts` and `scripts/stop-dev-daemon.mjs` all name `.js`.
  fixedExtension: false,
  alias: {
    "@inspector/core": path.join(repoRoot, "core"),
  },
  deps: {
    // Bundle core, including the CLI-client surface it shares with the
    // one-shot CLI (`core/cli/` — handlers, error-handler, OAuth helpers;
    // #2461). Leave npm deps external.
    alwaysBundle: [/^@inspector\/core/],
    neverBundle: EXTERNALS.flatMap(withSubpaths),
  },
  outputOptions: {
    // Rolldown keeps JSDoc blocks by default, which inflates the bundle
    // against tsup's output. Nothing reads them at runtime.
    comments: { jsdoc: false },
  },
});
