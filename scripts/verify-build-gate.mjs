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
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// The two literals this .mjs mirrors from the gate module (it can't import the
// TS source). KNOWN_PHRASE tells apart the ways a passing build can mean the gate
// broke (see the diagnoses below); ERROR_PREFIX is the success key — the
// distinctive lead of the gate's thrown error, so an unrelated build error whose
// output merely mentions "#1769" (it's in vite.config.ts comments) can't report
// OK. The drift guard below keeps BOTH honest against the source.
const KNOWN_PHRASE = "has been externalized for browser compatibility";
const ERROR_PREFIX = "Build failed (#1769)";

// The Node built-in the probe imports. Single source of truth: the diagnosis
// below tests the output for this exact name, so deriving both from one constant
// keeps a phrasing-drift failure from being misrouted as "probe never reached
// the graph" if the probe module ever changes.
const PROBE_MODULE = "node:fs";

// A namespace import + guarded use so the built-in isn't tree-shaken before Vite
// externalizes it (a bare side-effect import can be dropped). `__never__` is
// never truthy, so the reference survives to build time without running.
// Appended (not prepended): ES imports hoist, so this still externalizes at
// resolve time, and appending won't demote a leading directive (e.g. a future
// `"use client"`) the way prepending would.
const PROBE =
  `\nimport * as __nodeBuiltinProbe from "${PROBE_MODULE}";\n` +
  "if (globalThis.__never__) console.log(__nodeBuiltinProbe);\n";

function fail(message, detail) {
  console.error(`verify:build-gate FAILED — ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

// Escape a literal for safe interpolation into a RegExp.
function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Write the captured original to a backup and fail — the honest remedy when the
// in-place restore can't be trusted, since it preserves any uncommitted edits
// the developer had (unlike `git checkout --`). The backup goes in a fresh
// `mkdtempSync` dir, NOT next to the entry (a sidecar inside `src/` is untracked
// and a recovery-time `git add -A` would commit it) and NOT a fixed tmp filename
// (a pre-existing/foreign-owned file would make us point the user at someone
// else's content). The message only claims a backup when the write succeeded —
// this path runs during recovery, so it must not misdirect.
function saveBackupAndFail(reason) {
  let savedTo;
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "verify-build-gate-"));
    savedTo = path.join(dir, path.basename(entryPath));
    writeFileSync(savedTo, original);
  } catch {
    savedTo = undefined;
  }
  const remedy = savedTo
    ? `pre-run contents were saved to ${savedTo}; restore from there ` +
      `(it preserves uncommitted edits, unlike 'git checkout --')`
    : `a backup could NOT be written — the entry still has the probe injected; ` +
      `restore it from version control (this discards uncommitted edits to it) ` +
      `once the filesystem is writable`;
  fail(`${reason} — ${remedy}`);
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

// Fail fast if either mirrored literal drifted from the source of truth: a stale
// KNOWN_PHRASE would make the three-way diagnosis below misreport a
// plugin-not-applying regression as a phrasing drift, and a stale ERROR_PREFIX
// would make a correctly-firing gate report "the build broke for another
// reason" (both exactly the misdirection this script exists to avoid). Anchor
// the phrase on the *assignment* — matching the whole file would let the old
// wording lingering in a comment mask a changed constant; the prefix is
// distinctive enough that a plain substring is fine.
let gateSource;
try {
  gateSource = readFileSync(gatePath, "utf8");
} catch (err) {
  fail(
    `could not read the gate module ${path.relative(repoRoot, gatePath)} ` +
      `(${err.message}) — if it moved, update gatePath in this script`,
  );
}
const gateRel = path.relative(repoRoot, gatePath);
const phraseAssignment = new RegExp(
  `BROWSER_EXTERNALIZED_BUILTIN_PHRASE\\s*=\\s*["'\`]${escapeRegExp(KNOWN_PHRASE)}["'\`]`,
);
if (!phraseAssignment.test(gateSource)) {
  fail(
    `KNOWN_PHRASE here no longer matches the BROWSER_EXTERNALIZED_BUILTIN_PHRASE ` +
      `assignment in ${gateRel} — the mirrored literals drifted; re-sync them.`,
  );
}
if (!gateSource.includes(ERROR_PREFIX)) {
  fail(
    `ERROR_PREFIX here ("${ERROR_PREFIX}") no longer appears in ${gateRel} — the ` +
      `gate's thrown error was reworded; re-sync ERROR_PREFIX with it.`,
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
// — so a write failure fails actionably before the build, and any partial write
// is rolled back rather than escaping as a raw stack. `writeFileSync`'s default
// `'w'` flag truncates at open, so a mid-write ENOSPC/EIO can leave the entry
// empty or half-written; `restoreEntry()` puts the captured original back (and
// itself falls through to the `.bak` net if it can't write).
try {
  writeFileSync(entryPath, original + PROBE);
} catch (err) {
  restoreEntry();
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
// (distinct from restoreEntry's write throwing, which it handles itself). The
// verifying read is itself routed through saveBackupAndFail so the restore path
// is uniformly safe — a raw throw here would skip the backup net.
let afterRestore;
try {
  afterRestore = readFileSync(entryPath, "utf8");
} catch (err) {
  saveBackupAndFail(
    `could not re-read ${path.relative(repoRoot, entryPath)} to verify the restore (${err.message})`,
  );
}
if (afterRestore !== original) {
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
  // Order matters: a phrase match implies the probe reached the graph, so it
  // must be checked before the module-name fallback — don't reorder these.
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
  if (output.includes(PROBE_MODULE)) {
    fail(
      "vite build SUCCEEDED and the warning phrasing drifted — the probe reached " +
        `the graph (${PROBE_MODULE} is named) but the known phrase is absent. Update ` +
        "BOTH BROWSER_EXTERNALIZED_BUILTIN_PHRASE in browser-externalized-builtin-gate.ts " +
        "AND KNOWN_PHRASE in this script to the new Vite wording (the drift guard " +
        "requires they stay in sync).",
      output,
    );
  }
  fail(
    "vite build SUCCEEDED and the probe never reached the browser graph (neither " +
      `the known phrase nor ${PROBE_MODULE} appears in the output) — the entry may ` +
      "have moved or the probe was tree-shaken. Check this script's PROBE / entryPath.",
    output,
  );
}

// Assert on the gate's distinctive thrown-error prefix, NOT a bare "#1769":
// that issue number also appears in clients/web/vite.config.ts comments, so a
// code frame from an unrelated build error there could otherwise make this
// report OK with the gate dead. ERROR_PREFIX + KNOWN_PHRASE are the script's
// contract with the gate module, and both are drift-guarded above.
if (!output.includes(ERROR_PREFIX)) {
  fail(
    "vite build failed, but not via the #1769 gate — the build broke for another " +
      "reason, so this check no longer proves the gate works.",
    output,
  );
}

// The gate fired — but confirm it fired on OUR probe, not a pre-existing leak.
// The gate's error embeds every original Vite warning, and those name the module,
// so PROBE_MODULE must appear. Without this, a repo that already leaks a built-in
// would report OK even if the probe was tree-shaken or entryPath went stale —
// branch (c)'s failure, silently inverted into a pass. (Unreachable inside
// `npm run ci`: `validate`'s `build:web` fails first on a pre-existing leak — but
// this script is a documented standalone command, run exactly when debugging one.)
if (!output.includes(PROBE_MODULE)) {
  fail(
    `the #1769 gate fired, but ${PROBE_MODULE} isn't among the offenders — it ` +
      `tripped on a pre-existing leak, so this run doesn't prove the probe reached ` +
      `the graph (was it tree-shaken, or has entryPath gone stale?).`,
    output,
  );
}

console.log(
  "verify:build-gate OK — vite build fails on a Node built-in in the browser graph (#1769 gate fired).",
);
process.exit(0);
