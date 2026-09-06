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
import YAML from "yaml";
import {
  ANALYSIS_MARKER,
  assertEveryPackageWatched,
  buildIssueBody,
  buildIssueTitle,
  buildMarker,
  buildSupersededComment,
  formatFiledOutput,
  groupState,
  hasAnalysis,
  installedVersion,
  isSweepAuthored,
  main,
  parseMarker,
  parseSupersededMarker,
  pickMilestone,
  SDK_GROUPS,
  SWEEP_LABELS,
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

/**
 * A whole group at one published version — a COMPLETED lockstep release.
 *
 * Bumping a single package's `latest` instead models a publication still in
 * flight, which is a different case with a different expected answer, so the
 * two have separate helpers rather than one that silently means whichever the
 * reader assumed.
 */
function groupAt(group, installed, latest) {
  return Object.fromEntries(
    group.packages.map((p) => [p, { declared: installed, installed, latest }]),
  );
}

/** The same, as the `latest` map `fakeSpawn` answers `npm view` from. */
function latestAt(group, latest) {
  return Object.fromEntries(group.packages.map((p) => [p, latest]));
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

/** A comment as `issueComments` returns it. */
const botComment = (body) => ({
  author: "github-actions[bot]",
  isBot: true,
  body,
});
const humanComment = (body) => ({ author: "someone", isBot: false, body });

test("hasAnalysis finds the marker only at the start of a comment", () => {
  assert.equal(
    hasAnalysis([botComment(`${ANALYSIS_MARKER}\nthe write-up`)]),
    true,
  );
  assert.equal(
    hasAnalysis([botComment("a comment"), botComment("another")]),
    false,
  );
  assert.equal(hasAnalysis([]), false);
  // A comment merely QUOTING the marker must not count as an analysis, or one
  // person pasting it would suppress the retry forever.
  assert.equal(
    hasAnalysis([botComment(`see \`${ANALYSIS_MARKER}\` in the script`)]),
    false,
  );
});

test("hasAnalysis ignores the marker when anyone but the automation wrote it", () => {
  // ⚠️ This repo is PUBLIC. Trusting the marker alone would let any commenter
  // suppress analysis retries on any issue, forever, with one comment (Copilot).
  assert.equal(
    hasAnalysis([humanComment(`${ANALYSIS_MARKER}\nnothing to see here`)]),
    false,
  );
  // A bot is not enough either — it has to be OUR bot.
  assert.equal(
    hasAnalysis([
      { author: "dependabot[bot]", isBot: true, body: ANALYSIS_MARKER },
    ]),
    false,
  );
});

test("isSweepAuthored requires both the automation author and the sweep's labels", () => {
  const owned = {
    author: { login: "github-actions", is_bot: true },
    labels: SWEEP_LABELS.map((name) => ({ name })),
  };
  assert.equal(isSweepAuthored(owned), true);
  // gh reports a bot with the suffix stripped; the REST API keeps it. Both spellings.
  assert.equal(
    isSweepAuthored({ ...owned, author: { login: "github-actions[bot]" } }),
    true,
  );
  // An outsider's issue carrying a forged marker: right shape, wrong provenance.
  assert.equal(
    isSweepAuthored({ ...owned, author: { login: "someone", is_bot: false } }),
    false,
  );
  // A human account named to look official is still a human account.
  assert.equal(
    isSweepAuthored({
      ...owned,
      author: { login: "github-actions", is_bot: false },
    }),
    false,
  );
  // Right author, but missing a label only someone with write access can set.
  assert.equal(
    isSweepAuthored({ ...owned, labels: [{ name: "chore" }] }),
    false,
  );
  assert.equal(isSweepAuthored({ ...owned, labels: [] }), false);
  assert.equal(isSweepAuthored({}), false);
});

test("the job the model runs in holds no write permission", () => {
  // ⚠️ GitHub scopes permissions per JOB, not per step. While the model action
  // and the `gh issue comment` shared a job, the `issues: write` the posting
  // needed was on the token handed to the model — however carefully the step was
  // written (Copilot). The separation is the control; this test is what keeps a
  // later edit from quietly undoing it by merging the jobs or widening a scope.
  const workflow = YAML.parse(
    readFileSync(
      new URL("../.github/workflows/sdk-watch.yml", import.meta.url),
      "utf8",
    ),
  );
  const analyze = workflow.jobs.analyze;
  const runsModel = (analyze.steps ?? []).some((s) =>
    String(s.uses ?? "").startsWith("anthropics/claude-code-action"),
  );
  assert.ok(runsModel, "the analyze job is the one that runs the model");
  assert.deepEqual(
    analyze.permissions,
    { contents: "read" },
    "the model's job must hold contents: read and nothing else",
  );
  assert.equal(
    (analyze.steps ?? []).some((s) => /gh issue comment/.test(s.run ?? "")),
    false,
    "posting belongs in the separately-permissioned job",
  );
});

test("the model is granted no command that can reach an arbitrary host", () => {
  // `npm view` accepts `--registry=<URL>` and a Bash grant matches only a
  // PREFIX, so granting it was an outbound channel no output scan can see
  // (Copilot). The general rule — check a command's flag surface before granting
  // it — is in AGENTS.md; this pins the specific instance.
  const workflow = YAML.parse(
    readFileSync(
      new URL("../.github/workflows/sdk-watch.yml", import.meta.url),
      "utf8",
    ),
  );
  const args = workflow.jobs.analyze.steps.find((s) =>
    String(s.uses ?? "").startsWith("anthropics/claude-code-action"),
  ).with.claude_args;
  const allowed = /--allowedTools\s+"([^"]*)"/.exec(args)?.[1] ?? "";
  assert.ok(allowed.length > 0, "expected an --allowedTools whitelist");
  for (const forbidden of ["npm", "curl", "wget", "WebFetch", "WebSearch"]) {
    assert.equal(
      allowed.includes(forbidden),
      false,
      `--allowedTools must not grant ${forbidden}`,
    );
  }
});

test("the workflow posts the exact marker the sweep looks for", () => {
  // ⚠️ The marker is duplicated across the script and the workflow because the
  // posting step is shell, not JS. If the two ever drift, every issue reads as
  // permanently unanalyzed and the sweep re-queues it every single night — a
  // failure that is invisible in both files read separately. This is the guard.
  const workflow = readFileSync(
    new URL("../.github/workflows/sdk-watch.yml", import.meta.url),
    "utf8",
  );
  assert.ok(
    workflow.includes(ANALYSIS_MARKER),
    `.github/workflows/sdk-watch.yml must post ${ANALYSIS_MARKER}`,
  );
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

test("groupState reports the group behind after a completed lockstep release", () => {
  const state = groupState(SDK, groupAt(SDK, "2.0.0", "2.1.0"));
  assert.equal(state.target, "2.1.0");
  assert.equal(state.rows.filter((r) => r.behind).length, SDK.packages.length);
  assert.equal(state.rows.length, SDK.packages.length);
});

/** A lockstep group mid-publish: `client` is live at `ahead`, the rest at `behind`. */
function partialPublish(installed, behind, ahead) {
  const versions = {};
  for (const pkg of SDK.packages) {
    versions[pkg] = { declared: installed, installed, latest: behind };
  }
  versions["@modelcontextprotocol/client"] = {
    declared: installed,
    installed,
    latest: ahead,
  };
  return groupState(SDK, versions);
}

test("groupState targets the version the WHOLE group has reached, not the highest", () => {
  // npm publishes a lockstep release one package at a time. Targeting the
  // highest would tell maintainers to move all four to a version three of them
  // do not have.
  assert.equal(partialPublish("2.0.0", "2.1.0", "2.2.0").target, "2.1.0");
});

test("groupState still files an actionable target during a partial publication", () => {
  // Skipping a disagreeing group instead would leave us silent on a release we
  // are genuinely behind: on 2.0.0, 2.1.0 is real, published and worth filing.
  const state = partialPublish("2.0.0", "2.1.0", "2.2.0");
  assert.equal(
    state.rows.every((r) => r.behind),
    true,
  );
});

test("groupState waits when only the in-flight half of a publication is ahead", () => {
  // Already on 2.1.0 with `client` alone at 2.2.0: nothing the whole group has
  // is newer than what we run, so there is nothing to file yet.
  assert.equal(partialPublish("2.1.0", "2.1.0", "2.2.0"), null);
});

test("groupState does not let a partial-publish marker suppress the real filing", () => {
  // The failure this prevents: targeting 2.2.0 mid-publish writes a
  // `target=2.2.0` marker, and the completed publication then matches it and is
  // never tracked. Taking the minimum means the two runs produce DIFFERENT
  // targets, so the completed release gets its own issue.
  const midFlight = partialPublish("2.0.0", "2.1.0", "2.2.0");
  const completed = groupState(
    SDK,
    currentVersions(
      Object.fromEntries(
        SDK.packages.map((p) => [
          p,
          { declared: "2.0.0", installed: "2.0.0", latest: "2.2.0" },
        ]),
      ),
    ),
  );
  assert.equal(midFlight.target, "2.1.0");
  assert.equal(completed.target, "2.2.0");
  assert.notEqual(
    buildMarker(SDK, midFlight.target),
    buildMarker(SDK, completed.target),
  );
});

test("buildIssueBody explains a target below a Latest the table shows", () => {
  const body = buildIssueBody(partialPublish("2.0.0", "2.1.0", "2.2.0"));
  assert.ok(body.includes("publication still in flight"));
  // ...and says nothing of the sort when every package agrees.
  assert.equal(
    buildIssueBody(behindState()).includes("publication still in flight"),
    false,
  );
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
  return groupState(group, groupAt(group, "2.0.0", target));
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
  assert.equal(
    (body.match(/\*\*yes\*\*/g) ?? []).length,
    SDK.packages.length,
    "a completed lockstep release leaves every package in the group behind",
  );
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
  commentsByIssue = {},
  createStatus = 0,
  createFailFor = null,
  commentStatus = 0,
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
    if (args[0] === "issue" && args[1] === "list") {
      // Default every fixture to the sweep's OWN authorship and labels, so a
      // test that says nothing about provenance is testing the ordinary case.
      // A test probing the trust boundary overrides `author` or `labels`.
      const owned = issues.map((i) => ({
        author: { login: "github-actions", is_bot: true },
        labels: SWEEP_LABELS.map((name) => ({ name })),
        ...i,
      }));
      return { status: 0, stdout: JSON.stringify(owned), stderr: "" };
    }
    if (args[0] === "issue" && args[1] === "create") {
      const title = args[args.indexOf("--title") + 1] ?? "";
      const fails =
        createStatus || (createFailFor && title.includes(createFailFor));
      return {
        status: fails ? 1 : 0,
        stdout: fails
          ? ""
          : `https://github.com/o/r/issues/${issueCounter++}\n`,
        stderr: fails ? "could not create issue" : "",
      };
    }
    if (args[0] === "issue" && args[1] === "comment")
      return {
        status: commentStatus,
        stdout: "",
        stderr: commentStatus ? "comment rejected" : "",
      };
    // MUST be tested before the milestone branch: both are `gh api`, so
    // matching on args[0] alone would hand the comment lookup the milestone
    // payload and the assertion would silently check nothing.
    if (
      args[0] === "api" &&
      args.some((a) => String(a).includes("/comments"))
    ) {
      // Answer PER ISSUE. A single shared list would make "the target issue has
      // an analysis" and "the stale issue has a supersession note" the same
      // fact, so a test could pass on the wrong one entirely.
      const path = args.find((a) => String(a).includes("/comments")) ?? "";
      const number = Number(/issues\/(\d+)\/comments/.exec(path)?.[1]);
      const bodies = commentsByIssue[number] ?? comments;
      // Shaped as `--paginate --slurp` really answers: an array of PAGES, each
      // an array of comment objects. Faking it as newline-joined text was what
      // let the boundary-destroying `--jq '.[].body'` split look correct.
      //
      // A plain string means "written by this automation"; an object lets a test
      // put a marker in someone else's mouth, which is the forgery case.
      const page = bodies.map((c) =>
        typeof c === "string"
          ? { user: { login: "github-actions[bot]", type: "Bot" }, body: c }
          : { user: { login: c.author, type: c.type ?? "User" }, body: c.body },
      );
      return { status: 0, stdout: JSON.stringify([page]), stderr: "" };
    }
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

/**
 * Options for a case that asserts a throw, with the emit target pinned off.
 *
 * `main`'s `output` defaults to `process.env.GITHUB_OUTPUT`, which is a REAL
 * FILE on an Actions runner — the one the job's own outputs are read from. A
 * case that writes there is not just untidy: it would append `filed=…` to the
 * live job output and hand the analysis job a fabricated issue list.
 *
 * ⚠️ **`output: undefined` does NOT prevent that**, which is the same trap as
 * the `GITHUB_REPOSITORY` one below wearing a different hat: a destructuring
 * default fires on `undefined`, so passing it explicitly selects the default
 * rather than overriding it. This leaked a real `filed=[]` into a probe file
 * once the emit moved into a `finally` and the throwing cases started reaching
 * it. `null` is the value that suppresses a default *and* fails `if (output)`.
 */
function noAmbientOutput(readFile = fakeReadFile()) {
  return { readFile, output: null };
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
    latest: latestAt(SDK, "2.1.0"),
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
    latest: { ...latestAt(SDK, "2.1.0"), ...latestAt(EXT, "1.8.0") },
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

/** An open issue this sweep already filed for `target`. */
function existingIssue(number, target, group = SDK) {
  return {
    number,
    state: "OPEN",
    body: `${buildMarker(group, target)}\nexisting`,
  };
}

test("main does not refile an issue that already exists and was analyzed", () => {
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
    issues: [existingIssue(400, "2.1.0")],
    commentsByIssue: { 400: [`${ANALYSIS_MARKER}\nthe analysis`] },
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
    "an already-analyzed target must not reach the analysis job again",
  );
});

test("main re-queues an existing issue that has no analysis comment", () => {
  // ⚠️ "an issue exists" and "the issue was analyzed" are different claims, and
  // equating them meant a failed or timed-out `analyze` job was never retried:
  // the next sweep saw the marker, emitted `[]`, and reported a green no-op over
  // an issue nothing would ever revisit (Copilot).
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
    issues: [existingIssue(400, "2.1.0")],
    commentsByIssue: { 400: ["just a maintainer chiming in"] },
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  assert.equal(
    spawn.calls.some((c) => c.args[0] === "issue" && c.args[1] === "create"),
    false,
    "re-queuing must adopt the existing issue, never file a second one",
  );
  assert.deepEqual(
    readFiled(output).map((f) => f.issue),
    [400],
    "the un-analyzed issue must reach the analysis job again",
  );
});

test("main retries a supersession note that failed to post on an earlier run", () => {
  // The unrecoverable case: creation succeeded, the note did not, and the retry
  // matched the target's own marker and skipped reconciliation entirely — so the
  // documented note was never posted at all (Copilot).
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.2.0"),
    issues: [existingIssue(500, "2.2.0"), existingIssue(400, "2.1.0")],
    commentsByIssue: { 500: [`${ANALYSIS_MARKER}\ndone`], 400: [] },
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  const posted = spawn.calls.find(
    (c) => c.args[0] === "issue" && c.args[1] === "comment",
  );
  assert.ok(posted, "the missing supersession note must be posted on retry");
  assert.equal(posted.args[2], "400");
  assert.ok(posted.args[posted.args.indexOf("--body") + 1].includes("#500"));
});

test("main keeps a multi-line comment whole rather than splitting it into lines", () => {
  // ⚠️ The comment lookup used to be `--jq '.[].body'` split on newlines, so
  // every LINE of every comment became its own entry. Both marker checks are
  // `startsWith`, so a maintainer quoting the analysis marker at the start of
  // any line would have convinced the sweep this issue was analyzed — forever,
  // since nothing would ever re-queue it (Copilot).
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
    issues: [existingIssue(400, "2.1.0")],
    commentsByIssue: {
      400: [
        `A maintainer writes:\n${ANALYSIS_MARKER}\nis the marker the sweep looks for.`,
      ],
    },
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  assert.deepEqual(
    readFiled(output).map((f) => f.issue),
    [400],
    "a quoted marker on a later line must not pass as the sweep's own comment",
  );
});

test("main does not re-queue a CLOSED issue that has no analysis", () => {
  // Closing the issue was a decision. `sweepIssues` reads `--state all` so that
  // decision keeps suppressing the target — but the closed issue naturally has
  // no analysis marker, so re-queuing on the marker alone would have handed it
  // to the analyze job and posted a fresh comment every night, re-arguing the
  // decision the `--state all` read exists to respect (Copilot).
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
    issues: [{ ...existingIssue(400, "2.1.0"), state: "CLOSED" }],
    commentsByIssue: { 400: [] },
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  assert.deepEqual(readFiled(output), []);
  assert.equal(
    spawn.calls.some((c) => c.args[0] === "issue" && c.args[1] === "create"),
    false,
    "and it must still suppress creation",
  );
});

test("main ignores an outsider's issue carrying the current target's marker", () => {
  // ⚠️ The suppression attack: this repo is public, so anyone can open an issue
  // whose body starts with the current marker — and close it — to stop the real
  // upgrade issue from ever being filed (Copilot).
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
    issues: [
      {
        ...existingIssue(400, "2.1.0"),
        author: { login: "a-passer-by", is_bot: false },
      },
    ],
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  assert.ok(
    spawn.calls.some((c) => c.args[0] === "issue" && c.args[1] === "create"),
    "the forged issue must not suppress the genuine filing",
  );
  assert.deepEqual(
    readFiled(output).map((f) => f.to),
    ["2.1.0"],
  );
});

test("main ignores an issue that lacks the labels only write access can set", () => {
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
    issues: [{ ...existingIssue(400, "2.1.0"), labels: [{ name: "v2" }] }],
  });
  main("o/r", spawn, noAmbientOutput());

  assert.ok(
    spawn.calls.some((c) => c.args[0] === "issue" && c.args[1] === "create"),
  );
});

test("main ignores a marker whose target is not a valid version", () => {
  // `semver.lt` throws on an unparseable version, so an issue titled with a
  // malformed target would have failed the sweep every single run.
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
    issues: [
      {
        number: 400,
        state: "OPEN",
        body: `<!-- sdk-watch: group=typescript-sdk; target=not-a-version -->\n`,
      },
    ],
  });
  const output = outputFile();
  writeFileSync(output, "");

  assert.doesNotThrow(() =>
    main("o/r", spawn, { readFile: fakeReadFile(), output }),
  );
  assert.deepEqual(
    readFiled(output).map((f) => f.to),
    ["2.1.0"],
  );
});

test("main re-queues despite a forged analysis comment from a non-automation author", () => {
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
    issues: [existingIssue(400, "2.1.0")],
    commentsByIssue: {
      400: [{ author: "a-passer-by", body: `${ANALYSIS_MARKER}\nnope` }],
    },
  });
  const output = outputFile();
  writeFileSync(output, "");

  main("o/r", spawn, { readFile: fakeReadFile(), output });

  assert.deepEqual(
    readFiled(output).map((f) => f.issue),
    [400],
    "a forged marker must not suppress the analysis retry",
  );
});

test("main posts the supersession note despite a forged one from an outsider", () => {
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.2.0"),
    issues: [existingIssue(400, "2.1.0")],
    commentsByIssue: {
      400: [
        {
          author: "a-passer-by",
          body: `<!-- sdk-watch:superseded-by 500 -->\nforged`,
        },
      ],
    },
  });
  main("o/r", spawn, noAmbientOutput());

  assert.ok(
    spawn.calls.some((c) => c.args[0] === "issue" && c.args[1] === "comment"),
    "a forged note must not suppress the genuine one",
  );
});

test("main does not treat the target issue as superseding itself", () => {
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
    issues: [existingIssue(400, "2.1.0")],
    commentsByIssue: { 400: [`${ANALYSIS_MARKER}\ndone`] },
  });
  main("o/r", spawn, noAmbientOutput());

  assert.equal(
    spawn.calls.some((c) => c.args[0] === "issue" && c.args[1] === "comment"),
    false,
  );
});

test("main respects a CLOSED issue for the same target and does not refile nightly", () => {
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
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
    latest: latestAt(SDK, "2.2.0"),
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
    latest: latestAt(SDK, "2.2.0"),
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
    latest: latestAt(SDK, "2.2.0"),
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
    latest: latestAt(SDK, "2.1.0"),
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
    () => main("o/r", spawn, noAmbientOutput()),
    /npm view .* failed/,
  );
});

test("main throws when npm view returns something that is not a version", () => {
  const spawn = fakeSpawn({ npmStdout: "\n" });
  assert.throws(
    () => main("o/r", spawn, noAmbientOutput()),
    /unusable version/,
  );
});

test("main still emits an issue it created when a later step fails", () => {
  // ⚠️ The permanent-loss case: creating an issue is irreversible, so a
  // supersession comment failing afterwards must not swallow the record. If it
  // did, the next night's retry would match this issue's own marker, emit `[]`,
  // and the issue would sit there forever with no analysis (Copilot).
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.2.0"),
    issues: [
      {
        number: 400,
        state: "OPEN",
        body: `${buildMarker(SDK, "2.1.0")}\nolder`,
      },
    ],
    commentStatus: 1,
  });
  const output = outputFile();
  writeFileSync(output, "");

  assert.throws(
    () => main("o/r", spawn, { readFile: fakeReadFile(), output }),
    /group\(s\) failed/,
    "the run must still go red so the failure is visible",
  );

  assert.deepEqual(
    readFiled(output).map((f) => f.issue),
    [500],
    "the created issue must still reach the analysis job",
  );
});

test("main isolates one group's failure from another group's issue", () => {
  const spawn = fakeSpawn({
    latest: {
      "@modelcontextprotocol/client": "2.1.0",
      "@modelcontextprotocol/core": "2.1.0",
      "@modelcontextprotocol/server": "2.1.0",
      "@modelcontextprotocol/server-legacy": "2.1.0",
      "@modelcontextprotocol/ext-apps": "1.8.0",
    },
    createFailFor: "TypeScript SDK",
  });
  const output = outputFile();
  writeFileSync(output, "");

  assert.throws(
    () =>
      main("o/r", spawn, {
        readFile: fakeReadFile({
          declared: { "@modelcontextprotocol/ext-apps": "^1.7.4" },
          installed: { "@modelcontextprotocol/ext-apps": "1.7.5" },
        }),
        output,
      }),
    /MCP TypeScript SDK/,
  );

  assert.deepEqual(
    readFiled(output).map((f) => f.label),
    ["MCP Apps extension SDK"],
    "the second group must still be filed and analyzed",
  );
});

test("main propagates a failed issue creation", () => {
  const spawn = fakeSpawn({
    latest: latestAt(SDK, "2.1.0"),
    createStatus: 1,
  });
  assert.throws(
    () => main("o/r", spawn, noAmbientOutput()),
    /gh issue create failed/,
  );
});

test("main refuses to run without a repository", () => {
  // ⚠️ `repo` defaults to `process.env.GITHUB_REPOSITORY`, which is UNSET on a
  // developer machine and SET on every Actions runner. So passing `undefined`
  // exercises that default, and this assertion held locally while going red the
  // first time CI ran it. Clear the variable so both environments test the same
  // thing — `npm run local:gate` is a superset of CI's STAGES, but not of its
  // ambient environment.
  const saved = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REPOSITORY;
  try {
    assert.throws(
      () => main(undefined, fakeSpawn(), noAmbientOutput()),
      /GITHUB_REPOSITORY unset/,
    );
  } finally {
    if (saved !== undefined) process.env.GITHUB_REPOSITORY = saved;
  }
});

test("main fails on an SDK package the group table does not watch", () => {
  const readFile = (path) =>
    path === "package.json"
      ? JSON.stringify({
          dependencies: { "@modelcontextprotocol/something-new": "1.0.0" },
        })
      : JSON.stringify({ packages: {} });
  assert.throws(
    () => main("o/r", fakeSpawn(), noAmbientOutput(readFile)),
    /something-new/,
  );
});
