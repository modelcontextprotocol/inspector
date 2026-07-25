#!/usr/bin/env node
/**
 * Verifies the browser-externalized-builtin build gate (#1769).
 *
 * The gate (clients/web/vite.config.ts +
 * clients/web/server/browser-externalized-builtin-gate.ts) fails `vite build`
 * when a Node built-in reaches the browser graph — Vite 8 otherwise only warns
 * and ships a `{}` stub, so the broken bundle builds green. The unit tests cover
 * the detection logic against a *captured* message string; only a real build can
 * prove the gate still fires against the *live* Vite version, catching the one
 * risk the issue calls out: the warning phrasing drifts across Vite releases
 * (8.0.x → 8.1.x), silently disabling a message-keyed gate.
 *
 * This temporarily injects a `node:fs` import into the browser entry
 * (src/main.tsx), runs `vite build`, and asserts the build FAILS with the #1769
 * error, then restores the entry. Run from `npm run ci`.
 *
 * Why the REAL config + entry (and not a fast throwaway temp entry / generated
 * config): building the actual `clients/web` config is what catches config-level
 * regressions — the plugin being deleted from the `plugins` array, or a
 * `build.rollupOptions.onwarn` suppression added above it. A temp config would
 * keep passing through all of those, degrading this from "the gate works in this
 * repo" to "the gate's string still matches the live Vite." That fidelity is the
 * point, and it's why this accepts a full (~minute) app build and a
 * source-mutation-with-restore rather than something cheaper. Do NOT "optimize"
 * it into a temp entry — that silently loses the config-regression coverage.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "clients/web");
// Hardcoded browser entry. If it's ever renamed, the guarded read below fails
// with an actionable message rather than a raw ENOENT stack.
const entryPath = path.join(webDir, "src/main.tsx");

// A namespace import + guarded use so the built-in isn't tree-shaken before Vite
// externalizes it (a bare side-effect import can be dropped). `__never__` is
// never truthy, so the reference survives to build time without running.
// Appended (not prepended): ES imports hoist, so this still externalizes at
// resolve time, and appending won't demote a leading directive (e.g. a future
// `"use client"`) the way prepending would.
const PROBE =
  '\nimport * as __nodeBuiltinProbe from "node:fs";\n' +
  "if (globalThis.__never__) console.log(__nodeBuiltinProbe);\n";

function fail(message, detail) {
  console.error(`verify:build-gate FAILED — ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

let original;
try {
  original = readFileSync(entryPath, "utf8");
} catch (err) {
  fail(
    `could not read the browser entry ${path.relative(repoRoot, entryPath)} ` +
      `(${err.message}) — if it was renamed, update entryPath in this script`,
  );
}

let restored = false;

function restoreEntry() {
  if (restored) return;
  writeFileSync(entryPath, original);
  restored = true;
}

// A `finally` doesn't run on Ctrl-C during the multi-minute build; restore the
// mutated entry on a signal too so an interrupt never leaves the tree dirty.
// While `spawnSync` blocks, a Ctrl-C reaches `vite` via the shared process
// group (the child dies, `spawnSync` returns, the `finally` restores) and these
// handlers run afterward as a backstop — e.g. for a `kill <pid>` that targets
// only this process, where the queued handler is the sole restore path.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restoreEntry();
    process.exit(130);
  });
}

let result;
try {
  writeFileSync(entryPath, original + PROBE);
  console.log(
    "verify:build-gate: running a real `vite build` with a node:fs probe (takes a minute)…",
  );
  // `--no-install` pins to the locally installed (repo-pinned) Vite: the whole
  // point is proving the message-keyed gate fires against THIS Vite, so `npx`
  // must never silently fetch a different version from the registry when
  // clients/web/node_modules is missing/partial. A missing local bin then
  // surfaces via the `result.error` check below.
  result = spawnSync("npx", ["--no-install", "vite", "build"], {
    cwd: webDir,
    encoding: "utf8",
  });
} finally {
  // Always restore the entry, even if the build spawn threw.
  restoreEntry();
}

// Guard against a botched restore leaving the tree dirty. Write the captured
// original to a sidecar `.bak` and point there — NOT `git checkout --`, which
// would also discard any uncommitted edits the developer had in the entry.
if (readFileSync(entryPath, "utf8") !== original) {
  const backupPath = `${entryPath}.verify-build-gate.bak`;
  writeFileSync(backupPath, original);
  fail(
    `failed to restore ${path.relative(repoRoot, entryPath)} — its pre-run ` +
      `contents were saved to ${path.relative(repoRoot, backupPath)}; restore ` +
      `from there (it preserves any uncommitted edits, unlike 'git checkout --')`,
  );
}

// A spawn failure (e.g. `npx` missing) leaves `status` null with no output —
// surface it as itself rather than falling through to the "not via the gate"
// diagnosis, which would send someone chasing a build regression that isn't real.
if (result.error) {
  fail(`could not run \`vite build\` (${result.error.message})`);
}

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

if (result.status === 0) {
  fail(
    "vite build SUCCEEDED with a node:fs import in the browser graph — the gate " +
      "did not fire (the warning phrasing likely drifted in a Vite bump; update " +
      "BROWSER_EXTERNALIZED_BUILTIN_PHRASE in browser-externalized-builtin-gate.ts).",
    output,
  );
}

if (!output.includes("#1769")) {
  fail(
    "vite build failed, but not via the #1769 gate — the build broke for another " +
      "reason, so this check no longer proves the gate works.",
    output,
  );
}

console.log(
  "verify:build-gate OK — vite build fails on a Node built-in in the browser graph (#1769 gate fired).",
);
process.exit(0);
