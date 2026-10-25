import { defineConfig } from "tsdown";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");

// Every npm package this bundle must leave external, as bare package names.
// `scripts/verify-bundle-externals.mjs` reads this array as text, so keep it a
// literal of plain strings; `neverBundle` below expands each name to cover its
// subpaths.
const EXTERNALS = [
  // `undici` MUST stay external. It is CommonJS, so inlining it rewrites
  // `import("undici")` to a relative chunk whose CJS `require("assert")` has no
  // ESM equivalent and throws at first use — and because the specifier was
  // rewritten at build time, no user-side install can ever satisfy it (#2067).
  // It is declared in the ROOT manifest only, so tsdown cannot infer this from
  // a nearest-manifest lookup; the entry has to be explicit.
  "undici",
  "commander",
  "open",
  "pino",
  "hono",
  "@hono/node-server",
  "vite",
  "@vitejs/plugin-react",
  "atomically",
  "chokidar",
  "@napi-rs/keyring",
  // Root-declared (see the repo's dependency-placement rule) and CJS, which
  // is the combination that bites: tsdown externalizes what the *client's*
  // package.json declares, so a root-only dependency is bundled unless named
  // here — and inlining a CJS module into an ESM bundle leaves a
  // `require("path")` shim that throws at import time and takes the whole
  // binary down before it parses a flag.
  "proper-lockfile",
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/core",
  // Root-declared and reached through `core/mcp/apps.ts`, so it must be
  // external here like every other root runtime dependency — which client
  // actually reaches it is a function of what `core/` imports, not of this
  // client's own code, so all four lists carry it (AGENTS.md). The CLI was
  // inlining it; the #2067 guard surfaced that.
  "@modelcontextprotocol/ext-apps",
  "@modelcontextprotocol/ext-tasks",
  // Consolidated to the ROOT manifest by #2195, along with every other
  // runtime dependency `core/` imports. tsdown externalizes only what the
  // *nearest* package.json declares, so once a client stops declaring one it
  // must be named here or Rolldown inlines it — the #2067 failure class, now
  // reached by a manifest edit rather than an omission.
  "ajv",
  "zod",
  // Newly on `core/`'s runtime import graph as of #2248:
  // `core/mcp/skillFile.ts` parses a served SKILL.md's YAML frontmatter to
  // check it against the entry the listing advertised (SEP-2640). Already a
  // root `dependency` — it was reached from `test-servers/src` — so this
  // adds no package, but a root-declared dependency `core/` imports must be
  // named in all four `external` lists or the bundler inlines it here.
  "yaml",
  // Reached through `core/` but not through this client's own code today.
  // AGENTS.md requires every root-declared package `core/` imports at runtime
  // in ALL four lists regardless, because which client reaches one is a
  // function of what `core/` imports rather than of what the client names —
  // so the list must not depend on today's reachability (Copilot).
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
  entry: {
    index: "src/index.ts",
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
  // tsdown defaults to `.mjs` on `platform: "node"`; `bin`, `main`, `exports`
  // and `scripts/pack-and-verify.mjs` all name `build/index.js`.
  fixedExtension: false,
  alias: {
    "@inspector/core": path.join(repoRoot, "core"),
  },
  deps: {
    // Bundle core source; leave npm deps external.
    alwaysBundle: [/^@inspector\/core/],
    neverBundle: EXTERNALS.flatMap(withSubpaths),
  },
  outputOptions: {
    // Rolldown keeps JSDoc blocks by default, which inflates the bundle
    // against tsup's output. Nothing reads them at runtime.
    comments: { jsdoc: false },
  },
});
