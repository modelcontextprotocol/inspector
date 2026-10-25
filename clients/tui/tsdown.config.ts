import { defineConfig } from "tsdown";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");

// Every package here renders React components, so it MUST share the one React
// instance the bundle imports. Bundling is what guarantees that: an inlined
// package's `import "react"` is emitted into build/index.js, so it resolves
// from *this* directory exactly like the bundle's own, and no consumer install
// layout can point it elsewhere (#1952).
//
// Left external, npm is free to place a package beside a *different* React,
// because it places one beside a version satisfying that package's own peer
// range — looser than ours in every case here. `ink-form` and
// `ink-scroll-view` accept ">=18", so a consumer's React 18 satisfies them
// while the Inspector's React 19 nests underneath: two React copies, and the
// first hook they call reads a null dispatcher ("Cannot read properties of
// null (reading 'useState')") the moment a tool test form or a scroll view
// mounts. That is the reported crash, and inlining them is its fix.
//
// Both are declared in this client's `dependencies`, which tsdown would
// otherwise externalize; `alwaysBundle` overrides that.
//
// `__tests__/tsdownConfig.test.ts` guards this list.
const BUNDLED = ["ink-form", "ink-scroll-view"];

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
  // `react` is deliberately external — the single instance every inlined
  // package above resolves to, from this build directory. The subpath
  // expansion below also keeps the JSX transform's `react/jsx-runtime` out.
  "react",
  // `ink` is external by a deliberate trade-off, NOT because a ">=19" peer
  // makes it safe — it does not, and that claim was wrong here once already.
  // Bundling it works (verified) but costs ~1.4MB, since react-reconciler and
  // yoga-layout come with it, plus a `createRequire` banner for the inlined
  // CJS. The smaller tarball won.
  //
  // What makes that tolerable is the root manifest's `react: ^19.0.0`: being
  // open to the whole major lets npm satisfy our React and a consumer's
  // pinned one with a single copy, so an external `ink` resolves *ours*. Narrow
  // that range and this exemption turns back into the #1952 crash, one level
  // up — `__tests__/tsdownConfig.test.ts` guards it.
  "ink",
  "open",
  "commander",
  "pino",
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/core",
  // Root-declared and reached through `core/mcp/apps.ts`, so it must be
  // external here like every other root runtime dependency — which client
  // actually reaches it is a function of what `core/` imports, not of this
  // client's own code, so all four lists carry it (AGENTS.md). The CLI was
  // inlining it; the #2067 guard surfaced that.
  "@modelcontextprotocol/ext-apps",
  "@modelcontextprotocol/ext-tasks",
  "@napi-rs/keyring",
  // Root-declared (see the repo's dependency-placement rule) and CJS, which
  // is the combination that bites: tsdown externalizes what the *client's*
  // package.json declares, so a root-only dependency is bundled unless named
  // here — and inlining a CJS module into an ESM bundle leaves a
  // `require("path")` shim that throws at import time and takes the whole
  // binary down before it parses a flag.
  "proper-lockfile",
  // Consolidated to the ROOT manifest by #2195, along with every other
  // runtime dependency `core/` imports. tsdown externalizes only what the
  // *nearest* package.json declares, so once a client stops declaring one it
  // must be named here or Rolldown inlines it — the #2067 failure class, now
  // reached by a manifest edit rather than an omission.
  "ajv",
  "atomically",
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
  "chokidar",
  "hono",
];

/**
 * A plain string in `neverBundle` matches only that exact specifier, unlike
 * tsup's `external`, which also covered subpaths. Without the regex,
 * `zod/v4`, `@modelcontextprotocol/client/stdio` and `react/jsx-runtime` are
 * inlined while the bare names stay external — and the build still succeeds.
 */
function withSubpaths(name: string): (string | RegExp)[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return [name, new RegExp(`^${escaped}/`)];
}

export default defineConfig({
  entry: {
    index: "index.ts",
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
  // tsdown defaults to `.mjs` on `platform: "node"`; `bin`, `main` and
  // `scripts/pack-and-verify.mjs` all name `build/index.js`.
  fixedExtension: false,
  alias: {
    "@inspector/core": path.join(repoRoot, "core"),
  },
  deps: {
    // Bundle core source and the React-rendering packages above; leave every
    // other npm dep external.
    alwaysBundle: [/^@inspector\/core/, ...BUNDLED],
    neverBundle: EXTERNALS.flatMap(withSubpaths),
  },
  inputOptions: {
    transform: {
      // The automatic runtime, matching `jsx: "react-jsx"` in tsconfig.json.
      jsx: "react-jsx",
    },
  },
  outputOptions: {
    // Rolldown keeps JSDoc blocks by default, which inflates the bundle
    // against tsup's output. Nothing reads them at runtime.
    comments: { jsdoc: false },
  },
});
