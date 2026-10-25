# Migrating from tsup to tsdown

Findings and recommendation for [#1492](https://github.com/modelcontextprotocol/inspector/issues/1492). **The migration is complete:** the CLI moved in #1492 and the web runner, mcpdo and the TUI followed in [#2797](https://github.com/modelcontextprotocol/inspector/issues/2797), so no client builds with tsup any more.

## Recommendation

**Migrate, one client at a time.** The CLI moved first (#1492) as the
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
| CLI        | `clients/cli/tsdown.config.ts`        | `index`             | **Migrated** (#1492).                                                                                                                                             |
| Web runner | `clients/web/tsdown.runner.config.ts` | `index`             | **Migrated** (#2797). `@inspector/core` alias, `deps.alwaysBundle`, `deps.neverBundle`                                                                             |
| mcpdo      | `clients/mcpdo/tsdown.config.ts`      | `mcp-bin`, `mcpdod` | **Migrated** (#2797). The same, plus two entries (and therefore a shared chunk); `src/daemon/ensure.ts` locates `mcpdod.js` as a sibling of the running chunk     |
| TUI        | `clients/tui/tsdown.config.ts`        | `index`             | **Migrated** (#2797). The same, plus `inputOptions.transform.jsx`, and `ink-form` / `ink-scroll-view` in `deps.alwaysBundle`, guarded by `__tests__/tsdownConfig.test.ts` |

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
5. **Rolldown is also Vite's bundler**, so it reaches every install that has
   `vite` or `tsdown`: the root, and all four bundled clients. tsdown 0.23.1
   accepts `~1.2.13` and resolved 1.2.15, while Vite sits on 1.2.13, and
   `verify:dep-lockstep` refuses the skew. Each client pins its copy to the
   root's with a `rolldown` `overrides` entry, the same mechanism the CLI uses
   for `@types/node`. Those overrides have to move whenever the root's Vite
   moves Rolldown, and the lockstep guard will say so. tsdown itself is held
   at the same version in all four installs for the same reason.
6. **The guard parsed only `external: [`.** It now also reads the
   `const EXTERNALS = [` array, and its enrolment test discovers
   `tsdown*.config.ts` as well as `tsup*.config.ts`.

## Measurements (CLI)

|                   | tsup 8.5.1 | tsdown 0.23.1 (Rolldown 1.2.13) |
| ----------------- | ---------- | ------------------------------- |
| `build/index.js`  | 844 KB     | 684 KB                          |
| Build time        | ~110 ms    | ~45 ms                          |
| Bare imports      | 31         | 31, the identical set           |

## The remaining clients (#2797)

Migrated in the suggested order: **web runner**, then **mcpdo**, then the
**TUI**. Each bundle emits the same set of bare package imports as its tsup
predecessor. Rolldown writes Node builtins with a `node:` prefix that esbuild
dropped, which is the only difference in the import lists.

|                     | tsup 8.5.1                     | tsdown 0.23.1 (Rolldown 1.2.13) |
| ------------------- | ------------------------------ | ------------------------------- |
| Web runner          | 341 KB                         | 275 KB                          |
| mcpdo (all chunks)  | 964 KB                         | 727 KB                          |
| TUI `build/index.js` | 1054 KB                       | 810 KB                          |

- **Web runner.** A single entry with no JSX: the CLI change applied to a
  different file. `vite.config.ts` shares nothing with the runner config.
  `clients/web` keeps its `esbuild` override and `allowScripts` entries:
  Vite and Storybook still install esbuild there, and both accept `^0.27.0`,
  which admits the advisory range the override exists to avoid.
- **mcpdo.** The shared code lands in a hashed chunk (`server-<hash>.js`)
  written flat into `build/` beside both entries, so `src/daemon/ensure.ts`
  still finds `mcpdod.js` as a sibling of the chunk it was emitted into. The
  mcpdo suite spawns the built daemon, so it exercises that path. With tsup
  gone, `npm ls esbuild` is empty in this install, so its `esbuild` and
  `sucrase` overrides and its `allowScripts` entries went too.
- **TUI.** JSX is `inputOptions.transform.jsx: "react-jsx"`, and `ink-form` /
  `ink-scroll-view` are in `deps.alwaysBundle`, which overrides tsdown's
  externalization of the client's own `dependencies`. The
  `react/jsx-runtime` the transform emits stays external through the `react`
  subpath pattern. `tsdownConfig.test.ts` now reads `deps.alwaysBundle` /
  `deps.neverBundle` through tsdown's `UserConfig` type, and its
  React-externals assertions are unchanged. The TUI keeps its `esbuild`
  override and `allowScripts` entries, because `tsx` and Vite still install
  esbuild.
