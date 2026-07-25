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
 * regressions — the plugin being deleted from the `plugins` array, its
 * `applyToEnvironment` no longer matching the browser environment's name, or a
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
const gatePath = path.join(
  webDir,
  "server/browser-externalized-builtin-gate.ts",
);

// Mirrors BROWSER_EXTERNALIZED_BUILTIN_PHRASE in
// clients/web/server/browser-externalized-builtin-gate.ts; kept as a literal
// because this plain .mjs script can't import the TS source. Used to tell apart
// the ways a passing build can mean the gate broke (see the diagnoses below).
// The drift guard below keeps this literal honest against that source.
const KNOWN_PHRASE = "has been externalized for browser compatibility";

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

// Write the captured original to a sidecar `.bak` and fail — the honest remedy
// when the in-place restore can't be trusted, since it preserves any
// uncommitted edits the developer had (unlike `git checkout --`).
function saveBackupAndFail(reason) {
  const backupPath = `${entryPath}.verify-build-gate.bak`;
  try {
    writeFileSync(backupPath, original);
  } catch {
    // Best effort: if even the sidecar can't be written, the reason below (and
    // the injected probe still in the entry) is all we can offer.
  }
  fail(
    `${reason} — pre-run contents were saved to ${path.relative(repoRoot, backupPath)}; ` +
      `restore from there (it preserves uncommitted edits, unlike 'git checkout --')`,
  );
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

// Fail fast if the mirrored literal drifted from the source of truth: a stale
// KNOWN_PHRASE would make the three-way diagnosis below misreport a
// plugin-not-applying regression as a phrasing drift (the exact misdirection the
// diagnosis exists to avoid).
if (!readFileSync(gatePath, "utf8").includes(KNOWN_PHRASE)) {
  fail(
    `KNOWN_PHRASE no longer appears in ${path.relative(repoRoot, gatePath)} — the ` +
      `mirrored literals drifted; re-sync KNOWN_PHRASE with ` +
      `BROWSER_EXTERNALIZED_BUILTIN_PHRASE`,
  );
}

let restored = false;

// Restore the entry in place. On failure the sidecar-`.bak` path is the reachable
// safety net — letting the write escape the `finally` would skip it and leave the
// probe injected in the entry (the worst outcome this script can produce).
function restoreEntry() {
  if (restored) return;
  try {
    writeFileSync(entryPath, original);
    restored = true;
  } catch (err) {
    saveBackupAndFail(
      `failed to restore ${path.relative(repoRoot, entryPath)} (${err.message})`,
    );
  }
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
    // Conventional 128 + signal number: SIGINT → 130, SIGTERM → 143.
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

// Mutate the entry (guarded), THEN wrap only the build in the restore-`finally`
// — so a write failure (read-only checkout, EACCES) fails actionably before any
// mutation, rather than escaping the finally as a raw stack.
try {
  writeFileSync(entryPath, original + PROBE);
} catch (err) {
  fail(
    `could not write the probe into ${path.relative(repoRoot, entryPath)} (${err.message})`,
  );
}

let result;
try {
  console.log(
    "verify:build-gate: running a real `vite build` with a node:fs probe (takes a minute)…",
  );
  // `--no-install` pins to the locally installed (repo-pinned) Vite: the whole
  // point is proving the message-keyed gate fires against THIS Vite, so `npx`
  // must never silently fetch a different version from the registry when
  // clients/web/node_modules is missing/partial. A missing local bin then
  // surfaces via the `result.error` check below. `timeout` bounds a hung build:
  // spawnSync sets `result.error` (ETIMEDOUT) on timeout, so the same branch
  // reports it — otherwise a hang would burn to the GitHub job's 360-min default
  // with no output (this step captures rather than inherits stdio).
  result = spawnSync("npx", ["--no-install", "vite", "build"], {
    cwd: webDir,
    encoding: "utf8",
    timeout: 10 * 60_000,
    killSignal: "SIGKILL",
  });
} finally {
  // Always restore the entry, even if the build spawn threw.
  restoreEntry();
}

// Guard against a botched restore that wrote *something* other than the original
// (distinct from restoreEntry's write throwing, which it handles itself).
if (readFileSync(entryPath, "utf8") !== original) {
  saveBackupAndFail(
    `failed to restore ${path.relative(repoRoot, entryPath)} (contents differ)`,
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
  // A passing build with a Node built-in in the browser graph means the gate
  // broke — but in distinct ways, each pointing at a different file. The
  // captured output distinguishes them (Vite prints the warning at the default
  // log level, and no build script passes `--logLevel`, so its presence is
  // reliable). All three paths completed the build, so `clients/web/dist` now
  // holds a probe bundle — harmless (the probe never runs) and overwritten by
  // the next `validate`/`build`; flagged once here so a local debugger doesn't
  // serve it via `npm run web` unaware.
  console.error(
    "verify:build-gate: note — clients/web/dist now holds a probe build; run a normal build before serving it.",
  );
  if (output.includes(KNOWN_PHRASE)) {
    fail(
      "vite build SUCCEEDED but Vite DID emit the externalization warning — the " +
        "gate plugin isn't applying. In clients/web/vite.config.ts the plugin may " +
        "have been removed from `plugins`, its `applyToEnvironment` may no longer " +
        "match the browser environment's name, a `build.rollupOptions.onwarn` " +
        "suppression was added above it, or a future Vite emitted the warning " +
        "before the client environment's `buildStart` reset (which then cleared it).",
      output,
    );
  }
  if (output.includes("node:fs")) {
    fail(
      "vite build SUCCEEDED and the warning phrasing drifted — the probe reached " +
        "the graph (node:fs is named) but the known phrase is absent. Update " +
        "BROWSER_EXTERNALIZED_BUILTIN_PHRASE in browser-externalized-builtin-gate.ts " +
        "to match the new Vite wording.",
      output,
    );
  }
  fail(
    "vite build SUCCEEDED and the probe never reached the browser graph (neither " +
      "the known phrase nor node:fs appears in the output) — the entry may have " +
      "moved or the probe was tree-shaken. Check this script's PROBE / entryPath.",
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
