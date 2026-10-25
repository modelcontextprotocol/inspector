# Migrating from tsup to tsdown

Findings and recommendation for [#1492](https://github.com/modelcontextprotocol/inspector/issues/1492).

## Recommendation

**Migrate, one client at a time.** The CLI moved first (this change) as the
prototype. It builds, passes its full suite including the e2e tests that spawn
the built binary, keeps exactly the same set of bare imports as the tsup
bundle, and passes `verify:bundle-externals`. Nothing blocks the other three.
What's left is a set of gotchas, all listed below, and each one now has a guard
or a test.

Why move at all: [tsup](https://github.com/egoist/tsup) is effectively
unmaintained, and its README points users to
[tsdown](https://tsdown.dev/). It also pins an esbuild range with no upward
escape from a past advisory, which is why every client that builds with tsup
carries an `esbuild` `overrides` entry. Moving the CLI deleted that override and its
`allowScripts` entries along with tsup: neither `esbuild` nor `fsevents` (from
tsup's rollup) is in the CLI's install any more.

## Inventory

| Build      | Config                              | Entries                         | Relies on                                                                                                                                                      |
| ---------- | ----------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI        | `clients/cli/tsdown.config.ts`      | `index`                         | **Migrated.**                                                                                                                                                  |
| Web runner | `clients/web/tsup.runner.config.ts` | `src/index.ts`                  | `@inspector/core` alias, `noExternal`, `external`                                                                                                              |
| mcpdo      | `clients/mcpdo/tsup.config.ts`      | `mcp-bin`, `mcpdod`             | The same, plus two entries (and therefore shared chunks); `src/daemon/ensure.ts` locates `mcpdod.js` relative to the running chunk                             |
| TUI        | `clients/tui/tsup.config.ts`        | `index.ts`                      | The same, plus `jsx: "automatic"`, and `ink-form` / `ink-scroll-view` in `noExternal`. `__tests__/tsupConfig.test.ts` imports the config and tsup's `Options` type |

`test-servers` is built with plain `tsc`, not tsup, and `clients/launcher` is
also `tsc`. Neither is in scope.

## Option mapping

| tsup                                  | tsdown                                                       |
| ------------------------------------- | ------------------------------------------------------------ |
| `esbuildOptions(o) { o.alias = … }`   | top-level `alias`                                            |
| `noExternal`                          | `deps.alwaysBundle`                                          |
| `external`                            | `deps.neverBundle` (see gotcha 1)                            |
| `esbuildOptions(o) { o.jsx = … }`     | `inputOptions.transform.jsx` (for the TUI, not yet tried here) |
| `format`, `target`, `platform`, `outDir`, `clean`, `sourcemap` | unchanged                           |
| shebang preserved, exec bit set       | unchanged; tsdown sets the exec bit itself                   |

`external` and `noExternal` still work in tsdown, but they're deprecated
aliases, so the CLI config uses the `deps.*` names.

## Gotchas

None of these fails the build, so each one needs a guard or a test to catch it.

1. **`neverBundle` strings match the exact specifier only.** tsup's `external:
   ["zod"]` also covered `zod/v4`; tsdown's doesn't. Listing bare names silently
   inlined subpath imports of six packages (`@modelcontextprotocol/client`,
   `core`, `ext-apps` and `ext-tasks`, plus `zod` and `hono`), and the bundle
   grew to 1.36 MB. tsdown prints
   a "Detected dependencies in bundle" hint and the build still succeeds. The
   config keeps a `const EXTERNALS = [...]` of bare names and expands each one
   to the name plus a `^name/` pattern. `verify:bundle-externals` caught all six
   inlined packages when the expansion was removed.
2. **Output defaults to `.mjs` on `platform: "node"`.** `fixedExtension: false`
   keeps `build/index.js`, which `bin`, `main`, the e2e test and
   `scripts/pack-and-verify.mjs` all name.
3. **Rolldown keeps JSDoc comments.** That produced a 1.22 MB CLI bundle.
   `outputOptions.comments: { jsdoc: false }` brings it to 684 KB, against
   tsup's 844 KB.
4. **Module banners vary by Rolldown release.** Rolldown 1.2.13, the version
   this repo builds with, writes `//#region <path>`. 1.2.15 writes esbuild's
   `// <path>`. `verify:bundle-externals` reads banners to find inlined
   packages, so it now accepts both forms. A bundle with neither still fails
   loudly as banner-less.
5. **Rolldown is also Vite's bundler**, so it reaches two installs: the root
   (through `vite`) and the CLI (through `tsdown`). tsdown 0.23.1 accepts
   `~1.2.13` and resolved 1.2.15, while Vite sits on 1.2.13, and
   `verify:dep-lockstep` refuses the skew. The CLI pins its copy to the root's
   with an `overrides` entry, the same mechanism it uses for `@types/node`.
   That override has to move whenever the root's Vite moves Rolldown, and the
   lockstep guard will say so.
6. **The guard parsed only `external: [`.** It now also reads the
   `const EXTERNALS = [` array, and its enrolment test discovers
   `tsdown*.config.ts` as well as `tsup*.config.ts`.

## Measurements (CLI)

|                   | tsup 8.5.1 | tsdown 0.23.1 (Rolldown 1.2.13) |
| ----------------- | ---------- | ------------------------------- |
| `build/index.js`  | 844 KB     | 684 KB                          |
| Build time        | ~110 ms    | ~45 ms                          |
| Bare imports      | 31         | 31, the identical set           |

## Path for the remaining clients

Tracked in [#2797](https://github.com/modelcontextprotocol/inspector/issues/2797). Suggested order: **web runner**, then **mcpdo**, then the **TUI**.

- **Web runner.** A single entry with no JSX: the CLI change applied to a
  different file. `clients/web` also builds with Vite, so check that
  `vite.config.ts` doesn't share anything with the runner config.
- **mcpdo.** Two entries produce shared chunks, so check how
  `src/daemon/ensure.ts` resolves `mcpdod.js` relative to the running chunk
  against Rolldown's chunk naming (`hash` defaults to `true`). The
  `stop-dev-daemon` step in `build:dev` is unaffected.
- **TUI.** JSX moves to `inputOptions.transform.jsx`, and `ink-form` /
  `ink-scroll-view` move to `deps.alwaysBundle`. `tsupConfig.test.ts` imports
  the config and tsup's `Options` type, so it needs rewriting against tsdown's
  `UserConfig`. Its React-externals policy assertions must keep holding, since
  `react` must stay external while every React-rendering dependency is bundled
  (AGENTS.md).

Each step drops that client's `tsup` devDependency and, once `npm ls esbuild`
shows nothing left in that install, its `esbuild` override and `allowScripts`
entries. Web keeps esbuild through Vite, so its entries probably stay. Each step
also updates `BUNDLED_CLIENTS` in
`scripts/verify-bundle-externals.mjs`, the bundler `external` list paths in
AGENTS.md and `scripts/sdk-watch.mjs`, and the config name in that client's
`tsconfig.json` `include`.
