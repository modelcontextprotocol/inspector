// Table-driven tests for the shared `tsc` program helpers — the machinery both
// `verify:typecheck-coverage` (#1791) and `verify:dep-lockstep` (#1965) read a
// program through. One case per rule; the comment names the rule, so relaxing
// one shows up as a deleted assertion rather than a quiet behavior shift. The
// script-parsing and tsconfig-graph cases moved here with their code when the
// two guards were unified; their `(rN)` tags are the #1799 review rounds that
// found them. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyModulePath,
  crossInstallPackages,
  isDisablingFlag,
  isTsc,
  parseTsconfigReferences,
  projectConfigFile,
  refToProject,
  typecheckProjects,
} from "./tsc-program.mjs";

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

test("classifyModulePath: install root is the OUTERMOST node_modules, package the innermost (#1965)", () => {
  assert.deepEqual(classifyModulePath("node_modules/zod/index.d.ts"), {
    installRoot: ".",
    name: "zod",
    entryPath: "node_modules/zod",
  });
  assert.deepEqual(
    classifyModulePath("clients/web/node_modules/zod/index.d.ts"),
    {
      installRoot: "clients/web",
      name: "zod",
      entryPath: "node_modules/zod",
    },
  );
  // A scoped package keeps both segments.
  assert.deepEqual(
    classifyModulePath("node_modules/@modelcontextprotocol/sdk/dist/x.d.ts"),
    {
      installRoot: ".",
      name: "@modelcontextprotocol/sdk",
      entryPath: "node_modules/@modelcontextprotocol/sdk",
    },
  );
  // A NESTED copy folds onto its outermost install: npm resolving a transitive
  // conflict inside one install is routine, not a cross-install skew. Its
  // `entryPath` still names the copy itself, so the caller can price the version
  // the program actually loaded (Copilot, #1965 r1).
  assert.deepEqual(
    classifyModulePath("node_modules/a/node_modules/zod/index.d.ts"),
    {
      installRoot: ".",
      name: "zod",
      entryPath: "node_modules/a/node_modules/zod",
    },
  );
  assert.deepEqual(
    classifyModulePath(
      "clients/cli/node_modules/a/node_modules/@scope/b/index.d.ts",
    ),
    {
      installRoot: "clients/cli",
      name: "@scope/b",
      entryPath: "node_modules/a/node_modules/@scope/b",
    },
  );
});

test("classifyModulePath: paths that name no package", () => {
  for (const rel of [
    "core/mcp/client.ts", // first-party source
    "clients/web/src/App.tsx",
    "node_modules/.bin/tsc", // npm bookkeeping, not a package
    "node_modules/.package-lock.json",
    "node_modules/@scope", // a scope directory names no package
    "node_modules", // the directory itself
  ])
    assert.equal(classifyModulePath(rel), null, rel);
});

test("classifyModulePath: a path segment merely CONTAINING node_modules is not one", () => {
  // Segment-wise matching, not substring: a first-party dir whose name embeds
  // the word would otherwise be read as an install root.
  assert.equal(classifyModulePath("core/node_modules_fixtures/a.ts"), null);
});

test("crossInstallPackages: two installs in ONE program is the whole test (#1965)", () => {
  const found = crossInstallPackages([
    {
      label: "clients/web/tsconfig.test.json",
      files: [
        "node_modules/zod/index.d.ts",
        "clients/web/node_modules/zod/index.d.ts",
        "clients/web/node_modules/react/index.d.ts",
      ],
    },
  ]);
  assert.deepEqual([...found.keys()], ["zod"]);
  const byRoot = found.get("zod").get("clients/web/tsconfig.test.json");
  assert.deepEqual([...byRoot.keys()].sort(), [".", "clients/web"]);
  // The entry paths ride along so the caller can price each copy from its own
  // lockfile entry (Copilot, #1965 r1).
  assert.deepEqual([...byRoot.get(".")], ["node_modules/zod"]);
});

test("crossInstallPackages: two installs across SEPARATE programs is not a candidate", () => {
  // Two copies the type checker never has to relate — each program sees one.
  const found = crossInstallPackages([
    { label: "a", files: ["node_modules/zod/index.d.ts"] },
    { label: "b", files: ["clients/cli/node_modules/zod/index.d.ts"] },
  ]);
  assert.equal(found.size, 0);
});

test("crossInstallPackages: a nested duplicate inside one install is not a candidate", () => {
  const found = crossInstallPackages([
    {
      label: "a",
      files: [
        "node_modules/zod/index.d.ts",
        "node_modules/other/node_modules/zod/index.d.ts",
      ],
    },
  ]);
  assert.equal(found.size, 0);
});

test("crossInstallPackages: every program that saw both copies is recorded", () => {
  const both = [
    "node_modules/zod/index.d.ts",
    "clients/web/node_modules/zod/index.d.ts",
  ];
  const found = crossInstallPackages([
    { label: "web/app", files: both },
    { label: "web/test", files: both },
    { label: "cli/src", files: ["node_modules/zod/index.d.ts"] },
  ]);
  assert.deepEqual([...found.get("zod").keys()].sort(), [
    "web/app",
    "web/test",
  ]);
});

test("crossInstallPackages: a nested copy is kept as its own entry path (Copilot, #1965 r1)", () => {
  // Folded onto the root install for candidacy, but recorded at the path it was
  // loaded from so its real version can be read.
  const found = crossInstallPackages([
    {
      label: "p",
      files: [
        "node_modules/a/node_modules/zod/index.d.ts",
        "clients/web/node_modules/zod/index.d.ts",
      ],
    },
  ]);
  assert.deepEqual(
    [...found.get("zod").get("p").get(".")],
    ["node_modules/a/node_modules/zod"],
  );
});
