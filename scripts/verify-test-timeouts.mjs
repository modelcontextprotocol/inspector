/**
 * Guards the wall-clock budgets every Vitest project in this repo runs under
 * (#2323), and the decision that no project retries.
 *
 * The class it encodes against: a budget nobody chose. Three of the six
 * projects ran on Vitest's own `testTimeout: 5000` and five on its
 * `hookTimeout` / `teardownTimeout: 10000` — values sized for an idle machine,
 * not for the one this team works on (three or four concurrent agent sessions
 * in separate worktrees, each free to run the full `npm run local:gate`, on
 * eight logical cores). A correct, deterministic test cut off mid-flight by
 * such a budget fails a gate its diff did not break, which trains people to
 * re-run rather than read — the same argument AGENTS.md's "Lint has no warning
 * tier" makes from the other direction. #2292, #1942 and #1742 were each that
 * class, found and fixed one site at a time. ⚠️ Not every timing failure in
 * this repo's history belongs here: #2278 was a missing condition wait around a
 * geometry read and #2250 a genuine race in a test's own timing, both fixed by
 * making the test wait for the right thing. Citing those as evidence for a
 * larger ceiling would argue against #1596, which this guard upholds.
 *
 * **Everything here is read from a resolved Vitest project, never from source
 * text.** That is a deliberate and hard-won boundary. An earlier revision of
 * #2334 also enforced the two rules that no config can report — a per-test
 * `retry`, and Testing Library's `asyncUtilTimeout` — by scanning source, and
 * the review found a new valid JavaScript spelling it missed in five
 * consecutive rounds. Each fix was correct and each made the scanner more
 * parser-shaped, until it carried eight helpers doing quote tracking and
 * bracket balancing: a bad parser inside a linter. Both rules are now asserted
 * where they are unambiguous —
 *
 *   • `retry`, at runtime, by `vitest.setup.shared.mts`, which every project
 *     loads and which reads the value Vitest actually resolved for the test;
 *   • `asyncUtilTimeout`, at runtime, by
 *     `clients/web/src/test/asyncUtilTimeout.test.ts`, which reads the value
 *     the project's own `waitFor`s use.
 *
 * Both are strictly stronger than the scan was, because neither has to
 * anticipate a spelling. **If a future rule here cannot be answered by asking
 * the tool, assert it at runtime — do not read the source for it.**
 *
 * Three properties of what remains:
 *
 * 1. **Resolved, not declared.** It asks Vitest to resolve each project and
 *    reads the number a test actually gets. Asserting that a key is absent from
 *    some config block would pass just as happily on a config that had stopped
 *    being loaded at all.
 * 2. **Unknown projects fail loudly.** A seventh project with no row here, or a
 *    config file this guard does not discover, is exactly the drift it exists to
 *    prevent — so both are errors rather than silent skips.
 * 3. **Every project loads the no-retry setup.** The runtime assertion only
 *    binds a project that actually loads it, so that wiring is checked here
 *    rather than assumed.
 *
 * ⚠️ Observed to FAIL against the unfixed config before it was trusted: on
 * `origin/v2/main` it reports `unit`, `tui` and `launcher` at
 * `testTimeout: 5000` and five of the six projects at `hookTimeout: 10000`.
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The budgets, restated here rather than imported from `vitest.shared.mts`.
 *
 * That duplication is the point: importing the same object the configs spread
 * in would make this guard agree with any value at all, including a default
 * someone reinstated by deleting the spread. A guard has to state the
 * expectation independently or it is only asserting that a file parses.
 */
export const EXPECTED_TIMEOUTS = Object.freeze({
  testTimeout: 15_000,
  hookTimeout: 30_000,
  teardownTimeout: 30_000,
});

/** Web's `integration` project pays for real servers, sockets and OAuth flows. */
export const EXPECTED_INTEGRATION_TIMEOUTS = Object.freeze({
  ...EXPECTED_TIMEOUTS,
  testTimeout: 30_000,
});

/**
 * Every Vitest project in the repo, keyed by the resolved project name. Vitest
 * appends the browser instance to a browser project's name, so `storybook`
 * resolves as `storybook (chromium)`; match on the leading segment.
 */
export const EXPECTED_PROJECTS = Object.freeze({
  unit: EXPECTED_TIMEOUTS,
  integration: EXPECTED_INTEGRATION_TIMEOUTS,
  storybook: EXPECTED_TIMEOUTS,
  cli: EXPECTED_TIMEOUTS,
  tui: EXPECTED_TIMEOUTS,
  launcher: EXPECTED_TIMEOUTS,
});

/**
 * The four Vitest configs to resolve, and the project names each must yield.
 *
 * The node clients name no project, so their single project resolves with an
 * empty name — `projects` supplies the name this guard checks it under. Web's
 * three name themselves, so its entry lists them and the resolver matches by
 * name instead of by position.
 */
export const CONFIG_ROOTS = Object.freeze([
  { root: "clients/web", projects: ["unit", "integration", "storybook"] },
  { root: "clients/cli", projects: ["cli"] },
  { root: "clients/tui", projects: ["tui"] },
  { root: "clients/launcher", projects: ["launcher"] },
]);

/**
 * Directory every Vitest config in this repo lives one level under. Discovery
 * (below) walks it rather than trusting a hand-written list.
 */
export const CLIENTS_DIR = "clients";

/**
 * Every filename Vitest will load a config from, most specific first.
 *
 * The full set, not the two spellings this repo happens to use: discovery is
 * only deny-by-default if it sees every config Vitest would (Copilot). A
 * `clients/foo/vitest.config.mts` that this list did not name would be
 * invisible, and an invisible config yields no project to reject — the same
 * hole as a hand-written `CONFIG_ROOTS`, one level down. Order matters at
 * resolution time, where the first match wins, and mirrors Vitest's own
 * preference for a `vitest.config.*` over a `vite.config.*`.
 */
export const VITEST_CONFIG_FILENAMES = Object.freeze([
  ...["ts", "mts", "cts", "js", "mjs", "cjs"].map((e) => `vitest.config.${e}`),
  ...["ts", "mts", "cts", "js", "mjs", "cjs"].map((e) => `vite.config.${e}`),
]);

/**
 * Compare one resolved project against its row.
 *
 * @param {string} name project name as this guard knows it
 * @param {{testTimeout?: unknown, hookTimeout?: unknown, teardownTimeout?: unknown, retry?: unknown}} config
 * @param {Record<string, Readonly<Record<string, number>>>} [expected]
 * @returns {string[]} one message per violation; empty when the project is fine
 */
export function checkProject(name, config, expected = EXPECTED_PROJECTS) {
  const row = expected[name];
  if (!row) {
    return [
      `project "${name}" has no row in EXPECTED_PROJECTS — a project whose budgets ` +
        `nobody stated is exactly the drift this guard exists to prevent. Add it.`,
    ];
  }
  const failures = [];
  for (const [key, want] of Object.entries(row)) {
    const got = config[key];
    if (got !== want) {
      failures.push(
        `project "${name}" resolves ${key} to ${String(got)}, expected ${want}`,
      );
    }
  }
  // Vitest leaves `retry` undefined when nothing sets it; 0 is the same
  // decision written out.
  const retry = config.retry;
  if (retry !== undefined && retry !== 0) {
    failures.push(
      `project "${name}" sets retry to ${String(retry)} — a retry turns a ` +
        `load-induced red into a silent green on the only pre-push gate here (#1596)`,
    );
  }
  return failures;
}

/**
 * Does this project load the setup file that asserts no test retries?
 *
 * The runtime assertion in `vitest.setup.shared.mts` binds only a project that
 * actually loads it, so a dropped `setupFiles` entry would silently un-enforce
 * the rule for that project while everything still looked configured. This is
 * the one thing about that assertion a resolved config *can* answer, so it is
 * answered here rather than assumed.
 *
 * @param {string} name project name as this guard knows it
 * @param {unknown} setupFiles the project's resolved `setupFiles`
 * @returns {string[]}
 */
export function checkNoRetrySetupLoaded(name, setupFiles) {
  const loaded = Array.isArray(setupFiles) ? setupFiles : [];
  const found = loaded.some(
    (f) =>
      typeof f === "string" &&
      f.split("\\").join("/").endsWith("vitest.setup.shared.mts"),
  );
  return found
    ? []
    : [
        `project "${name}" does not load vitest.setup.shared.mts, so nothing ` +
          `stops a test in it from declaring a retry (#2323)`,
      ];
}

/**
 * Every Vitest config under `clients/`, as repo-relative directories.
 *
 * Discovery rather than the hand-written `CONFIG_ROOTS` list, so that a new
 * client with its own config cannot go unwatched — which would have made the
 * "a project with no row is an error" promise vacuous, since an undiscovered
 * config yields no project to reject (Copilot). `CONFIG_ROOTS` still exists to
 * say which project names each config must produce; this is what proves the
 * list is complete.
 *
 * @param {string} [root] absolute repo root
 * @returns {string[]}
 */
export function discoverConfigRoots(root = repoRoot) {
  const clients = resolve(root, CLIENTS_DIR);
  if (!existsSync(clients)) return [];
  return readdirSync(clients, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(clients, e.name))
    .filter((dir) =>
      VITEST_CONFIG_FILENAMES.some((f) => existsSync(join(dir, f))),
    )
    .map((dir) => relative(root, dir).split("\\").join("/"))
    .sort();
}

/**
 * Compare what is on disk against what this guard is configured to check.
 *
 * @param {string[]} discovered
 * @param {readonly {root: string}[]} [configured]
 * @returns {string[]}
 */
export function checkConfigRootCoverage(discovered, configured = CONFIG_ROOTS) {
  const known = new Set(configured.map((c) => c.root));
  const failures = [];
  for (const root of discovered) {
    if (!known.has(root)) {
      failures.push(
        `${root} has a Vitest config that this guard does not check — add it to ` +
          `CONFIG_ROOTS and EXPECTED_PROJECTS rather than leaving its budgets unstated`,
      );
    }
  }
  for (const root of known) {
    if (!discovered.includes(root)) {
      failures.push(
        `CONFIG_ROOTS names ${root}, which has no Vitest config on disk — a stale ` +
          `row silently stops checking anything`,
      );
    }
  }
  return failures;
}

/**
 * Resolve every project of one config, via Vitest's own resolver.
 *
 * @param {string} root absolute directory holding one of `VITEST_CONFIG_FILENAMES`
 * @returns {Promise<{name: string, config: Record<string, unknown>}[]>}
 */
async function resolveProjects(root) {
  const { createVitest } = await import("vitest/node");
  const config = VITEST_CONFIG_FILENAMES.map((f) => join(root, f)).find((f) =>
    existsSync(f),
  );
  if (!config) {
    throw new Error(`no vitest/vite config under ${root}`);
  }
  const vitest = await createVitest("test", {
    watch: false,
    run: true,
    root,
    config,
  });
  try {
    return vitest.projects.map((p) => ({
      name: p.name,
      config: /** @type {Record<string, unknown>} */ (p.config),
    }));
  } finally {
    await vitest.close();
  }
}

/**
 * Match a resolved project to the name this guard knows it by.
 *
 * A node client's single project resolves nameless, so its config entry
 * supplies the name. Web's three name themselves, but a browser project's name
 * carries its instance (`storybook (chromium)`), so compare the leading
 * segment rather than the whole string.
 *
 * @param {{name: string}} project
 * @param {string[]} expectedNames
 * @returns {string | undefined}
 */
export function identifyProject(project, expectedNames) {
  if (expectedNames.length === 1 && !project.name) return expectedNames[0];
  const base = project.name.replace(/\s*\(.*\)$/, "");
  return expectedNames.find((n) => n === base);
}

async function main() {
  // Seeded from discovery, not empty: the unknown-project check below can only
  // reject a project this guard actually resolves, so a config it never opens
  // is invisible to it. Without this line the deny-by-default claim rested on
  // `test:scripts` happening to run the same comparison — a different command,
  // which a standalone `npm run verify:test-timeouts` does not invoke (Copilot).
  const failures = checkConfigRootCoverage(discoverConfigRoots());
  let checked = 0;

  for (const { root, projects: expectedNames } of CONFIG_ROOTS) {
    const resolved = await resolveProjects(resolve(repoRoot, root));
    const seen = new Set();
    for (const project of resolved) {
      const name = identifyProject(project, expectedNames);
      if (!name) {
        failures.push(
          `${root}: resolved an unexpected project "${project.name}" — add it to ` +
            `CONFIG_ROOTS and EXPECTED_PROJECTS rather than leaving its budgets unstated`,
        );
        continue;
      }
      seen.add(name);
      checked += 1;
      failures.push(
        ...checkProject(name, project.config).map((f) => `${root}: ${f}`),
        ...checkNoRetrySetupLoaded(name, project.config.setupFiles).map(
          (f) => `${root}: ${f}`,
        ),
      );
    }
    for (const name of expectedNames) {
      if (!seen.has(name)) {
        failures.push(`${root}: project "${name}" did not resolve at all`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("verify:test-timeouts FAILED\n");
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "\nEvery test-gate budget must be a value someone chose, sized for a machine\n" +
        "running three or four concurrent worktree gates (#2323). The shared values live\n" +
        "in `vitest.shared.mts` (TIMEOUTS / INTEGRATION_TIMEOUTS) and every project\n" +
        "spreads one of them. Raising a budget is a decision to state there, not a\n" +
        "per-suite argument to add.\n\n" +
        "`retry` itself is asserted at RUNTIME by vitest.setup.shared.mts, which every\n" +
        "project loads — this only checks that each project still loads it.",
    );
    process.exit(1);
  }

  console.log(
    `verify:test-timeouts OK — ${checked} Vitest projects on stated budgets, ` +
      `no project-level retry, and every one loading the runtime no-retry setup.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
