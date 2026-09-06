// Tests for sdk-watch.mjs (#1063) — the pure comparison/formatting helpers and
// `main()`'s orchestration, the latter driven through an injected spawn function
// so no `npm` or `gh` process is ever started.
//
// `main()` is covered rather than left to `workflow_dispatch` because a
// production trigger is not a test — the same reasoning the two sibling sweeps
// record. The cases that matter most here are the ones where a wrong answer is
// SILENT: a registry failure reported as "everything current", a second issue
// filed for a version that already has one, and an SDK package added to the root
// manifest that no group watches.
//
// Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertEveryPackageWatched,
  buildIssueBody,
  buildIssueTitle,
  buildMarker,
  buildSupersededComment,
  formatFiledOutput,
  groupState,
  installedVersion,
  main,
  parseMarker,
  parseSupersededMarker,
  pickMilestone,
  SDK_GROUPS,
  TARGET_BRANCH,
} from "./sdk-watch.mjs";

const SDK = SDK_GROUPS[0];
const EXT = SDK_GROUPS[1];

/** Every version triple current, so a group is behind only where a test says so. */
function currentVersions(overrides = {}) {
  const versions = {};
  for (const pkg of SDK_GROUPS.flatMap((g) => g.packages)) {
    versions[pkg] = { declared: "2.0.0", installed: "2.0.0", latest: "2.0.0" };
  }
  return { ...versions, ...overrides };
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

test("buildMarker and parseMarker round-trip", () => {
  const marker = buildMarker(SDK, "2.1.0");
  assert.deepEqual(parseMarker(`${marker}\nrest of body`), {
    key: "typescript-sdk",
    target: "2.1.0",
  });
});

test("parseMarker returns null for a body with no marker, or an undefined body", () => {
  assert.equal(parseMarker("just some text"), null);
  assert.equal(parseMarker(undefined), null);
});

test("parseMarker only matches a marker on the FIRST line", () => {
  // The marker is the idempotency key; matching it mid-body would let an issue
  // that merely quotes another one suppress a genuine filing.
  assert.equal(parseMarker(`preamble\n${buildMarker(SDK, "2.1.0")}`), null);
});

test("parseSupersededMarker reads back the issue number it announced", () => {
  const body = buildSupersededComment(42, "2.2.0", "2.1.0");
  assert.equal(parseSupersededMarker(body), "42");
  assert.equal(parseSupersededMarker("unrelated comment"), null);
});

// ---------------------------------------------------------------------------
// The unwatched-package guard
// ---------------------------------------------------------------------------

test("assertEveryPackageWatched accepts a manifest whose SDK packages are all grouped", () => {
  const deps = Object.fromEntries(
    SDK_GROUPS.flatMap((g) => g.packages).map((p) => [p, "2.0.0"]),
  );
  assert.doesNotThrow(() => assertEveryPackageWatched({ ...deps, zod: "^4" }));
});

test("assertEveryPackageWatched throws when an SDK package no group watches is declared", () => {
  assert.throws(
    () =>
      assertEveryPackageWatched({
        "@modelcontextprotocol/client": "2.0.0",
        "@modelcontextprotocol/brand-new": "1.0.0",
      }),
    /@modelcontextprotocol\/brand-new/,
  );
});

test("assertEveryPackageWatched tolerates a manifest with no dependencies at all", () => {
  assert.doesNotThrow(() => assertEveryPackageWatched(undefined));
});

// ---------------------------------------------------------------------------
// Version reading and comparison
// ---------------------------------------------------------------------------

test("installedVersion reads the hoisted entry and ignores a nested copy", () => {
  const lock = {
    packages: {
      "node_modules/@modelcontextprotocol/client": { version: "2.0.0" },
      "node_modules/other/node_modules/@modelcontextprotocol/client": {
        version: "1.0.0",
      },
    },
  };
  assert.equal(installedVersion(lock, "@modelcontextprotocol/client"), "2.0.0");
});

test("installedVersion returns null for a package that is not installed", () => {
  assert.equal(
    installedVersion({ packages: {} }, "@modelcontextprotocol/core"),
    null,
  );
  assert.equal(installedVersion(undefined, "@modelcontextprotocol/core"), null);
});

test("groupState returns null when every package in the group is current", () => {
  assert.equal(groupState(SDK, currentVersions()), null);
});

test("groupState reports the group behind when one package has a newer latest", () => {
  const state = groupState(
    SDK,
    currentVersions({
      "@modelcontextprotocol/client": {
        declared: "2.0.0",
        installed: "2.0.0",
        latest: "2.1.0",
      },
    }),
  );
  assert.equal(state.target, "2.1.0");
  assert.equal(state.rows.filter((r) => r.behind).length, 1);
  assert.equal(state.rows.length, SDK.packages.length);
});

test("groupState targets the highest version among the packages that are behind", () => {
  // A partially-published release: one package live at 2.2.0, another still at
  // 2.1.0. Taking any single package's latest would title the issue below what
  // its own table shows.
  const state = groupState(
    SDK,
    currentVersions({
      "@modelcontextprotocol/client": {
        declared: "2.0.0",
        installed: "2.0.0",
        latest: "2.1.0",
      },
      "@modelcontextprotocol/core": {
        declared: "2.0.0",
        installed: "2.0.0",
        latest: "2.2.0",
      },
    }),
  );
  assert.equal(state.target, "2.2.0");
});

test("groupState compares against the INSTALLED version, not the declared range", () => {
  // The ext-apps shape: `^1.7.4` declared, 1.7.5 already resolved by the
  // lockfile, 1.7.5 latest. Comparing declared-to-latest would file an issue
  // for a bump `npm install` has already taken.
  const state = groupState(EXT, {
    "@modelcontextprotocol/ext-apps": {
      declared: "^1.7.4",
      installed: "1.7.5",
      latest: "1.7.5",
    },
  });
  assert.equal(state, null);
});

test("groupState does not call an uninstalled or unknown-latest package behind", () => {
  assert.equal(
    groupState(EXT, {
      "@modelcontextprotocol/ext-apps": {
        declared: "^1.7.4",
        installed: null,
        latest: "1.7.5",
      },
    }),
    null,
  );
  assert.equal(
    groupState(EXT, {
      "@modelcontextprotocol/ext-apps": {
        declared: "^1.7.4",
        installed: "1.7.5",
        latest: null,
      },
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// Issue text
// ---------------------------------------------------------------------------

function behindState(group = SDK, target = "2.1.0") {
  return groupState(
    group,
    currentVersions({
      [group.packages[0]]: {
        declared: "2.0.0",
        installed: "2.0.0",
        latest: target,
      },
    }),
  );
}

test("buildIssueTitle names the group label and the target version", () => {
  assert.equal(
    buildIssueTitle(behindState()),
    "chore(deps): upgrade the MCP TypeScript SDK to 2.1.0",
  );
});

test("buildIssueBody leads with the marker so parseMarker can read it back", () => {
  const body = buildIssueBody(behindState());
  assert.ok(body.startsWith(buildMarker(SDK, "2.1.0")));
  assert.deepEqual(parseMarker(body), {
    key: "typescript-sdk",
    target: "2.1.0",
  });
});

test("buildIssueBody tables every package in the group and marks which are behind", () => {
  const body = buildIssueBody(behindState());
  for (const pkg of SDK.packages) assert.ok(body.includes(pkg), pkg);
  assert.equal((body.match(/\*\*yes\*\*/g) ?? []).length, 1);
  assert.ok(body.includes(TARGET_BRANCH));
  assert.ok(body.includes(`https://github.com/${SDK.repo}/releases`));
});

test("buildIssueBody escapes a pipe so one value cannot break the table apart", () => {
  const state = groupState(EXT, {
    "@modelcontextprotocol/ext-apps": {
      declared: ">=1.0.0 || ^2.0.0",
      installed: "1.7.5",
      latest: "1.8.0",
    },
  });
  assert.ok(buildIssueBody(state).includes("\\|\\|"));
});

test("buildSupersededComment points at the newer issue and does not claim to close", () => {
  const body = buildSupersededComment(99, "2.2.0", "2.1.0");
  assert.ok(body.includes("#99"));
  assert.ok(body.includes("2.2.0"));
  assert.ok(/Left open rather than closed/.test(body));
});

// ---------------------------------------------------------------------------
// Milestone selection
// ---------------------------------------------------------------------------

test("pickMilestone takes the nearest due date among open milestones", () => {
  assert.equal(
    pickMilestone([
      { title: "v2.7.0", state: "open", due_on: "2026-10-01T00:00:00Z" },
      { title: "v2.6.0", state: "open", due_on: "2026-09-09T00:00:00Z" },
    ]),
    "v2.6.0",
  );
});

test("pickMilestone drops undated and closed buckets, and returns null for none", () => {
  assert.equal(
    pickMilestone([
      { title: "Backlog", state: "open", due_on: null },
      { title: "v2.5.0", state: "closed", due_on: "2026-08-01T00:00:00Z" },
    ]),
    null,
  );
  assert.equal(pickMilestone([]), null);
  assert.equal(pickMilestone(undefined), null);
});

test("formatFiledOutput emits a single-line GITHUB_OUTPUT assignment", () => {
  const line = formatFiledOutput([
    { issue: 7, label: "x", repo: "a/b", from: "1.0.0", to: "2.0.0" },
  ]);
  assert.ok(line.startsWith("filed="));
  assert.equal(line.includes("\n"), false);
  assert.deepEqual(JSON.parse(line.slice("filed=".length))[0].issue, 7);
});

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

/**
 * A fake `spawnSync` that answers by command shape and records every call.
 *
 * @param {object} opts
 * @param {Record<string,string>} [opts.latest] `npm view` answer per package
 * @param {number} [opts.npmStatus] exit status for every `npm view`
 * @param {string} [opts.npmStdout] override stdout for every `npm view`
 * @param {Array<{number:number,body:string,state:string}>} [opts.issues] what `gh issue list` returns
 * @param {Array<{title:string,state:string,due_on:string|null}>} [opts.milestones]
 * @param {string[]} [opts.comments] existing comment bodies on any issue
 * @param {number} [opts.createStatus] exit status for `gh issue create`
 * @param {number} [opts.nextIssue] number the created issue URL ends with
 */
function fakeSpawn({
  latest = {},
  npmStatus,
  npmStdout,
  issues = [],
  milestones = [
    { title: "v2.6.0", state: "open", due_on: "2026-09-09T00:00:00Z" },
  ],
  comments = [],
  createStatus = 0,
  nextIssue = 500,
} = {}) {
  const calls = [];
  let issueCounter = nextIssue;
  const fn = (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "npm") {
      const pkg = args[1];
      return {
        status: npmStatus ?? 0,
        stdout: npmStdout ?? `${latest[pkg] ?? "2.0.0"}\n`,
        stderr: npmStatus ? "ENOTFOUND registry.npmjs.org" : "",
      };
    }
    if (args[0] === "issue" && args[1] === "list")
      return { status: 0, stdout: JSON.stringify(issues), stderr: "" };
    if (args[0] === "issue" && args[1] === "create")
      return {
        status: createStatus,
        stdout: createStatus
          ? ""
          : `https://github.com/o/r/issues/${issueCounter++}\n`,
        stderr: createStatus ? "could not create issue" : "",
      };
    if (args[0] === "issue" && args[1] === "comment")
      return { status: 0, stdout: "", stderr: "" };
    // MUST be tested before the milestone branch: both are `gh api`, so
    // matching on args[0] alone would hand the comment lookup the milestone
    // payload and the assertion would silently check nothing.
    if (args[0] === "api" && args.some((a) => String(a).includes("/comments")))
      return { status: 0, stdout: comments.join("\n"), stderr: "" };
    if (args[0] === "api")
      return { status: 0, stdout: JSON.stringify(milestones), stderr: "" };
    throw new Error(`unexpected call: ${cmd} ${args.join(" ")}`);
  };
  fn.calls = calls;
  return fn;
}

/** Manifest + lockfile fixtures, with the whole SDK current unless overridden. */
function fakeReadFile({ declared = {}, installed = {} } = {}) {
  const all = SDK_GROUPS.flatMap((g) => g.packages);
  const manifest = {
    dependencies: Object.fromEntries(
      all.map((p) => [p, declared[p] ?? "2.0.0"]),
    ),
  };
  const lock = {
    packages: Object.fromEntries(
      all.map((p) => [
        `node_modules/${p}`,
        { version: installed[p] ?? "2.0.0" },
      ]),
    ),
  };
  return (path) => JSON.stringify(path === "package.json" ? manifest : lock);
}

/** A real temp file, so the GITHUB_OUTPUT append path is exercised end to end. */
function outputFile() {
  return join(mkdtempSync(join(tmpdir(), "sdk-watch-")), "out.txt");
}

function readFiled(path) {
  const line = readFileSync(path, "utf8").trim();
  return JSON.parse(line.slice("filed=".length));
}

test("main files nothing and emits an empty list when the whole SDK is current", () => {
  const spawn = fakeSpawn();
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  assert.deepEqual(readFiled(output), []);
  assert.equal(
    spawn.calls.some((c) => c.cmd === "gh"),
    false,
    "a quiet night must not touch the GitHub API at all",
  );
});

test("main files a labeled, milestoned issue when a group is behind", () => {
  const spawn = fakeSpawn({
    latest: { "@modelcontextprotocol/client": "2.1.0" },
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  const create = spawn.calls.find(
    (c) => c.args[0] === "issue" && c.args[1] === "create",
  );
  assert.ok(create, "expected an issue to be created");
  assert.ok(create.args.includes("v2"));
  assert.ok(create.args.includes("chore"));
  assert.ok(create.args.includes("dependencies"));
  assert.ok(create.args.includes("--milestone"));
  assert.ok(create.args.includes("v2.6.0"));
  assert.equal(
    create.args[create.args.indexOf("--title") + 1],
    "chore(deps): upgrade the MCP TypeScript SDK to 2.1.0",
  );

  assert.deepEqual(readFiled(output), [
    {
      issue: 500,
      label: "MCP TypeScript SDK",
      repo: "modelcontextprotocol/typescript-sdk",
      from: "2.0.0",
      to: "2.1.0",
    },
  ]);
});

test("main files one issue per upstream when both groups are behind", () => {
  const spawn = fakeSpawn({
    latest: {
      "@modelcontextprotocol/client": "2.1.0",
      "@modelcontextprotocol/ext-apps": "1.8.0",
    },
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, {
    readFile: fakeReadFile({
      declared: { "@modelcontextprotocol/ext-apps": "^1.7.4" },
      installed: { "@modelcontextprotocol/ext-apps": "1.7.5" },
    }),
    output,
  });

  const created = spawn.calls.filter(
    (c) => c.args[0] === "issue" && c.args[1] === "create",
  );
  assert.equal(created.length, 2);
  const filed = readFiled(output);
  assert.deepEqual(
    filed.map((f) => f.repo),
    ["modelcontextprotocol/typescript-sdk", "modelcontextprotocol/ext-apps"],
  );
  assert.equal(filed[1].from, "1.7.5", "from is the installed version");
});

test("main does not refile when an issue already covers this target", () => {
  const spawn = fakeSpawn({
    latest: { "@modelcontextprotocol/client": "2.1.0" },
    issues: [
      {
        number: 400,
        state: "OPEN",
        body: `${buildMarker(SDK, "2.1.0")}\nexisting`,
      },
    ],
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  assert.equal(
    spawn.calls.some((c) => c.args[0] === "issue" && c.args[1] === "create"),
    false,
  );
  assert.deepEqual(
    readFiled(output),
    [],
    "an already-filed target must not reach the analysis job again",
  );
});

test("main respects a CLOSED issue for the same target and does not refile nightly", () => {
  const spawn = fakeSpawn({
    latest: { "@modelcontextprotocol/client": "2.1.0" },
    issues: [
      {
        number: 400,
        state: "CLOSED",
        body: `${buildMarker(SDK, "2.1.0")}\nwon't fix`,
      },
    ],
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  assert.equal(
    spawn.calls.some((c) => c.args[0] === "issue" && c.args[1] === "create"),
    false,
  );
});

test("main comments on an open older-target issue that a new filing supersedes", () => {
  const spawn = fakeSpawn({
    latest: { "@modelcontextprotocol/client": "2.2.0" },
    issues: [
      {
        number: 400,
        state: "OPEN",
        body: `${buildMarker(SDK, "2.1.0")}\nolder`,
      },
    ],
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  const comment = spawn.calls.find(
    (c) => c.args[0] === "issue" && c.args[1] === "comment",
  );
  assert.ok(comment, "expected a supersession comment");
  assert.equal(comment.args[2], "400");
  assert.ok(comment.args[comment.args.indexOf("--body") + 1].includes("#500"));
});

test("main does not repeat a supersession comment it already left", () => {
  const spawn = fakeSpawn({
    latest: { "@modelcontextprotocol/client": "2.2.0" },
    issues: [
      {
        number: 400,
        state: "OPEN",
        body: `${buildMarker(SDK, "2.1.0")}\nolder`,
      },
    ],
    comments: [buildSupersededComment(500, "2.2.0", "2.1.0").split("\n")[0]],
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  assert.equal(
    spawn.calls.some((c) => c.args[0] === "issue" && c.args[1] === "comment"),
    false,
  );
});

test("main leaves a CLOSED older-target issue alone", () => {
  const spawn = fakeSpawn({
    latest: { "@modelcontextprotocol/client": "2.2.0" },
    issues: [
      {
        number: 400,
        state: "CLOSED",
        body: `${buildMarker(SDK, "2.1.0")}\nolder`,
      },
    ],
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  assert.equal(
    spawn.calls.some((c) => c.args[0] === "issue" && c.args[1] === "comment"),
    false,
  );
});

test("main files without a milestone when nothing dated is open", () => {
  const spawn = fakeSpawn({
    latest: { "@modelcontextprotocol/client": "2.1.0" },
    milestones: [{ title: "Backlog", state: "open", due_on: null }],
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  const create = spawn.calls.find(
    (c) => c.args[0] === "issue" && c.args[1] === "create",
  );
  assert.equal(create.args.includes("--milestone"), false);
});

test("main throws when npm view fails rather than reporting a clean sweep", () => {
  // The silent failure this guards: `npm view` prints nothing on error, so a
  // tolerated non-zero exit reads as "no newer version" for every package and a
  // registry outage becomes a green all-current night.
  const spawn = fakeSpawn({ npmStatus: 1 });
  assert.throws(
    () => main("o/r", spawn, { readFile: fakeReadFile() }),
    /npm view .* failed/,
  );
});

test("main throws when npm view returns something that is not a version", () => {
  const spawn = fakeSpawn({ npmStdout: "\n" });
  assert.throws(
    () => main("o/r", spawn, { readFile: fakeReadFile() }),
    /unusable version/,
  );
});

test("main propagates a failed issue creation", () => {
  const spawn = fakeSpawn({
    latest: { "@modelcontextprotocol/client": "2.1.0" },
    createStatus: 1,
  });
  assert.throws(
    () => main("o/r", spawn, { readFile: fakeReadFile() }),
    /gh issue create failed/,
  );
});

test("main refuses to run without a repository", () => {
  assert.throws(
    () => main(undefined, fakeSpawn(), { readFile: fakeReadFile() }),
    /GITHUB_REPOSITORY unset/,
  );
});

test("main fails on an SDK package the group table does not watch", () => {
  const readFile = (path) =>
    path === "package.json"
      ? JSON.stringify({
          dependencies: { "@modelcontextprotocol/something-new": "1.0.0" },
        })
      : JSON.stringify({ packages: {} });
  assert.throws(() => main("o/r", fakeSpawn(), { readFile }), /something-new/);
});
