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
  // Temporary reach-in until a dedicated shared package exists — see README.
  noExternal: [/^@inspector\/core/, /^@inspector\/cli/],
  external: [
    "@napi-rs/keyring",
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/core",
    "commander",
    "pino",
    "open",
  ],
  esbuildOptions(options) {
    options.alias = {
      "@inspector/core": path.join(repoRoot, "core"),
      "@inspector/cli": cliSrc,
    };
  },
});
