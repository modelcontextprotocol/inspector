import { defineConfig } from "tsup";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");

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
  target: "node22",
  platform: "node",
  // Bundle core source; leave npm deps external.
  noExternal: [/^@inspector\/core/],
  external: [
    // `undici` MUST stay external. It is CommonJS, so inlining it rewrites
    // `import("undici")` to a relative chunk whose `require("assert")` hits
    // esbuild's ESM `__require` shim and throws "Dynamic require of \"assert\"
    // is not supported" — and because the specifier was rewritten at build time,
    // no user-side install can ever satisfy it (#2067). It is declared in the
    // ROOT manifest only, so tsup cannot infer this from a nearest-manifest
    // lookup; the entry has to be explicit.
    "undici",
    "@napi-rs/keyring",
    // Root-declared (see the repo's dependency-placement rule) and CJS, which
    // is the combination that bites: tsup externalizes what the *client's*
    // package.json declares, so a root-only dependency is bundled unless named
    // here — and inlining a CJS module into an ESM bundle leaves esbuild's
    // `Dynamic require of "path" is not supported` shim, which throws at
    // import time and takes the whole binary down before it parses a flag.
    "proper-lockfile",
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/core",
    // Root-declared and reached through `core/mcp/apps.ts`, so it must be
    // external here like every other root runtime dependency (AGENTS.md). This
    // client was actually inlining it — dragging the transitive v1 SDK and
    // zod-to-json-schema in with it — which the #2067 guard surfaced. ESM, so it
    // was not failing the way `undici` did; the rule is what it violated.
    "@modelcontextprotocol/ext-apps",
    "commander",
    "pino",
    // Consolidated to the ROOT manifest by #2195, along with every other
    // runtime dependency `core/` imports. tsup externalizes only what the
    // *nearest* package.json declares, so once a client stops declaring one it
    // must be named here or esbuild inlines it — the #2067 failure class, now
    // reached by a manifest edit rather than an omission.
    "ajv",
    "atomically",
    "open",
    "zod",
    // Newly on `core/`'s runtime import graph as of #2248:
    // `core/mcp/skillFile.ts` parses a served SKILL.md's YAML frontmatter to
    // check it against the entry the listing advertised (SEP-2640). Already a
    // root `dependency` — it was reached from `test-servers/src` — so this
    // adds no package, but a root-declared dependency `core/` imports must be
    // named in all three `external` lists or tsup inlines it here.
    "yaml",
    // Reached through `core/` but not through this client's own code today.
    // AGENTS.md requires every root-declared package `core/` imports at runtime
    // in ALL three lists regardless, because which client reaches one is a
    // function of what `core/` imports rather than of what the client names —
    // so the list must not depend on today's reachability (Copilot).
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
