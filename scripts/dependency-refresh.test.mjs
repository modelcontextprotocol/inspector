// Tests for dependency-refresh.mjs (#2229) — both the pure parsing/formatting
// helpers and `main()`'s orchestration, the latter driven through the injected
// spawn function so no `npm` or `gh` process is ever started.
//
// `main()` is covered rather than left to `workflow_dispatch` because a
// production trigger is not a test (Copilot): the helper-only suite this
// replaced passed while a non-zero `npm outdated` exit reported a clean sweep.
// Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClearedBody,
  buildIssueBody,
  highestVersionTag,
  isActionStale,
  main,
  parseActionRefs,
  parseOutdated,
  parseVersionRef,
  staleActions,
  INSTALLS,
  ISSUE_MARKER,
} from "./dependency-refresh.mjs";

/**
 * A fake `spawnSync` that answers by command shape and records every call.
 *
 * @param {object} opts
 * @param {Record<string,unknown>} [opts.outdated] parsed `npm outdated` payload, per install dir
 * @param {number} [opts.outdatedStatus] exit status for every `npm outdated`
 * @param {Array<{number:number,body:string}>} [opts.existing] what `gh issue list` returns
 * @param {string|null} [opts.milestone] what the milestone lookup returns
 * @param {string[]} [opts.releaseTags] tags every action's release list returns
 * @param {number} [opts.releasesStatus] exit status for every release lookup
 * @param {string} [opts.releasesStderr] stderr for a failing release lookup
 */
function fakeSpawn({
  outdated = {},
  outdatedStatus,
  existing = [],
  milestone = "v2.6.0",
  releaseTags = [],
  releasesStatus,
  releasesStderr = "",
} = {}) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    if (cmd === "npm") {
      const payload = outdated[opts.cwd] ?? {};
      const found = Object.keys(payload).length > 0;
      return {
        // Real `npm outdated` exits 1 precisely when it found something.
        status: outdatedStatus ?? (found ? 1 : 0),
        stdout: found ? JSON.stringify(payload) : "",
        stderr: outdatedStatus ? "ENOTFOUND registry.npmjs.org" : "",
      };
    }
    if (args[0] === "issue" && args[1] === "list")
      return { status: 0, stdout: JSON.stringify(existing), stderr: "" };
    // MUST be tested before the milestone branch below: both are `gh api`,
    // so matching on args[0] alone hands the release lookup the milestone
    // string and the assertion silently checks nothing.
    if (args[0] === "api" && args.some((a) => a.includes("/releases")))
      return {
        status: releasesStatus ?? 0,
        stdout: releasesStatus ? "" : releaseTags.join("\n"),
        stderr: releasesStderr,
      };
    if (args[0] === "api")
      return {
        status: 0,
        stdout: milestone ? `${milestone}\n` : "",
        stderr: "",
      };
    if (args[0] === "issue" && args[1] === "create")
      return {
        status: 0,
        stdout: "https://github.com/o/r/issues/9\n",
        stderr: "",
      };
    if (args[0] === "issue" && args[1] === "edit")
      return { status: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
  };
  fn.calls = calls;
  return fn;
}

const ghCall = (spawn, verb) =>
  spawn.calls.find((c) => c.cmd === "gh" && c.args[1] === verb);

/** Silence main()'s progress logging; returns the captured lines. */
function captureLog(run) {
  const lines = [];
  const original = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    run();
  } finally {
    console.log = original;
  }
  return lines;
}

test("parseOutdated returns [] for empty npm-outdated output", () => {
  assert.deepEqual(parseOutdated(""), []);
  assert.deepEqual(parseOutdated("{}"), []);
});

test("parseOutdated normalizes and sorts entries by name", () => {
  const json = JSON.stringify({
    zod: { current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
    ajv: { current: "8.0.0", wanted: "8.0.0", latest: "8.1.0" },
  });
  assert.deepEqual(parseOutdated(json), [
    { name: "ajv", current: "8.0.0", wanted: "8.0.0", latest: "8.1.0" },
    { name: "zod", current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
  ]);
});

test("parseOutdated falls back when a field is missing", () => {
  const json = JSON.stringify({ pkg: { current: "1.0.0" } });
  assert.deepEqual(parseOutdated(json), [
    { name: "pkg", current: "1.0.0", wanted: "1.0.0", latest: "?" },
  ]);
});

test("parseActionRefs pulls owner/repo@ref out of a workflow, in file order", () => {
  const yaml = [
    "jobs:",
    "  build:",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      - name: Setup",
    "        uses: actions/setup-node@v7",
    '      - uses: "docker/login-action@v4"',
    "      - uses: docker/build-push-action@v7 # trailing comment",
  ].join("\n");
  assert.deepEqual(parseActionRefs(yaml), [
    { action: "actions/checkout", ref: "v7" },
    { action: "actions/setup-node", ref: "v7" },
    { action: "docker/login-action", ref: "v4" },
    { action: "docker/build-push-action", ref: "v7" },
  ]);
});

test("parseActionRefs skips local, container and unpinned steps", () => {
  const yaml = [
    "      - uses: ./.github/actions/local",
    "      - uses: docker://alpine:3.20",
    "      - uses: actions/checkout",
    "      - uses: github/codeql-action/init@v3",
  ].join("\n");
  assert.deepEqual(parseActionRefs(yaml), [
    { action: "github/codeql-action/init", ref: "v3" },
  ]);
});

test("parseVersionRef reads a numeric ref and rejects anything else", () => {
  assert.deepEqual(parseVersionRef("v7"), [7]);
  assert.deepEqual(parseVersionRef("7.0.1"), [7, 0, 1]);
  assert.equal(parseVersionRef("main"), null);
  assert.equal(
    parseVersionRef("8f4b7f84864484a7bf31766abe9204da3cbe65b3"),
    null,
  );
});

test("isActionStale compares only to the precision the ref specifies", () => {
  // `v7` is a moving major tag, so a v7.x release does not make it stale.
  assert.equal(isActionStale("v7", "v7.0.1"), false);
  assert.equal(isActionStale("v7", "v8.0.0"), true);
  // An exactly-pinned ref is behind its own patch release.
  assert.equal(isActionStale("v7.0.0", "v7.0.1"), true);
  assert.equal(isActionStale("v7.1", "v7.0.9"), false);
});

test("isActionStale reports nothing for a ref it cannot rank", () => {
  // A SHA pin is deliberately immovable; a tag comparison says nothing about it.
  assert.equal(
    isActionStale("8f4b7f84864484a7bf31766abe9204da3cbe65b3", "v5"),
    false,
  );
  assert.equal(isActionStale("main", "v5"), false);
  assert.equal(isActionStale("v5", "not-a-tag"), false);
});

test("highestVersionTag picks the greatest version, not the newest entry", () => {
  // GitHub's `releases/latest` is the DESIGNATED latest, not the greatest
  // version: a maintenance release cut for an older major after a newer one
  // would make a workflow on v7 read as current (Copilot).
  assert.equal(highestVersionTag(["v6.9.1", "v8.0.0", "v7.2.0"]), "v8.0.0");
  assert.equal(highestVersionTag(["v7", "v7.0.1"]), "v7.0.1");
  assert.equal(highestVersionTag(["v10.0.0", "v9.9.9"]), "v10.0.0");
});

test("highestVersionTag ignores tags it cannot parse", () => {
  assert.equal(highestVersionTag(["nightly", "v2.0.0", "latest"]), "v2.0.0");
  assert.equal(highestVersionTag(["nightly", "latest"]), null);
  assert.equal(highestVersionTag([]), null);
});

test("staleActions dedupes, drops actions with no known release and sorts", () => {
  const refs = [
    { action: "actions/checkout", ref: "v7" },
    { action: "actions/cache", ref: "v6" },
    { action: "actions/cache", ref: "v6" },
    { action: "some/unreleased", ref: "v1" },
  ];
  assert.deepEqual(
    staleActions(refs, {
      "actions/cache": "v7.0.0",
      "actions/checkout": "v7.0.1",
      "some/unreleased": null,
    }),
    [{ action: "actions/cache", current: "v6", latest: "v7.0.0" }],
  );
});

test("buildIssueBody returns null when every install is up to date", () => {
  assert.equal(
    buildIssueBody([
      { label: "root", packages: [] },
      { label: "clients/web", packages: [] },
    ]),
    null,
  );
});

test("buildIssueBody starts with the idempotency marker and skips empty installs", () => {
  const body = buildIssueBody([
    { label: "root", packages: [] },
    {
      label: "clients/web",
      packages: [
        { name: "zod", current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
      ],
    },
  ]);
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(body.includes("### `clients/web`"));
  assert.ok(!body.includes("### `root`"));
  assert.ok(body.includes("| `zod` | 3.0.0 | 3.1.0 | 4.0.0 |"));
});

test("buildClearedBody keeps the marker so the next sweep still finds the issue", () => {
  const body = buildClearedBody("2026-09-03");
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(body.includes("2026-09-03"));
  assert.ok(body.includes("Safe to close"));
});

test("main throws when npm outdated exits with an undocumented status", () => {
  // The regression that motivated covering main(): exit 2 used to fall through
  // to empty stdout and report a clean sweep across all five installs.
  const spawn = fakeSpawn({ outdatedStatus: 2 });
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /npm outdated failed in \.\s*\(exit 2\).*ENOTFOUND/s,
  );
  assert.equal(ghCall(spawn, "create"), undefined);
});

test("main sweeps every install and files one milestoned issue", () => {
  const spawn = fakeSpawn({
    outdated: {
      "clients/web": {
        zod: { current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
      },
    },
  });
  const log = captureLog(() => main("o/r", spawn));

  assert.deepEqual(
    spawn.calls.filter((c) => c.cmd === "npm").map((c) => c.cwd),
    INSTALLS.map((i) => i.dir),
  );
  const create = ghCall(spawn, "create");
  assert.ok(create, "expected an issue to be created");
  assert.deepEqual(create.args.slice(-2), ["--milestone", "v2.6.0"]);
  assert.ok(create.args[create.args.indexOf("--body") + 1].includes("`zod`"));
  assert.ok(log.some((l) => l.includes("filed")));
});

test("main edits the existing issue instead of filing a duplicate", () => {
  const spawn = fakeSpawn({
    outdated: {
      ".": { ajv: { current: "8.0.0", wanted: "8.1.0", latest: "8.1.0" } },
    },
    existing: [{ number: 77, body: `${ISSUE_MARKER}\nstale` }],
  });
  const log = captureLog(() => main("o/r", spawn));

  assert.equal(ghCall(spawn, "create"), undefined);
  const edit = ghCall(spawn, "edit");
  assert.equal(edit.args[2], "77");
  assert.ok(edit.args[edit.args.length - 1].includes("`ajv`"));
  assert.ok(log.some((l) => l.includes("updated existing #77")));
});

test("main clears a still-open issue once everything is current again", () => {
  const spawn = fakeSpawn({
    existing: [{ number: 77, body: `${ISSUE_MARKER}\n| \`zod\` | 3.0.0 |` }],
  });
  const log = captureLog(() => main("o/r", spawn));

  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "an open issue must be cleared, not left with a stale table");
  const body = edit.args[edit.args.length - 1];
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(!body.includes("`zod`"));
  assert.ok(log.some((l) => l.includes("cleared stale list on #77")));
});

test("main is a true no-op when nothing is outdated and no issue is open", () => {
  const spawn = fakeSpawn();
  const log = captureLog(() => main("o/r", spawn));

  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(log.some((l) => l.includes("no-op")));
});

test("main says Incoming, not Todo, when it files without a milestone", () => {
  const spawn = fakeSpawn({
    outdated: {
      ".": { ajv: { current: "8.0.0", wanted: "8.1.0", latest: "8.1.0" } },
    },
    milestone: null,
  });
  const log = captureLog(() => main("o/r", spawn));

  const create = ghCall(spawn, "create");
  assert.ok(!create.args.includes("--milestone"));
  // Unmilestoned is unapproved; triage parks it in Incoming.
  assert.ok(log.some((l) => l.includes("Incoming")));
  assert.ok(!log.some((l) => l.includes("Todo")));
});

test("main refuses to run without a repo", () => {
  // `main`'s default reads process.env.GITHUB_REPOSITORY, which GitHub Actions
  // sets on every run — so this has to clear the variable rather than assume
  // the ambient environment lacks it. Relying on the ambient value passed
  // locally and failed in CI, which is the one place the default is always
  // populated.
  const saved = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REPOSITORY;
  try {
    assert.throws(
      () => main(undefined, fakeSpawn()),
      /GITHUB_REPOSITORY unset/,
    );
  } finally {
    if (saved !== undefined) process.env.GITHUB_REPOSITORY = saved;
  }
});

test("main falls back to GITHUB_REPOSITORY when no repo is passed", () => {
  // The other half of the default: with the variable set, `main(undefined, …)`
  // must use it rather than throw. Together the two tests pin the default's
  // behavior in both environments instead of inheriting whichever one happens
  // to be running.
  const saved = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = "env/repo";
  try {
    const spawn = fakeSpawn({
      outdated: {
        ".": { ajv: { current: "8.0.0", wanted: "8.1.0", latest: "8.1.0" } },
      },
    });
    captureLog(() => main(undefined, spawn));
    const create = ghCall(spawn, "create");
    assert.equal(create.args[create.args.indexOf("--repo") + 1], "env/repo");
  } finally {
    if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = saved;
  }
});

test("buildIssueBody renders a GitHub Actions section after the npm ones", () => {
  const body = buildIssueBody(
    [{ label: "root", packages: [] }],
    [{ action: "actions/cache", current: "v6", latest: "v7.0.0" }],
  );
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(body.includes("### GitHub Actions"));
  assert.ok(body.includes("| `actions/cache` | v6 | v7.0.0 |"));
  assert.ok(!body.includes("### `root`"));
});

test("buildIssueBody returns null only when npm and actions are both clean", () => {
  assert.equal(buildIssueBody([{ label: "root", packages: [] }], []), null);
  assert.notEqual(
    buildIssueBody(
      [],
      [{ action: "actions/cache", current: "v6", latest: "v7.0.0" }],
    ),
    null,
  );
});

test("buildClearedBody speaks for both halves of the sweep", () => {
  const body = buildClearedBody("2026-09-04");
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(body.includes("2026-09-04"));
  // npm-only wording here would assert an all-clear the sweep never checked.
  assert.match(body, /npm package/);
  assert.match(body, /uses:/);
  // Must not claim every ref was verified: SHA- and branch-pinned refs are
  // never ranked against a release (Copilot).
  assert.match(body, /SHA or a branch/);
});

test("main fails the sweep when a release lookup errors, rather than reporting no stale actions", () => {
  // The silent-success shape one level down: a 403 read as "no release" is
  // indistinguishable from "not stale", and every action here is already on
  // its latest major, so the empty section would look like a healthy run.
  const spawn = fakeSpawn({
    releasesStatus: 1,
    releasesStderr: "gh: API rate limit exceeded (HTTP 403)",
  });
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /release lookup for .* failed/,
  );
});

test("main fails on a 404 release lookup — a missing action repo is not 'no releases'", () => {
  // The release LIST endpoint answers "no releases" with a successful empty
  // array, so a 404 means the repository is missing or inaccessible. Treating
  // it as benign would silently drop a broken or renamed action from the sweep
  // that replaced Dependabot (Copilot).
  const spawn = fakeSpawn({
    releasesStatus: 1,
    releasesStderr: "gh: Not Found (HTTP 404)",
  });
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /release lookup for .* failed/,
  );
});

test("main treats an empty release list as 'this action cuts no releases'", () => {
  // The benign case: status 0 with no tags. The action is simply not ranked.
  const spawn = fakeSpawn({ releaseTags: [] });
  const log = captureLog(() => main("o/r", spawn));
  assert.match(log.join("\n"), /no-op/);
});

test("main asks for release lists, not the designated latest release", () => {
  const spawn = fakeSpawn();
  captureLog(() => main("o/r", spawn));
  const lookups = spawn.calls.filter(
    (c) =>
      c.cmd === "gh" &&
      c.args[0] === "api" &&
      c.args.some((a) => a.includes("/releases")),
  );
  assert.ok(lookups.length > 0, "expected at least one release lookup");
  for (const call of lookups) {
    // `releases/latest` is GitHub's designated latest, not the greatest
    // version — ranking must come from the list.
    assert.ok(!call.args.some((a) => /releases\/latest/.test(a)));
    assert.ok(call.args.some((a) => /\/releases\?/.test(a)));
    // And every page of it: the list is ordered by release DATE, so a genuine
    // maximum can sit past page 1 behind newer maintenance releases on lower
    // majors. Ranking one page would report a lower major as highest.
    assert.ok(
      call.args.includes("--paginate"),
      "release lookup must paginate, or the highest version can be missed",
    );
  }
});
