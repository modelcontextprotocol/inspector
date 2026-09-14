// Regression test for #1939's "doubly silent" failure mode: when the tsc entry
// cannot be resolved (on Windows the old `execFileSync("npx", …)` threw ENOENT;
// today, a missing install), the guard must hard-fail with an actionable
// "cannot measure" error — NOT swallow it, echo "(no diagnostic captured)" per
// project, and then report every tracked source file in the repo as getting no
// tsc pass, which is what shipped before and sent Windows contributors chasing
// a 900-file coverage regression that wasn't real.
//
// The fixture is a throwaway repo with one enrolled client whose `typecheck`
// names a project, but with NO node_modules anywhere up the temp tree — so the
// guard reaches the tsc-entry resolution and it fails. Mirrors the
// `verify-format-coverage.main.test.mjs` / `verify-dep-lockstep.main.test.mjs`
// pattern. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

test("unresolvable tsc is a hard 'cannot measure' error, not an empty file set", () => {
  // realpath'd because the script only executes when `import.meta.url` matches
  // `process.argv[1]`, and macOS `tmpdir()` is a symlink — see the note in
  // `verify-dep-lockstep.main.test.mjs`.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "typecheck-cov-")));
  try {
    // Root manifest: the full guard cycle is wired so phase 1 gets as far as
    // measuring the client (an unwired client is `continue`d past, and the
    // resolution would never be reached).
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: {
          validate:
            "npm run verify:format-coverage && npm run verify:typecheck-coverage && npm run verify:dep-lockstep && npm run test:scripts && npm --prefix clients/cli run validate",
          "verify:format-coverage": "node scripts/verify-format-coverage.mjs",
          "verify:typecheck-coverage":
            "node scripts/verify-typecheck-coverage.mjs",
          "verify:dep-lockstep": "node scripts/verify-dep-lockstep.mjs",
          "test:scripts": 'node --test "scripts/**/*.test.mjs"',
        },
      }),
    );
    // One enrolled client with a `typecheck` reachable from `validate`, a
    // project for it to name, and a tracked source file — so if the hard error
    // ever regresses to the old behavior, the "get no `tsc` pass" report the
    // second assertion forbids would actually have a file to list.
    mkdirSync(path.join(dir, "clients", "cli", "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "clients", "cli", "package.json"),
      JSON.stringify({
        name: "fixture-cli",
        scripts: {
          validate: "npm run typecheck",
          typecheck: "tsc --noEmit -p tsconfig.json",
        },
      }),
    );
    writeFileSync(
      path.join(dir, "clients", "cli", "tsconfig.json"),
      JSON.stringify({ include: ["src"] }),
    );
    writeFileSync(
      path.join(dir, "clients", "cli", "src", "index.ts"),
      "export const x = 1;\n",
    );
    mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
    for (const rel of [
      "verify-typecheck-coverage.mjs",
      path.join("lib", "npm-scripts.mjs"),
      path.join("lib", "resolve-node-bin.mjs"),
      path.join("lib", "tsc-program.mjs"),
    ])
      cpSync(path.join(scriptsDir, rel), path.join(dir, "scripts", rel));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });

    const r = spawnSync(
      process.execPath,
      [path.join(dir, "scripts", "verify-typecheck-coverage.mjs")],
      { cwd: dir, encoding: "utf8" },
    );
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /cannot resolve `typescript` from clients\/cli/, out);
    assert.match(out, /npm install/, out);
    // The pre-#1939 failure shape: per-project "(no diagnostic captured)"
    // warnings followed by every tracked file reported uncovered.
    assert.doesNotMatch(out, /get no `tsc` pass/, out);
    assert.doesNotMatch(out, /no diagnostic captured/, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
