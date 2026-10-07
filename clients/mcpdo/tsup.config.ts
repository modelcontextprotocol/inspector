import { defineConfig } from "tsup";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");

export default defineConfig({
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
  target: "node22",
  platform: "node",
  // Bundle core, including the CLI-client surface it shares with the one-shot
  // CLI (`core/cli/` — handlers, error-handler, OAuth helpers; #2461).
  noExternal: [/^@inspector\/core/],
  // Mirrors clients/cli/tsup.config.ts (which documents each entry's story):
  // this client declares NO runtime dependencies (AGENTS.md dependency-
  // placement rule), so tsup's nearest-manifest auto-externalization sees
  // nothing — every root-declared runtime package `core/` imports must be named here or esbuild inlines it,
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
  ],
  esbuildOptions(options) {
    options.alias = {
      "@inspector/core": path.join(repoRoot, "core"),
    };
  },
});
