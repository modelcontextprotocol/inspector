/**
 * The two things every Vitest project in this repo shares.
 *
 * 1. Resolve aliases and dedupe pins, for `clients/web` and the node clients
 *    (cli, tui). Pass each client's directory so bare-module pins resolve
 *    against that client's node_modules.
 * 2. The wall-clock budgets below (`TIMEOUTS` / `INTEGRATION_TIMEOUTS`), which
 *    every one of the six projects spreads in — `clients/launcher` included,
 *    which imports this module for them and nothing else.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wall-clock budgets shared by every Vitest project in this repo (#2323).
 *
 * These are values somebody chose. Before this existed, three of the six
 * projects ran on Vitest's own `testTimeout: 5000` and five on its
 * `hookTimeout`/`teardownTimeout: 10000` — numbers sized for an idle machine,
 * not for the one this team works on (8 logical cores, three or four
 * concurrent agent sessions in separate worktrees each free to run the full
 * `npm run local:gate`, sustained load averages of 50-70). A correct,
 * deterministic test cut off mid-flight by an unchosen budget fails a gate it
 * did not break, which trains people to re-run rather than read.
 *
 * This is NOT a licence to hide races. #1596 settled that stance and every fix
 * it produced stands; what a raised ceiling buys is only that a test which
 * *would* have passed is allowed to finish. A poll or a `waitFor` exits the
 * instant its predicate holds, so a passing run pays nothing for the headroom —
 * only a genuinely hung test spends the whole budget, and 15s over 342 files is
 * still a diagnosis measured in seconds.
 *
 * One object rather than six hand-written triples, because six independent
 * answers to the same question is exactly how five of the projects came to have
 * no answer at all. `retry` is deliberately absent and must stay unset: a retry
 * converts a load-induced red into a silent green on the only pre-push gate
 * this repo has. `scripts/verify-test-timeouts.mjs` enforces both halves.
 */
/**
 * Absolute path to the setup file every project loads, which asserts at runtime
 * that no test declares a `retry` (#2323). Exported from here so the six
 * projects name one path rather than six copies of a relative one.
 */
export const NO_RETRY_SETUP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "vitest.setup.shared.mts",
);

export const TIMEOUTS = Object.freeze({
  /**
   * 3x Vitest's default. Covers the measured load; past this a genuinely hung
   * unit test costs the whole budget to discover. Both projects that had
   * already answered this question by hand — `clients/cli` and web's
   * `storybook` (#2292) — independently arrived at 15000, which is why it is
   * the shared value rather than a new one.
   */
  testTimeout: 15_000,
  /**
   * Hooks do the setup and teardown a test's own budget never covers —
   * spawning servers, provisioning temp dirs, unlinking filesystem-backed
   * storage. They are also where the real-transitions auto-settle in
   * `clients/web/src/test/renderWithMantine.tsx` awaits, so this is the one
   * budget in the repo that actually governs a deliberate wait.
   */
  hookTimeout: 30_000,
  teardownTimeout: 30_000,
});

/**
 * Web's `integration` project: same hook budgets, a longer per-test one. These
 * suites spawn real HTTP/stdio servers, bind sockets and run end-to-end OAuth
 * flows, so 30s is the work rather than the slack — it predates this change
 * (matching the v1.5 `core/vitest.config.ts`) and is carried forward unchanged.
 */
export const INTEGRATION_TIMEOUTS = Object.freeze({
  ...TIMEOUTS,
  testTimeout: 30_000,
});

/**
 * `maxWorkers` is deliberately unset, here and in every project (#2336).
 *
 * The five forks-pool projects — web `unit` and `integration`, `cli`, `tui`,
 * `launcher` — therefore inherit Vitest's non-watch default,
 * `max(availableParallelism() - 1, 1)`: 7 on the eight-logical-core M3 this
 * team works on. Web's `storybook` project is the exception: it runs the
 * browser pool, whose default is a different expression,
 * `max(min(12, availableParallelism() - 1), 1)` — also 7 here, but capped on
 * larger machines because the main thread chokes past ~12 browser workers
 * (vitest#7871) — and a single worker unless the run is headless, file
 * parallelism is on, and the provider supports it. A
 * `maxWorkers` set on that project *would* apply to it (`getThreadsCount`
 * reads it before falling back), so it is not exempt from this decision;
 * but nothing below measured it. The numbers are the forks pool's, and a cap
 * for Storybook would need its own measurement.
 *
 * Keeping the default is a choice, not an omission, and this is the
 * measurement it rests on. On `v2/main` @ `f16a51d4` — after the gate lease
 * (#2339) — with the arms interleaved (default / `--maxWorkers=4` / default),
 * three rounds, one worktree, nothing else of ours running:
 *
 *   web `unit`, 345 files       default  54.9s wall   378s CPU
 *                                4        62.4s wall   294s CPU   +14% wall, -22% CPU
 *   web `test:coverage`, 422    default  88.0s wall   461s CPU
 *                                4       122.5s wall   376s CPU   +39% wall, -18% CPU
 *   failures across all 18 runs  0
 *
 * So a cap is a permanent solo-run cost — ~35s on every `coverage:web`, a
 * tenth of the whole gate — bought against a flake that did not occur once
 * at the baseline every other #2338 number is tuned to. The CPU a cap gives
 * back matters only when something else wants the cycles, and since #2339
 * that is no longer another gate: gates serialize under
 * `scripts/gate-lease.mjs`. What remains is non-gate work in a sibling
 * session. Measured against a concurrent bare `vitest run --project=unit`
 * in the same worktree (5 / 3 / 3 pairings): with the sibling at the
 * default, capping our run cost us +8% and gave the sibling 14% back; with
 * both capped, both sides ran at ~100s — the same total throughput as both
 * at the default (99s + 92s), because eight cores are saturated either way.
 * The one thing a cap moved was failures: two of the ten 7-vs-7 runs lost
 * `AppRenderer.test.tsx`'s theme-flip case to its 5s inner `waitFor` at 14
 * workers; none of the twelve runs with a cap on either side did. That is a
 * single test's inner budget starving under two sessions' worth of workers
 * — #2338's aspect 3, fixable at that site — not a case for taxing every
 * solo run.
 *
 * Why not cap only locally, via an env var this file reads and `local:gate`
 * sets? CI never runs `local:gate`, so CI would pay nothing — but every
 * budget above is wall-clock, so a purely scheduling difference between the
 * local gate and CI can flip an outcome, and the gate's whole promise is
 * that passing it here means CI passes. One configuration in both places is
 * the property worth keeping. CI's runners resolve the same expression
 * against their own core count, so leaving it unset costs CI nothing.
 *
 * Reopen this if the lease goes away, or if `Test timed out` recurs on a run
 * whose only contention is a sibling session — the 4-vs-4 figures above are
 * the starting point. Whatever is committed then is a *chosen* number: macOS
 * exposes no CPU affinity API, so no cap pins a worker to a performance core
 * and none is "one per P-core".
 */

export function vitestSharedPaths(clientDir: string) {
  const dirname = path.resolve(clientDir);
  const repoRoot = path.resolve(dirname, "../..");

  const sharedAliases = {
    "@inspector/core": path.resolve(repoRoot, "core"),
    "@modelcontextprotocol/inspector-test-server": path.resolve(
      repoRoot,
      "test-servers/build/index.js",
    ),
  };

  const sharedDedupe = [
    "react",
    "react-dom",
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/core",
    // Every SDK schema is a zod type, so a second copy breaks `instanceof`
    // across the whole surface. The alias below picks the install; this keeps
    // it to one copy within it.
    "zod",
  ];

  const nodeModulesAliases = [
    {
      find: /^react$/,
      replacement: path.resolve(dirname, "node_modules/react"),
    },
    {
      find: /^react\/jsx-runtime$/,
      replacement: path.resolve(dirname, "node_modules/react/jsx-runtime.js"),
    },
    {
      find: /^react\/jsx-dev-runtime$/,
      replacement: path.resolve(
        dirname,
        "node_modules/react/jsx-dev-runtime.js",
      ),
    },
    {
      find: /^react-dom$/,
      replacement: path.resolve(dirname, "node_modules/react-dom"),
    },
    {
      find: /^react-dom\/client$/,
      replacement: path.resolve(dirname, "node_modules/react-dom/client.js"),
    },
    // Everything below is **root-owned** and resolves from the repo root,
    // unlike the `react` / `react-dom` pins above. What they have in common is
    // that no client declares them, so the root install is the only place a
    // client's resolution chain is guaranteed to find one — not that they are
    // all root `dependencies`: `express` is test-only and sits in the root
    // `devDependencies`. Nor is this the complete root runtime set; a package
    // no client install carries a copy of (`ajv`, `commander`, `undici`)
    // resolves to the root on its own and needs no pin. Absence from this list
    // is a statement about the installed tree, not about the manifests — check
    // the tree before adding or removing an entry.
    //
    // `express` is reached only through `test-servers/src` (the http/oauth
    // servers), which is root-owned code with no manifest of its own.
    //
    // `yaml` was too — `load-config.ts` — but is now also a `core/` runtime
    // import: `core/mcp/skillFile.ts` parses a served SKILL.md's frontmatter
    // for the SEP-2640 cross-check (#2248). That matters to anyone revisiting
    // this pin: it is no longer removable by retiring a test-server path, and
    // as a dependency `core/` imports it is additionally named in all three
    // bundler `external` lists.
    //
    // Pointing these at `<client>/node_modules` is what broke when the MCP
    // packages moved to the root (#1970): express was never declared by a client
    // at all, it arrived in `clients/cli` as a peer of `express-rate-limit`
    // under `@modelcontextprotocol/server-legacy`, so removing that manifest
    // entry took express with it and every cli test that spawns a test server
    // failed to resolve it.
    {
      find: /^express$/,
      replacement: path.resolve(repoRoot, "node_modules/express"),
    },
    {
      find: /^yaml$/,
      replacement: path.resolve(repoRoot, "node_modules/yaml"),
    },
    // Same reasoning, one layer in: `proper-lockfile` is reached only through
    // `core/` (the secrets file's cross-process lock, #2082), which is the
    // other root-owned tree with no manifest of its own. Resolution finds the
    // root copy on its own today — nothing declares it in a client — and this
    // pin is what keeps that from depending on nothing ever arriving as some
    // client's transitive dependency, which would otherwise give a test two
    // copies of a module whose whole job is a single registry of held locks.
    {
      find: /^proper-lockfile$/,
      replacement: path.resolve(repoRoot, "node_modules/proper-lockfile"),
    },
    // The rest of the root-owned aliases, consolidated into the root manifest
    // by #2195. Mostly `core/`'s runtime dependencies, but not only —
    // `@hono/node-server` is reached from web client code alone and is here for
    // the same resolution reason rather than because `core/` imports it. Each
    // used to be declared by the clients that reached it and was pinned to
    // `<client>/node_modules` accordingly; once the declarations went away
    // those paths stopped existing, so the pin has to follow the package to
    // the root. Left un-repointed they would resolve
    // to a directory that is not there — or, worse, to a transitive copy some
    // unrelated dependency happened to drag in, which is the duplicate this
    // whole pin list exists to prevent.
    {
      find: /^pino$/,
      replacement: path.resolve(repoRoot, "node_modules/pino"),
    },
    {
      find: /^pino\/browser\.js$/,
      replacement: path.resolve(repoRoot, "node_modules/pino/browser.js"),
    },
    {
      find: /^hono$/,
      replacement: path.resolve(repoRoot, "node_modules/hono/dist/index.js"),
    },
    {
      find: /^hono\/streaming$/,
      replacement: path.resolve(
        repoRoot,
        "node_modules/hono/dist/helper/streaming/index.js",
      ),
    },
    {
      find: /^@hono\/node-server$/,
      replacement: path.resolve(repoRoot, "node_modules/@hono/node-server"),
    },
    {
      find: /^atomically$/,
      replacement: path.resolve(repoRoot, "node_modules/atomically"),
    },
    {
      find: /^chokidar$/,
      replacement: path.resolve(repoRoot, "node_modules/chokidar"),
    },
    {
      find: /^@napi-rs\/keyring$/,
      replacement: path.resolve(repoRoot, "node_modules/@napi-rs/keyring"),
    },
    // `zod` and `open` are pinned for a different reason from everything above:
    // they resolve *somewhere* without help, and the somewhere is wrong. Both
    // still sit at the top level of `clients/web/node_modules` as transitive
    // copies — zod under `eslint-plugin-react-hooks`, open under Storybook —
    // so an unpinned bare import from a web test resolves the client copy while
    // `core/` and the SDK packages resolve the root's (Copilot).
    //
    // For `open` that is merely wasteful. For `zod` it is the hazard this file
    // exists for: two copies in one process means a schema built by one and an
    // `instanceof` check made by the other, across the entire
    // `@modelcontextprotocol/*` surface. The versions are identical today and
    // `verify:dep-lockstep` is what keeps them that way, but identical is not
    // the same as single, and only a pin makes it single.
    //
    // `zod/v4` needs its own entry — first-party code imports both specifiers,
    // and pinning only the bare one would split the package across two installs
    // rather than collapse it.
    { find: /^zod$/, replacement: path.resolve(repoRoot, "node_modules/zod") },
    {
      find: /^zod\/v4$/,
      replacement: path.resolve(repoRoot, "node_modules/zod/v4/index.js"),
    },
    {
      find: /^open$/,
      replacement: path.resolve(repoRoot, "node_modules/open"),
    },
  ];

  const projectResolve = {
    alias: [
      ...Object.entries(sharedAliases).map(([find, replacement]) => ({
        find,
        replacement,
      })),
      ...nodeModulesAliases,
    ],
    dedupe: sharedDedupe,
  };

  return {
    repoRoot,
    sharedAliases,
    sharedDedupe,
    nodeModulesAliases,
    projectResolve,
  };
}

/** Convenience for importers that only have import.meta.url. */
export function vitestSharedPathsFromMetaUrl(metaUrl: string) {
  const clientDir = path.dirname(fileURLToPath(metaUrl));
  return vitestSharedPaths(clientDir);
}
