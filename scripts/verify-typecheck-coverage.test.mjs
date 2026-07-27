// Table-driven tests for verify-typecheck-coverage's pure parsers. Importing the
// module exposes these without running the guard (its execution is behind
// `main()`, called only when the file is run directly). Each case pins a rule a
// #1799 review round found. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  globToRegExp,
  isDisablingFlag,
  isRequiredSource,
  isTsc,
  parseTsconfigReferences,
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

test("globToRegExp: matches the test:scripts glob shape", () => {
  const g = globToRegExp("scripts/**/*.test.mjs");
  assert.ok(g.test("scripts/lib/npm-scripts.test.mjs"));
  assert.ok(g.test("scripts/verify-typecheck-coverage.test.mjs")); // zero-depth **
  assert.ok(!g.test("scripts/lib/npm-scripts.spec.mjs")); // wrong suffix
  assert.ok(!g.test("scripts/lib/npm-scripts.test.mts")); // wrong ext
});
