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
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "clients/web");
const entryPath = path.join(webDir, "src/main.tsx");
const viteCache = path.join(webDir, "node_modules/.vite");

// A namespace import + guarded use so the built-in isn't tree-shaken before Vite
// externalizes it (a bare side-effect import can be dropped). `__never__` is
// never truthy, so the reference survives to build time without running.
const PROBE =
  'import * as __nodeBuiltinProbe from "node:fs";\n' +
  "if (globalThis.__never__) console.log(__nodeBuiltinProbe);\n";

function fail(message, detail) {
  console.error(`verify:build-gate FAILED — ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

const original = readFileSync(entryPath, "utf8");

let result;
try {
  writeFileSync(entryPath, PROBE + original);
  // Clear the transform cache so the externalization warning is re-emitted
  // rather than served from a prior build's cache.
  spawnSync("rm", ["-rf", viteCache], { cwd: webDir });
  result = spawnSync("npx", ["vite", "build"], {
    cwd: webDir,
    encoding: "utf8",
  });
} finally {
  // Always restore the entry, even if the build spawn threw.
  writeFileSync(entryPath, original);
}

// Guard against a botched restore leaving the tree dirty.
if (readFileSync(entryPath, "utf8") !== original) {
  fail(
    `failed to restore ${entryPath} — run 'git checkout -- ${path.relative(repoRoot, entryPath)}'`,
  );
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
