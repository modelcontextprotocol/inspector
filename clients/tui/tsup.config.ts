import { defineConfig, type Options } from "tsup";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");

/**
 * `ink-form` hardcodes a misspelled hint under an incomplete form — "you have
 * not competed yet" — with no prop to override it. It is upstream's string
 * (`ink-form/lib/SubmitButton.js`), last published in 2024, but it renders in
 * the Inspector's tool/prompt/resource test forms, so we correct it on the way
 * into the bundle. Reported upstream as lukasbach/ink-form#14; drop this patch
 * if a release ever carries the fix.
 *
 * This is only possible because `ink-form` is inlined (see `noExternal` below).
 */
export const INK_FORM_INCOMPLETE_HINT = {
  typo: "There are still required inputs you have not competed yet.",
  fixed: "There are still required inputs you have not completed yet.",
};

/**
 * Applies the correction above, throwing if the string is no longer there.
 *
 * Failing loudly is the point: a silent no-op would let an `ink-form` upgrade
 * (or a fixed upstream, or a reworded label) quietly retire this patch with
 * nobody noticing it had stopped applying — or, worse, leave a patch here for a
 * string that no longer exists. If this throws, check whether upstream fixed
 * the typo; if so, delete this patch rather than re-targeting it.
 */
export function fixInkFormIncompleteHint(source: string, file: string): string {
  if (!source.includes(INK_FORM_INCOMPLETE_HINT.typo)) {
    throw new Error(
      `${file} no longer contains the ink-form label this build patches ` +
        `(${JSON.stringify(INK_FORM_INCOMPLETE_HINT.typo)}). If upstream fixed ` +
        `the typo, remove fixInkFormIncompleteHint from tsup.config.ts.`,
    );
  }
  return source.replaceAll(
    INK_FORM_INCOMPLETE_HINT.typo,
    INK_FORM_INCOMPLETE_HINT.fixed,
  );
}

/**
 * Which module the patch above is applied to.
 *
 * Exported so the tests can check it against the *resolved* path of the real
 * `ink-form` module — a filter that stops matching is the one way this patch
 * can silently no-op, since `fixInkFormIncompleteHint` would then never run.
 */
export const INK_FORM_SUBMIT_BUTTON = /ink-form[\\/]lib[\\/]SubmitButton\.js$/;

// The plugin type is derived from tsup rather than imported from `esbuild`:
// `esbuild` is tsup's transitive dependency, not a declared one of this client,
// so a direct import typechecks only while npm happens to hoist it.
type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

export const inkFormLabelPatch: EsbuildPlugin = {
  name: "ink-form-label-patch",
  setup(build) {
    build.onLoad(
      { filter: INK_FORM_SUBMIT_BUTTON },
      async ({ path: file }) => ({
        contents: fixInkFormIncompleteHint(await readFile(file, "utf8"), file),
        loader: "js",
      }),
    );
  },
};

export default defineConfig({
  entry: ["index.ts"],
  format: ["esm"],
  outDir: "build",
  clean: true,
  // No source maps in the published bundle — they roughly double the on-disk
  // size and aren't needed at runtime (debug via `npm run dev` on the source).
  sourcemap: false,
  target: "node22",
  platform: "node",
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
  // `__tests__/tsupConfig.test.ts` guards this list.
  noExternal: [/^@inspector\/core/, "ink-form", "ink-scroll-view"],
  external: [
    // `undici` MUST stay external. It is CommonJS, so inlining it rewrites
    // `import("undici")` to a relative chunk whose `require("assert")` hits
    // esbuild's ESM `__require` shim and throws "Dynamic require of \"assert\"
    // is not supported" — and because the specifier was rewritten at build time,
    // no user-side install can ever satisfy it (#2067). It is declared in the
    // ROOT manifest only, so tsup cannot infer this from a nearest-manifest
    // lookup; the entry has to be explicit.
    "undici",
    // `react` is deliberately external — the single instance every inlined
    // package above resolves to, from this build directory.
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
    // up — `__tests__/tsupConfig.test.ts` guards it.
    "ink",
    "open",
    "commander",
    "pino",
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/core",
    // Root-declared and reached through `core/mcp/apps.ts`, so it must be
    // external here like every other root runtime dependency — which client
    // actually reaches it is a function of what `core/` imports, not of this
    // client's own code, so all three lists carry it (AGENTS.md). The CLI was
    // inlining it; the #2067 guard surfaced that.
    "@modelcontextprotocol/ext-apps",
    "@napi-rs/keyring",
    // Root-declared (see the repo's dependency-placement rule) and CJS, which
    // is the combination that bites: tsup externalizes what the *client's*
    // package.json declares, so a root-only dependency is bundled unless named
    // here — and inlining a CJS module into an ESM bundle leaves esbuild's
    // `Dynamic require of "path" is not supported` shim, which throws at
    // import time and takes the whole binary down before it parses a flag.
    "proper-lockfile",
    // Consolidated to the ROOT manifest by #2195, along with every other
    // runtime dependency `core/` imports. tsup externalizes only what the
    // *nearest* package.json declares, so once a client stops declaring one it
    // must be named here or esbuild inlines it — the #2067 failure class, now
    // reached by a manifest edit rather than an omission.
    "ajv",
    "atomically",
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
  ],
  esbuildPlugins: [inkFormLabelPatch],
  esbuildOptions(options) {
    options.alias = {
      "@inspector/core": path.join(repoRoot, "core"),
    };
    options.jsx = "automatic";
  },
});
