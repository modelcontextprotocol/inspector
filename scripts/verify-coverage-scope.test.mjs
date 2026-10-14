// Unit tests for verify-coverage-scope.mjs (#2709): how a declared coverage
// scope is expanded, how a report is compared against it, and the client
// roster's deny-by-default. `run()` is driven over a throwaway repo with an
// injected config resolver, so the vitest-5 shape that motivated the guard —
// a report collapsed to `clients/web/server/**` — is reproduced without
// installing vitest 5. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CLIENTS,
  checkClientRoster,
  diffCoverageScope,
  expandCoverageScope,
  run,
} from "./verify-coverage-scope.mjs";

const slash = (p) => p.split(path.sep).join("/");

/**
 * A throwaway repo holding the given files (repo-relative), each with a stub
 * body. realpath'd because macOS `tmpdir()` is a symlink and the guard
 * compares resolved paths.
 *
 * @param {string[]} files
 */
function makeRepo(files) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "cov-scope-")));
  for (const f of files) {
    const abs = path.join(root, f);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, "export {};\n");
  }
  return root;
}

const abs = (root, ...rel) => rel.map((r) => slash(path.join(root, r)));

test("a relative include resolves against the client directory", (t) => {
  const root = makeRepo([
    "clients/web/src/components/A.tsx",
    "clients/web/src/components/b/B.ts",
    "src/components/NotThisOne.tsx",
  ]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = expandCoverageScope({
    include: ["src/components/**/*.{ts,tsx}"],
    exclude: [],
    clientDir: path.join(root, "clients/web"),
    repoRoot: root,
  });
  assert.deepEqual(
    expected,
    abs(
      root,
      "clients/web/src/components/A.tsx",
      "clients/web/src/components/b/B.ts",
    ),
  );
});

test("an include starting with the client's own repo path resolves against the repo root", (t) => {
  const root = makeRepo(["clients/web/server/s.ts"]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = expandCoverageScope({
    include: ["clients/web/server/**/*.{ts,tsx}"],
    exclude: [],
    clientDir: path.join(root, "clients/web"),
    repoRoot: root,
  });
  assert.deepEqual(expected, abs(root, "clients/web/server/s.ts"));
});

test("an absolute include means itself", (t) => {
  const root = makeRepo(["core/json/a.ts", "core/json/deep/b.ts"]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = expandCoverageScope({
    include: [path.join(root, "core/json/**/*.{ts,tsx}")],
    exclude: [],
    clientDir: path.join(root, "clients/web"),
    repoRoot: root,
  });
  assert.deepEqual(
    expected,
    abs(root, "core/json/a.ts", "core/json/deep/b.ts"),
  );
});

test("an exclude matches absolute, client-relative or repo-relative paths", (t) => {
  const root = makeRepo([
    "clients/web/src/lib/keep.ts",
    "clients/web/src/lib/keep.test.ts",
    "clients/web/src/lib/index.ts",
    "clients/web/server/plugin.ts",
    "clients/web/server/kept.ts",
    "core/mcp/types.ts",
    "core/mcp/client.ts",
  ]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = expandCoverageScope({
    include: [
      "src/lib/**/*.ts",
      "clients/web/server/**/*.ts",
      path.join(root, "core/mcp/**/*.ts"),
    ],
    exclude: [
      "**/*.test.ts", // glob over any form
      "src/lib/index.ts", // client-relative
      "clients/web/server/plugin.ts", // repo-relative
      path.join(root, "core/mcp/types.ts"), // absolute
    ],
    clientDir: path.join(root, "clients/web"),
    repoRoot: root,
  });
  assert.deepEqual(
    expected,
    abs(
      root,
      "clients/web/server/kept.ts",
      "clients/web/src/lib/keep.ts",
      "core/mcp/client.ts",
    ),
  );
});

test("directories a glob matches are not expected files", (t) => {
  const root = makeRepo(["clients/tui/src/dir.ts/inner.ts"]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = expandCoverageScope({
    include: ["src/**/*.ts"],
    exclude: [],
    clientDir: path.join(root, "clients/tui"),
    repoRoot: root,
  });
  assert.deepEqual(expected, abs(root, "clients/tui/src/dir.ts/inner.ts"));
});

test("a report holding the declared set passes", () => {
  const expected = ["/r/clients/cli/src/a.ts", "/r/clients/cli/src/b.ts"];
  assert.deepEqual(
    diffCoverageScope({
      client: "cli",
      expected,
      reported: [...expected].reverse(),
      repoRoot: "/r",
    }),
    [],
  );
});

test("a narrower report fails, naming the client and each missing file", () => {
  const failures = diffCoverageScope({
    client: "web",
    expected: [
      "/r/clients/web/server/s.ts",
      "/r/clients/web/src/components/A.tsx",
      "/r/core/json/a.ts",
    ],
    reported: ["/r/clients/web/server/s.ts"],
    repoRoot: "/r",
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^web: 2 of 3 file\(s\)/);
  assert.match(failures[0], /report holds 1/);
  assert.match(failures[0], /\n {4}clients\/web\/src\/components\/A\.tsx\n/);
  assert.match(failures[0], /\n {4}core\/json\/a\.ts$/);
});

test("an include that expands to nothing fails rather than passing vacuously", () => {
  const failures = diffCoverageScope({
    client: "tui",
    expected: [],
    reported: [],
    repoRoot: "/r",
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /expands to no files at all/);
});

test("a stated omission is not reported missing, and a stale one is flagged", () => {
  const ok = diffCoverageScope({
    client: "web",
    expected: ["/r/clients/web/src/a.ts", "/r/clients/web/src/b.ts"],
    reported: ["/r/clients/web/src/a.ts"],
    omissions: { "clients/web/src/b.ts": "types only" },
    repoRoot: "/r",
  });
  assert.deepEqual(ok, []);
  const stale = diffCoverageScope({
    client: "web",
    expected: ["/r/clients/web/src/a.ts"],
    reported: ["/r/clients/web/src/a.ts"],
    omissions: { "clients/web/src/gone.ts": "types only" },
    repoRoot: "/r",
  });
  assert.equal(stale.length, 1);
  assert.match(stale[0], /KNOWN_OMISSIONS names clients\/web\/src\/gone\.ts/);
});

test("an omission without a reason is not honored and is itself a failure", () => {
  for (const reason of ["", "   ", undefined]) {
    const failures = diffCoverageScope({
      client: "web",
      expected: ["/r/clients/web/src/a.ts", "/r/clients/web/src/b.ts"],
      reported: ["/r/clients/web/src/a.ts"],
      omissions: { "clients/web/src/b.ts": reason },
      repoRoot: "/r",
    });
    assert.equal(failures.length, 2, `reason ${JSON.stringify(reason)}`);
    assert.match(failures[0], /^web: 1 of 2 file\(s\)/);
    assert.match(failures[0], /clients\/web\/src\/b\.ts/);
    assert.match(
      failures[1],
      /names clients\/web\/src\/b\.ts without a reason/,
    );
  }
});

test("an omission for a file the report now measures is flagged as stale", () => {
  const failures = diffCoverageScope({
    client: "web",
    expected: ["/r/clients/web/src/a.ts"],
    reported: ["/r/clients/web/src/a.ts"],
    omissions: { "clients/web/src/a.ts": "types only" },
    repoRoot: "/r",
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /which the report now measures/);
});

test("the roster fails on an unlisted coverage client and on a stale row", () => {
  const listed = CLIENTS.map((c) => c.name);
  assert.deepEqual(checkClientRoster([...listed].sort()), []);
  const unlisted = checkClientRoster([...listed, "newclient"]);
  assert.equal(unlisted.length, 1);
  assert.match(unlisted[0], /clients\/newclient has a test:coverage script/);
  const stale = checkClientRoster(listed.filter((n) => n !== "tui"));
  assert.equal(stale.length, 1);
  assert.match(stale[0], /CLIENTS names tui/);
});

test("the shipped roster is the five clients `npm run coverage` gates", () => {
  assert.deepEqual(CLIENTS.map((c) => c.name).sort(), [
    "cli",
    "launcher",
    "mcpdo",
    "tui",
    "web",
  ]);
});

/**
 * A fixture repo with one coverage client, `web`, whose declaration matches
 * three files — two outside `clients/web/server/**`.
 */
function makeWebFixture() {
  const root = makeRepo([
    "clients/web/server/s.ts",
    "clients/web/src/components/A.tsx",
    "core/json/a.ts",
  ]);
  writeFileSync(
    path.join(root, "clients/web/package.json"),
    JSON.stringify({ scripts: { "test:coverage": "vitest run --coverage" } }),
  );
  const resolveOptions = async () => ({
    include: [
      "src/components/**/*.{ts,tsx}",
      "clients/web/server/**/*.{ts,tsx}",
      path.join(root, "core/json/**/*.{ts,tsx}"),
    ],
    exclude: ["**/node_modules/**"],
  });
  /** @param {string[]} rel */
  const writeSummary = (rel) => {
    const summary = { total: {} };
    for (const r of rel) summary[path.join(root, r)] = {};
    mkdirSync(path.join(root, "clients/web/coverage"), { recursive: true });
    writeFileSync(
      path.join(root, "clients/web/coverage/coverage-summary.json"),
      JSON.stringify(summary),
    );
  };
  return { root, resolveOptions, writeSummary };
}

const webOnly = [{ name: "web", config: "vite.config.ts" }];

test("run(): a complete report passes", async (t) => {
  const { root, resolveOptions, writeSummary } = makeWebFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeSummary([
    "clients/web/server/s.ts",
    "clients/web/src/components/A.tsx",
    "core/json/a.ts",
  ]);
  const lines = [];
  const failures = await run({
    root,
    clients: webOnly,
    omissions: {},
    resolveOptions,
    log: (l) => lines.push(l),
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(lines, ["  web: 3 declared file(s), all measured"]);
});

test("run(): the vitest-5 collapse to clients/web/server/** fails (#2557)", async (t) => {
  const { root, resolveOptions, writeSummary } = makeWebFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeSummary(["clients/web/server/s.ts"]);
  const failures = await run({
    root,
    clients: webOnly,
    omissions: {},
    resolveOptions,
    log: () => {},
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^web: 2 of 3 file\(s\)/);
  assert.match(failures[0], /clients\/web\/src\/components\/A\.tsx/);
  assert.match(failures[0], /core\/json\/a\.ts/);
});

test("run(): a missing summary fails rather than being skipped", async (t) => {
  const { root, resolveOptions } = makeWebFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const failures = await run({
    root,
    clients: webOnly,
    omissions: {},
    resolveOptions,
    log: () => {},
  });
  assert.equal(failures.length, 1);
  assert.match(
    failures[0],
    /^web: no clients\/web\/coverage\/coverage-summary\.json/,
  );
});
