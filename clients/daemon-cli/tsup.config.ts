import { defineConfig } from "tsup";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");
const cliSrc = path.resolve(dirname, "../cli/src");

export default defineConfig({
  entry: {
    "mcp-bin": "src/mcp-bin.ts",
    daemon: "src/daemon/run.ts",
  },
  format: ["esm"],
  outDir: "build",
  clean: true,
  // No source maps in the published bundle — they roughly double the on-disk
  // size and aren't needed at runtime (debug via `npm run dev` on the source).
  sourcemap: false,
  target: "node22",
  platform: "node",
  // Bundle core + one-shot CLI internals (handlers, error-handler, OAuth helpers).
  // Temporary reach-in until a dedicated shared package exists — tracked by
  // https://github.com/modelcontextprotocol/inspector/issues/2461 (see README).
  noExternal: [/^@inspector\/core/, /^@inspector\/cli/],
  // Mirrors clients/cli/tsup.config.ts (which documents each entry's story):
  // this client declares NO runtime dependencies (AGENTS.md dependency-
  // placement rule), so tsup's nearest-manifest auto-externalization sees
  // nothing — every root-declared runtime package `core/` (or the bundled
  // one-shot CLI source) imports must be named here or esbuild inlines it,
  // and inlining a CJS module into this ESM bundle leaves esbuild's
  // `Dynamic require of "..." is not supported` shim (#2067).
  // `npm run verify:bundle-externals` enforces this against the built output.
  external: [
    "undici",
    "@napi-rs/keyring",
    "proper-lockfile",
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/core",
    "@modelcontextprotocol/ext-apps",
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
  ],
  esbuildOptions(options) {
    options.alias = {
      "@inspector/core": path.join(repoRoot, "core"),
      "@inspector/cli": cliSrc,
    };
  },
});
