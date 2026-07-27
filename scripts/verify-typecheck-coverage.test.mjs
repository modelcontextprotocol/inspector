// Table-driven tests for verify-typecheck-coverage's pure parsers. Importing the
// module exposes these without running the guard (its execution is behind
// `main()`, called only when the file is run directly). Each case pins a rule a
// #1799 review round found. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesTestGlob,
  isDisablingFlag,
  isRequiredSource,
  isTsc,
  parseTsconfigReferences,
  projectConfigFile,
  refToProject,
  testScriptGlobs,
  testScriptProblems,
  tscBuildStatus,
  typecheckProjects,
} from "./verify-typecheck-coverage.mjs";

test("isRequiredSource: TS extensions, ambient .d.ts excluded (r7)", () => {
  for (const f of ["a.ts", "a.tsx", "a.mts", "a.cts"])
    assert.ok(isRequiredSource(f), f);
  for (const f of ["a.js", "a.d.ts", "a.d.mts", "a.d.cts", "a.json"])
    assert.ok(!isRequiredSource(f), f);
});

test("isTsc: matches by basename incl. path-invoked (r18 regression)", () => {
  for (const t of [
    "tsc",
    "node_modules/.bin/tsc",
    "./node_modules/.bin/tsc.cmd",
  ])
    assert.ok(isTsc(t), t);
  for (const t of ["vitest", "prettier", "tscx", "atsc"])
    assert.ok(!isTsc(t), t);
});

test("isDisablingFlag: case-insensitive (r18)", () => {
  for (const t of [
    "--noCheck",
    "--nocheck",
    "--listFilesOnly",
    "--LISTFILESONLY",
  ])
    assert.ok(isDisablingFlag(t), t);
  for (const t of ["--noEmit", "-p", "--project", "noCheck"])
    assert.ok(!isDisablingFlag(t), t);
});

test("typecheckProjects: harvests -p / --project / -b, implicit tsconfig.json (r13)", () => {
  const { projects, neutered } = typecheckProjects({
    typecheck:
      "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json",
  });
  assert.deepEqual(projects, ["tsconfig.json", "tsconfig.test.json"]);
  assert.equal(neutered.length, 0);

  // A bare `tsc` (no project flag) resolves the implicit ./tsconfig.json.
  assert.deepEqual(typecheckProjects({ typecheck: "tsc --noEmit" }).projects, [
    "tsconfig.json",
  ]);

  // Path-invoked binary still counts (r18).
  assert.deepEqual(
    typecheckProjects({ typecheck: "node_modules/.bin/tsc -p tsconfig.json" })
      .projects,
    ["tsconfig.json"],
  );

  // A quoted project path (r17).
  assert.deepEqual(
    typecheckProjects({ typecheck: `tsc -p "tsconfig.test.json"` }).projects,
    ["tsconfig.test.json"],
  );

  // `--project` long form, and `-b`/`--build` project paths (r13).
  const proj = (cmd) => typecheckProjects({ typecheck: cmd }).projects;
  assert.deepEqual(proj("tsc --noEmit --project tsconfig.json"), [
    "tsconfig.json",
  ]);
  assert.deepEqual(proj("tsc -b tsconfig.json"), ["tsconfig.json"]);
  assert.deepEqual(proj("tsc --build tsconfig.json"), ["tsconfig.json"]);
  assert.deepEqual(proj("tsc -b"), ["tsconfig.json"]); // implicit fallback
});

test("typecheckProjects: neutered by --noCheck / --listFilesOnly (r10)", () => {
  const { projects, neutered } = typecheckProjects({
    typecheck:
      "tsc --noEmit -p tsconfig.json --noCheck && tsc --noEmit -p tsconfig.test.json",
  });
  assert.deepEqual(projects, ["tsconfig.test.json"]);
  assert.deepEqual(neutered, [{ project: "tsconfig.json", flag: "--noCheck" }]);
});

test("typecheckProjects: delegating typecheck, ignores non-tsc segments (r15)", () => {
  const { projects } = typecheckProjects({
    typecheck: "npm run typecheck:src && npm run typecheck:test",
    "typecheck:src": "tsc --noEmit -p tsconfig.json",
    "typecheck:test": "tsc --noEmit --project tsconfig.test.json",
  });
  assert.deepEqual(projects.sort(), ["tsconfig.json", "tsconfig.test.json"]);
});

test("tscBuildStatus: ok / neutered / none (r25)", () => {
  const status = (build) =>
    tscBuildStatus({ validate: "npm run build", build });
  assert.equal(status("tsc -b && vite build"), "ok");
  assert.equal(status("tsc --build"), "ok");
  assert.equal(status("tsc -b --noCheck && vite build"), "neutered");
  assert.equal(status("vite build"), "none");
  assert.equal(status("tsc --noEmit -p tsconfig.json"), "none"); // -b required
});

test("parseTsconfigReferences: JSONC tolerance (r17-nit2 block comments)", () => {
  const refs = (raw) => parseTsconfigReferences(raw);
  assert.deepEqual(refs('{ "references": [{ "path": "./a" }] }'), ["./a"]);
  assert.deepEqual(
    refs('/* solution */\n{ "references": [{ "path": "./a" }] }'),
    ["./a"],
  );
  assert.deepEqual(refs('{ "references": [{ "path": "./a" }] } // trailing'), [
    "./a",
  ]);
  assert.deepEqual(refs('{ "references": [{ "path": "./a" },] }'), ["./a"]); // trailing comma
  assert.deepEqual(refs('{ "files": [] }'), []); // no references
  assert.deepEqual(refs("{ not json"), []); // malformed
  assert.deepEqual(refs('{ "references": [{ "prepend": true }] }'), []); // no path
});

test("matchesTestGlob: the guard's contract, not node's glob engine", () => {
  // Only the two properties the guard actually relies on — the rest of node's
  // glob semantics are node's to test, which is the point of delegating to it.
  const g = "scripts/**/*.test.mjs";
  assert.ok(matchesTestGlob("scripts/verify-typecheck-coverage.test.mjs", g)); // zero-depth **
  assert.ok(matchesTestGlob("scripts/lib/npm-scripts.test.mjs", g)); // nested
  assert.ok(!matchesTestGlob("scripts/lib/npm-scripts.spec.mjs", g)); // the probe-B rename
});

test("testScriptGlobs: harvests across delegation (r31 finding 1 / r32 finding 2)", () => {
  // Direct form — the glob itself, with `node` and flags dropped.
  assert.deepEqual(
    testScriptGlobs({ "test:scripts": 'node --test "scripts/**/*.test.mjs"' }),
    ["scripts/**/*.test.mjs"],
  );
  // Delegating form — BOTH child globs, not the literal npm/run/<name> tokens.
  const delegating = testScriptGlobs({
    "test:scripts": "npm run test:scripts:lib && npm run test:scripts:guard",
    "test:scripts:lib": 'node --test "scripts/lib/**/*.test.mjs"',
    "test:scripts:guard": 'node --test "scripts/*.test.mjs"',
  });
  assert.ok(delegating.includes("scripts/lib/**/*.test.mjs"));
  assert.ok(delegating.includes("scripts/*.test.mjs"));
  // A pre<name> hook is reached too (npm runs it implicitly).
  assert.ok(
    testScriptGlobs({
      "test:scripts": "node --test scripts/a.test.mjs",
      "pretest:scripts": "node --test scripts/b.test.mjs",
    }).includes("scripts/b.test.mjs"),
  );
  // An unreachable script contributes nothing.
  assert.deepEqual(
    testScriptGlobs({
      "test:scripts": "node --test scripts/a.test.mjs",
      other: "node --test scripts/z.test.mjs",
    }),
    ["scripts/a.test.mjs"],
  );
});

test("testScriptGlobs: only `node --test` segments contribute (r33 finding 1)", () => {
  // A reachable NON-runner command's glob must not be attributed to the runner:
  // `scripts/**/*.mjs` matches a renamed `*.spec.mjs`, so harvesting it would
  // make the probe-B rename pass while `node --test` silently ran 6 fewer tests.
  assert.deepEqual(
    testScriptGlobs({
      "test:scripts": 'node --test "scripts/**/*.test.mjs"',
      "pretest:scripts": 'prettier --check "scripts/**/*.mjs"',
    }),
    ["scripts/**/*.test.mjs"],
  );
  // Same within one command: only the `--test` segment's args are harvested.
  assert.deepEqual(
    testScriptGlobs({
      "test:scripts":
        'prettier --check "scripts/**/*.mjs" && node --test "scripts/**/*.test.mjs"',
    }),
    ["scripts/**/*.test.mjs"],
  );
});

test("testScriptGlobs: empty when no glob is named (r33 finding 2)", () => {
  // The condition the "`test:scripts` names no path/glob" branch keys off — a
  // bare `node --test` auto-discovers, so the guard can't tell what it runs.
  assert.deepEqual(testScriptGlobs({ "test:scripts": "node --test" }), []);
  assert.deepEqual(testScriptGlobs({}), []);
});

test("testScriptProblems: all three axes (r33 finding 2)", () => {
  const WIRED = {
    validate: "npm run test:scripts",
    "test:scripts": 'node --test "scripts/**/*.test.mjs"',
  };
  const only = (p) => (assert.equal(p.length, 1, p.join("\n")), p[0]);

  // Green: wired, non-empty, every file glob-matched.
  assert.deepEqual(testScriptProblems(WIRED, ["scripts/a.test.mjs"]), []);

  // Axis 1 — not reachable from `validate`. Reported alone: with the tests
  // unrun, the other two axes are moot.
  assert.match(
    only(
      testScriptProblems(
        { validate: "echo hi", "test:scripts": WIRED["test:scripts"] },
        ["scripts/a.test.mjs"],
      ),
    ),
    /no longer runs `test:scripts`/,
  );

  // Axis 2 — no tracked test files at all.
  assert.match(
    only(testScriptProblems(WIRED, [])),
    /no `scripts\/\*\*\/\*\.test\.\*` files are tracked/,
  );

  // Axis 3 — a file `node --test` would skip (the probe-B rename).
  assert.match(
    only(testScriptProblems(WIRED, ["scripts/a.spec.mjs"])),
    /^scripts\/a\.spec\.mjs: not matched by the `test:scripts` glob/,
  );

  // The empty-harvest branch: ONE message naming the real problem, not one
  // unfollowable blame per file. (`if (false)`-mutating it yields 2 messages.)
  assert.match(
    only(
      testScriptProblems(
        { validate: "npm run test:scripts", "test:scripts": "node --test" },
        ["scripts/a.test.mjs", "scripts/b.test.mjs"],
      ),
    ),
    /names no path\/glob/,
  );
});

test("projectConfigFile: directory-form entry means <dir>/tsconfig.json (r26)", () => {
  assert.equal(
    projectConfigFile("clients/cli", "tsconfig.test.json"),
    "clients/cli/tsconfig.test.json",
  );
  assert.equal(
    projectConfigFile("clients/cli", "packages/a"),
    "clients/cli/packages/a/tsconfig.json",
  );
  assert.equal(
    projectConfigFile("clients/cli", "."),
    "clients/cli/tsconfig.json",
  );
});

test("refToProject: refs resolve against the REFERRING config's dir (r26)", () => {
  // A ref is relative to the tsconfig that declares it, not to clientDir.
  assert.equal(
    refToProject(
      "clients/web",
      "clients/web/tsconfig.json",
      "./tsconfig.app.json",
    ),
    "tsconfig.app.json",
  );
  assert.equal(
    refToProject(
      "clients/web",
      "clients/web/sub/tsconfig.json",
      "../other.json",
    ),
    "other.json",
  );
  assert.equal(
    refToProject("clients/web", "clients/web/sub/tsconfig.json", "./deep"),
    "sub/deep",
  );
});
