// Regression tests for `verify-format-coverage`'s sibling-guard vouch (Copilot,
// #1962). The three root guards form a cycle so that dropping any one from
// `validate` is caught by another — but the vouch branch itself had no test, so
// a typo in a sibling's name would leave `test:scripts` green while that guard
// silently stopped being enforced. That is the same "a gate that stops gating"
// failure the cycle exists to prevent, one level up.
//
// The vouch runs before any file enumeration, so the fixture needs only a
// `package.json` and the script. Run via `npm run test:scripts`.

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

/** A `validate` chain running each named guard, plus the always-present self. */
function scriptsRunning(guards) {
  const scripts = {
    validate: ["verify:format-coverage", ...guards]
      .map((g) => `npm run ${g}`)
      .join(" && "),
    "verify:format-coverage": "node scripts/verify-format-coverage.mjs",
  };
  for (const g of guards) scripts[g] = `node scripts/${g.slice(7)}.mjs`;
  return scripts;
}

/**
 * Run `verify-format-coverage` in a throwaway repo whose root `validate` runs
 * exactly `guards`. realpath'd because the script only executes when
 * `import.meta.url` matches `process.argv[1]`, and macOS `tmpdir()` is a
 * symlink — see the note in `verify-dep-lockstep.main.test.mjs`.
 */
function runWithGuards(guards) {
  return runWithScripts(scriptsRunning(guards));
}

/** Same, for a fixture whose `scripts` are built by hand. */
function runWithScripts(scripts) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "format-cov-")));
  try {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "fixture", scripts }, null, 2),
    );
    mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
    for (const rel of [
      "verify-format-coverage.mjs",
      path.join("lib", "npm-scripts.mjs"),
    ])
      cpSync(path.join(scriptsDir, rel), path.join(dir, "scripts", rel));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });

    const r = spawnSync(
      process.execPath,
      [path.join(dir, "scripts", "verify-format-coverage.mjs")],
      { cwd: dir, encoding: "utf8" },
    );
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ALL_SIBLINGS = [
  "verify:typecheck-coverage",
  "verify:dep-lockstep",
  "verify:skills",
];

for (const dropped of ALL_SIBLINGS) {
  test(`vouch: fails when \`${dropped}\` is dropped from validate`, () => {
    const { status, out } = runWithGuards(
      ALL_SIBLINGS.filter((g) => g !== dropped),
    );
    assert.equal(status, 1, out);
    assert.match(out, new RegExp("no longer runs `" + dropped + "`"));
  });
}

test("vouch: a mention is not an invocation", () => {
  // `rootReachesScript` used to match any `npm run …` substring, so a `validate`
  // reading `echo npm run verify:skills` satisfied the vouch while the guard
  // never executed — the cycle protecting nothing (Copilot).
  const scripts = scriptsRunning(ALL_SIBLINGS);
  scripts.validate = scripts.validate.replace(
    "npm run verify:skills",
    "echo npm run verify:skills",
  );
  const { status, out } = runWithScripts(scripts);
  assert.equal(status, 1, out);
  assert.match(out, /no longer runs `verify:skills`/);
});

test("vouch: passes when every sibling is still wired", () => {
  // The run still fails afterwards — the fixture has no client manifests to
  // harvest globs from — so assert on the *reason*, not the exit status: no
  // sibling may be reported missing.
  const { out } = runWithGuards(ALL_SIBLINGS);
  assert.doesNotMatch(out, /no longer runs/);
});
