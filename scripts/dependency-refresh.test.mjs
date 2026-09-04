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
  main,
  parseOutdated,
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
 */
function fakeSpawn({
  outdated = {},
  outdatedStatus,
  existing = [],
  milestone = "v2.6.0",
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
  assert.throws(() => main(undefined, fakeSpawn()), /GITHUB_REPOSITORY unset/);
});
