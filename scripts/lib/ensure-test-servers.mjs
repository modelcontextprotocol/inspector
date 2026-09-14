/**
 * The one place `test-servers/build` is produced for a script consumer (#2111).
 *
 * Five scripts used to carry their own `ensureTestServer()`, each returning
 * early when the output was already on disk. Presence is not freshness: once
 * `test-servers/build` exists — which it does on any machine that has run the
 * smokes once — an edit to `test-servers/src` was never picked up again, and
 * the smoke kept driving the previously-built fixture.
 *
 * That failure is silent *and* misattributed. It does not read as "your fixture
 * is stale", it reads as a product bug: a `v2/main` merge that touched
 * `preset-registry.ts` made `smoke:web:app` report the dedicated app-origin
 * path as broken, and two unrelated hypotheses were measured out before the
 * real cause surfaced. The **tests** have always built the same fixture
 * unconditionally (`pretest`, `test:coverage`, `test:integration` all run
 * `test-servers:build`), so the weaker policy sat on exactly the checks that
 * spawn real servers and are hardest to debug when wrong.
 *
 * So: build every time, from here. `tsc -p test-servers --noCheck` costs ~1s
 * cold and less when `incremental` finds its `.tsbuildinfo` up to date, against
 * smokes that take tens of seconds and a `pack:verify` that does a real
 * `npm install` from the registry.
 *
 * ⚠️ Unconditional emit is not a clean, and this is the one hole it does NOT
 * close. `--noCheck` emit leaves the stale `.js` of a *deleted* `src` file
 * behind, and no path here removes it — the post-build existence checks pass
 * against that stale file, so if anything still imports the deleted module it
 * silently keeps running the old code. That is the same failure class as the
 * one this helper fixes, so do not read the unconditional build as covering it.
 * (It is unchanged from before: the old early return only skipped the build, it
 * never cleaned either.) Fixing it properly means `tsc -b` with `composite`,
 * which forces `declaration` on and drops `--noCheck`; not worth it for this.
 * **`rm -rf test-servers/build` after deleting or renaming a source file** —
 * the `.tsbuildinfo` lives inside `build/` precisely so that clean is real.
 *
 * The root-installed tsc is run via this Node — `npx` is a `.cmd` shim on
 * Windows that a shell-free spawnSync can't start (ENOENT — #1939). That is
 * also one of the drifts consolidating fixed: `pack-and-verify.mjs` still
 * shelled out to `npx tsc`, so it alone was unrunnable on Windows.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveNodeBin } from "./resolve-node-bin.mjs";

/**
 * The build entries a consumer can require, by short name. Every one of them is
 * emitted by the same single `tsc -p test-servers` pass — the names exist so a
 * caller can say which files its own run depends on, and get told precisely
 * which is missing when the build silently produces nothing.
 */
export const TEST_SERVER_ENTRIES = {
  stdio: "test-server-stdio.js",
  http: "test-server-http.js",
  composable: "server-composable.js",
  fixtures: "test-server-fixtures.js",
};

/** Absolute path of a named `test-servers/build` entry. */
export function testServerEntryPath(repoRoot, name) {
  const file = TEST_SERVER_ENTRIES[name];
  if (!file) {
    throw new Error(
      `unknown test-server entry "${name}" (known: ${Object.keys(
        TEST_SERVER_ENTRIES,
      ).join(", ")})`,
    );
  }
  return join(repoRoot, "test-servers", "build", file);
}

/**
 * The actionable message a failed build reports. Kept as its own function
 * because it is the half a consumer sees when things go wrong, and every
 * previous copy worded it differently — including naming the wrong client to
 * run `npm run test-servers:build` from.
 */
export function buildFailureMessage(missing) {
  const detail = missing.length
    ? ` (missing ${missing.join(", ")})`
    : " (tsc exited non-zero)";
  return (
    `could not build the test servers${detail}. ` +
    "Run `npm run test-servers:build` from clients/web."
  );
}

/** Repo roots already built in this process — see `ensureTestServers`. */
const built = new Set();

/**
 * Build `test-servers/build`, unconditionally, and assert the entries the
 * caller named exist afterwards.
 *
 * Unconditional per *process*, not per call: `pack-and-verify.mjs` asks twice
 * (once for the stdio entry, once for the composable one) and one `tsc` pass
 * emits both, so a second call within the same run skips the build. A fresh
 * process always rebuilds, which is the whole point — that is what makes an
 * edit to `test-servers/src` reach the next smoke. The *existence* assertion is
 * not cached, because a later call can name an entry the first one didn't.
 *
 * `log` receives the bare message; the default prefixes it with `label`, which
 * is what a caller owning its own prefixed logger (pack-and-verify's `step`)
 * passes instead. `run` and `exists` are injectable so the failure branches —
 * the ones no smoke's happy path can reach — are testable without spawning
 * tsc.
 *
 * @returns {string[]} absolute paths of the required entries, in order.
 */
export function ensureTestServers({
  repoRoot,
  label,
  requires = [],
  log = (message) => console.log(`${label} — ${message}`),
  run = runTsc,
  exists = existsSync,
}) {
  const paths = requires.map((name) => testServerEntryPath(repoRoot, name));

  // A cached call can name an entry the first one didn't, so the existence
  // assertion runs on every call. Skipping it on the cache hit would return a
  // path to a file tsc never emitted, and the consumer would then fail with
  // exactly the opaque ERR_MODULE_NOT_FOUND this helper exists to replace.
  if (built.has(repoRoot)) {
    assertEmitted(paths, exists, 0);
    return paths;
  }

  log("building test-servers...");
  const status = run(repoRoot);
  assertEmitted(paths, exists, status);
  built.add(repoRoot);
  return paths;
}

/** Throw the shared actionable message unless tsc succeeded and emitted each path. */
function assertEmitted(paths, exists, status) {
  const missing = paths.filter((p) => !exists(p));
  if (status !== 0 || missing.length) {
    throw new Error(buildFailureMessage(missing));
  }
}

/** Test-only: forget which roots this process has built. */
export function resetTestServerBuildCache() {
  built.clear();
}

/** Run the root-installed tsc over `test-servers`; returns its exit status. */
function runTsc(repoRoot) {
  const r = spawnSync(
    process.execPath,
    [
      resolveNodeBin("typescript", "tsc", repoRoot),
      "-p",
      "test-servers",
      "--noCheck",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  return r.status;
}
