// Tests for dependabot-alerts.mjs (#2233) — both the pure grouping/formatting
// helpers and `main()`'s orchestration, the latter driven through the injected
// spawn function so no `gh` process is ever started.
//
// `main()` is covered rather than left to `workflow_dispatch` because a
// production trigger is not a test (Copilot): everything that can go wrong in
// the orchestration — a paginated alert feed, a manifest that has moved on, a
// half-written board card, a comment posted twice — goes wrong only against the
// real API, where nothing would be asserted.
// Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCommentMarker,
  lockfileEntries,
  remediation,
  buildIssueBody,
  buildIssueTitle,
  buildMarker,
  buildNewAdvisoryComment,
  groupAlerts,
  isDirectDependency,
  isPermissionDenied,
  lockfileVersions,
  main,
  mergeGhsas,
  parseCommentMarker,
  parseMarker,
  toSemverRange,
} from "./dependabot-alerts.mjs";

/** Shaped like a real `GET /repos/{o}/{r}/dependabot/alerts` entry. */
function alert({
  ghsa,
  pkg = "fast-uri",
  manifest = "package-lock.json",
  fixed = "3.1.6",
  severity = "high",
  range = ">= 3.0.0, < 3.1.6",
  scope = "runtime",
  cve = null,
  state = "open",
}) {
  return {
    state,
    html_url: `https://github.com/o/r/security/dependabot/${ghsa}`,
    dependency: {
      package: { name: pkg },
      manifest_path: manifest,
      scope,
    },
    security_advisory: {
      ghsa_id: ghsa,
      cve_id: cve,
      severity,
      summary: `${pkg} is bad`,
    },
    security_vulnerability: {
      vulnerable_version_range: range,
      first_patched_version: { identifier: fixed },
    },
  };
}

test("toSemverRange turns GitHub's comma-separated conjuncts into semver ANDs", () => {
  assert.equal(toSemverRange(">= 3.1.3, < 3.1.6"), ">= 3.1.3 < 3.1.6");
  assert.equal(toSemverRange("<= 4.28.6"), "<= 4.28.6");
  assert.equal(toSemverRange(">= 2.2.5, < 6.16.0"), ">= 2.2.5 < 6.16.0");
});

test("toSemverRange tolerates stray whitespace and trailing commas", () => {
  assert.equal(toSemverRange("  >= 1.0.0 ,  < 2.0.0 , "), ">= 1.0.0 < 2.0.0");
});

test("lockfileVersions finds hoisted and nested copies, deduped and sorted", () => {
  const lock = {
    packages: {
      "": { dependencies: { zod: "^3.0.0" } },
      "node_modules/fast-uri": { version: "3.1.5" },
      "node_modules/ajv/node_modules/fast-uri": { version: "3.0.1" },
      "node_modules/other/node_modules/fast-uri": { version: "3.1.5" },
      "node_modules/fast-uri-lookalike": { version: "9.9.9" },
    },
  };
  assert.deepEqual(lockfileVersions(lock, "fast-uri"), ["3.0.1", "3.1.5"]);
});

test("lockfileVersions returns [] when the package is absent", () => {
  assert.deepEqual(lockfileVersions({ packages: {} }, "qs"), []);
  assert.deepEqual(lockfileVersions({}, "qs"), []);
});

test("isDirectDependency reads the root manifest entry, not the tree", () => {
  const lock = {
    packages: {
      "": { dependencies: { zod: "^4.0.0" }, devDependencies: { vitest: "1" } },
      "node_modules/fast-uri": { version: "3.1.5" },
    },
  };
  assert.equal(isDirectDependency(lock, "zod"), true);
  assert.equal(isDirectDependency(lock, "vitest"), true);
  assert.equal(isDirectDependency(lock, "fast-uri"), false);
});

test("groupAlerts collapses advisories into one entry per bump", () => {
  const grouped = groupAlerts([
    alert({ ghsa: "GHSA-5jgf", range: ">= 3.1.3, < 3.1.6" }),
    alert({ ghsa: "GHSA-f65p" }),
    alert({ ghsa: "GHSA-jqff" }),
    alert({ ghsa: "GHSA-fph4", range: ">= 3.1.2, < 3.1.6" }),
    alert({
      ghsa: "GHSA-x5fp",
      pkg: "qs",
      fixed: "6.16.0",
      severity: "medium",
      range: ">= 6.14.2, <= 6.15.3",
    }),
    alert({
      ghsa: "GHSA-73wf",
      pkg: "browserslist",
      manifest: "clients/tui/package-lock.json",
      fixed: "4.28.7",
      scope: "development",
      range: "<= 4.28.6",
    }),
  ]);

  assert.deepEqual(
    grouped.map((g) => [g.package, g.manifestPath, g.fixedIn, g.ghsas.length]),
    [
      ["browserslist", "clients/tui/package-lock.json", "4.28.7", 1],
      ["fast-uri", "package-lock.json", "3.1.6", 4],
      ["qs", "package-lock.json", "6.16.0", 1],
    ],
  );
  // GHSAs are sorted within a group so the marker is stable across runs.
  assert.deepEqual(grouped[1].ghsas, [
    "GHSA-5jgf",
    "GHSA-f65p",
    "GHSA-fph4",
    "GHSA-jqff",
  ]);
});

test("groupAlerts keeps the highest severity across a group", () => {
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-a", severity: "low" }),
    alert({ ghsa: "GHSA-b", severity: "critical" }),
    alert({ ghsa: "GHSA-c", severity: "medium" }),
  ]);
  assert.equal(group.severity, "critical");
});

test("groupAlerts splits a package whose advisories need different bumps", () => {
  const grouped = groupAlerts([
    alert({ ghsa: "GHSA-a", fixed: "3.1.6" }),
    alert({ ghsa: "GHSA-b", fixed: "4.0.0" }),
  ]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(
    grouped.map((g) => g.fixedIn),
    ["3.1.6", "4.0.0"],
  );
});

test("groupAlerts drops closed alerts and ones with no patched version", () => {
  const unpatched = alert({ ghsa: "GHSA-x" });
  unpatched.security_vulnerability.first_patched_version = null;
  assert.deepEqual(
    groupAlerts([alert({ ghsa: "GHSA-y", state: "fixed" }), unpatched]),
    [],
  );
});

test("buildMarker and parseMarker round-trip, sorting the GHSA list", () => {
  const marker = buildMarker({
    package: "fast-uri",
    manifestPath: "package-lock.json",
    fixedIn: "3.1.6",
    ghsas: ["GHSA-b", "GHSA-a"],
  });
  assert.equal(
    marker,
    "<!-- dependabot-alerts: pkg=fast-uri; manifest=package-lock.json; fixed=3.1.6; ghsas=GHSA-a,GHSA-b -->",
  );
  assert.deepEqual(parseMarker(`${marker}\nbody text`), {
    package: "fast-uri",
    manifestPath: "package-lock.json",
    fixedIn: "3.1.6",
    ghsas: ["GHSA-a", "GHSA-b"],
  });
});

test("the marker carries fixedIn, so two bumps of one package stay distinct", () => {
  const [a] = groupAlerts([alert({ ghsa: "GHSA-a", fixed: "3.1.6" })]);
  const [b] = groupAlerts([alert({ ghsa: "GHSA-b", fixed: "4.0.0" })]);
  assert.notEqual(buildMarker(a), buildMarker(b));
  assert.equal(parseMarker(buildMarker(a)).fixedIn, "3.1.6");
  assert.equal(parseMarker(buildMarker(b)).fixedIn, "4.0.0");
});

test("buildCommentMarker and parseCommentMarker round-trip", () => {
  const marker = buildCommentMarker(["GHSA-b", "GHSA-a"]);
  assert.equal(marker, "<!-- dependabot-alerts:added GHSA-a,GHSA-b -->");
  assert.deepEqual(parseCommentMarker(`${marker}\ntext`), ["GHSA-a", "GHSA-b"]);
  assert.equal(parseCommentMarker("an ordinary comment"), null);
});

test("isPermissionDenied separates an authorization failure from a real one", () => {
  assert.equal(
    isPermissionDenied("gh: HTTP 403: Resource not accessible"),
    true,
  );
  assert.equal(isPermissionDenied("gh: HTTP 401: Bad credentials"), true);
  assert.equal(isPermissionDenied("gh: HTTP 404: Not Found"), true);
  assert.equal(
    isPermissionDenied("gh: HTTP 500: Internal Server Error"),
    false,
  );
  assert.equal(isPermissionDenied("gh: API rate limit exceeded"), false);
});

test("parseMarker returns null for an unmarked or absent body", () => {
  assert.equal(parseMarker(undefined), null);
  assert.equal(parseMarker("just an issue someone wrote"), null);
  // The marker is the FIRST line or it is not the idempotency key.
  assert.equal(
    parseMarker(
      "preamble\n<!-- dependabot-alerts: pkg=x; manifest=y; fixed=1.0.0; ghsas=GHSA-a -->",
    ),
    null,
  );
});

test("mergeGhsas reports only the advisories the issue does not already name", () => {
  assert.deepEqual(mergeGhsas(["GHSA-a", "GHSA-b"], ["GHSA-b", "GHSA-c"]), {
    merged: ["GHSA-a", "GHSA-b", "GHSA-c"],
    added: ["GHSA-c"],
  });
});

test("mergeGhsas reports nothing added when the issue already covers them", () => {
  assert.deepEqual(mergeGhsas(["GHSA-a", "GHSA-b"], ["GHSA-a"]), {
    merged: ["GHSA-a", "GHSA-b"],
    added: [],
  });
});

/** The probe shape `buildIssueBody` takes: one vulnerable copy, nested by default. */
const nested = (
  version = "3.1.5",
  path = "node_modules/ajv/node_modules/fast-uri",
) => ({
  affected: [{ path, version, hoisted: false }],
  declared: false,
});
const hoisted = (version = "3.1.5") => ({
  affected: [{ path: "node_modules/fast-uri", version, hoisted: true }],
  declared: true,
});

test("buildIssueTitle names the bump and pluralizes the advisory count", () => {
  const [many] = groupAlerts([
    alert({ ghsa: "GHSA-a" }),
    alert({ ghsa: "GHSA-b" }),
  ]);
  assert.equal(
    buildIssueTitle(many),
    "chore(deps): bump `fast-uri` to `3.1.6` in `package-lock.json` (2 advisories)",
  );
  const [one] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  assert.equal(
    buildIssueTitle(one),
    "chore(deps): bump `fast-uri` to `3.1.6` in `package-lock.json` (1 advisory)",
  );
});

test("buildIssueBody leads with the marker and asks for an overrides pin when transitive", () => {
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-a", cve: "CVE-2026-1" }),
    alert({ ghsa: "GHSA-b" }),
  ]);
  const body = buildIssueBody(group, nested());

  assert.ok(body.startsWith(buildMarker(group)));
  assert.match(body, /\| Vulnerable on `v2\/main` \| `3\.1\.5` \|/);
  assert.match(body, /\| Fixed in \| `3\.1\.6` \|/);
  assert.match(body, /GHSA-a/);
  assert.match(body, /CVE-2026-1/);
  assert.match(body, /`overrides`/);
  assert.doesNotMatch(body, /raise its declared range/);
});

test("buildIssueBody asks a direct dependency's range to be raised, not widened", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const body = buildIssueBody(group, hoisted());
  assert.match(body, /Raise the declared range in `package\.json`/);
  assert.match(body, /can no longer resolve below `3\.1\.6`/);
  // Prescribing `>=3.1.6` would throw away the manifest's compatibility bound.
  assert.doesNotMatch(body, /range to `>=/);
  assert.doesNotMatch(body, /overrides/);
});

test("remediation reads the vulnerable copies, not the declaration", () => {
  const declaredSafe = [
    {
      path: "node_modules/ajv/node_modules/fast-uri",
      version: "3.1.5",
      hoisted: false,
    },
  ];
  // The manifest declares `fast-uri`, but the copy in range is a nested one:
  // raising the declared range would change nothing at all.
  assert.deepEqual(remediation(declaredSafe, true), {
    direct: false,
    transitive: true,
  });
  assert.deepEqual(
    remediation(
      [{ path: "node_modules/fast-uri", version: "3.1.5", hoisted: true }],
      true,
    ),
    { direct: true, transitive: false },
  );
  // An undeclared hoisted copy got there transitively like any other, so it
  // needs the override — "hoisted" is not a synonym for "declared".
  assert.deepEqual(
    remediation(
      [{ path: "node_modules/fast-uri", version: "3.1.5", hoisted: true }],
      false,
    ),
    { direct: false, transitive: true },
  );
});

test("buildIssueBody asks for BOTH edits when declared and nested copies are vulnerable", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const body = buildIssueBody(group, {
    declared: true,
    affected: [
      { path: "node_modules/fast-uri", version: "3.1.5", hoisted: true },
      {
        path: "node_modules/ajv/node_modules/fast-uri",
        version: "3.0.1",
        hoisted: false,
      },
    ],
  });
  assert.match(body, /Both edits are needed/);
  assert.match(body, /1\. \*\*Raise the declared range/);
  assert.match(body, /2\. \*\*Add an \[`overrides`\]/);
  // The table names the copies, so the maintainer can see why.
  assert.match(
    body,
    /\| `node_modules\/ajv\/node_modules\/fast-uri` \| `3\.0\.1` \|/,
  );
});

test("buildIssueBody asks only for an override when the declared copy is safe", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  // A valid lock: safe declared fast-uri@4, vulnerable nested fast-uri@3.1.5.
  const body = buildIssueBody(group, {
    declared: true,
    affected: [
      {
        path: "node_modules/ajv/node_modules/fast-uri",
        version: "3.1.5",
        hoisted: false,
      },
    ],
  });
  assert.doesNotMatch(body, /Raise the declared range/);
  assert.match(body, /Add an \[`overrides`\]/);
});

test("lockfileEntries keeps each copy's path and marks the hoisted one", () => {
  const lock = {
    packages: {
      "": { dependencies: { "fast-uri": "^4.0.0" } },
      "node_modules/fast-uri": { version: "4.0.0" },
      "node_modules/ajv/node_modules/fast-uri": { version: "3.1.5" },
    },
  };
  assert.deepEqual(lockfileEntries(lock, "fast-uri"), [
    {
      path: "node_modules/ajv/node_modules/fast-uri",
      version: "3.1.5",
      hoisted: false,
    },
    { path: "node_modules/fast-uri", version: "4.0.0", hoisted: true },
  ]);
});

test("buildIssueBody honors an overridden GHSA list when rewriting an issue", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const body = buildIssueBody(group, {
    ...nested(),
    ghsas: ["GHSA-a", "GHSA-old"],
  });
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-a", "GHSA-old"]);
});

test("buildNewAdvisoryComment lists only the newly-seen advisories", () => {
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-a" }),
    alert({ ghsa: "GHSA-b" }),
  ]);
  const comment = buildNewAdvisoryComment(group, ["GHSA-b"]);
  assert.match(comment, /1 new Dependabot advisory/);
  assert.match(comment, /GHSA-b/);
  assert.doesNotMatch(comment, /GHSA-a/);
});

// ---------------------------------------------------------------------------
// main() orchestration, driven through the injected spawn function.
//
// `workflow_dispatch` is a production trigger, not a test — and everything that
// can go wrong here goes wrong in production only: a paginated alert feed, a
// manifest that has moved on, a half-written board card, a comment posted twice
// (Copilot). Manifests are read from the working tree, so each test runs in a
// temp directory it populates itself.
// ---------------------------------------------------------------------------

/**
 * A `spawnSync` stand-in. `gh` responses are matched on the argument list, in
 * the order the handlers are declared, and every call is recorded.
 */
function fakeSpawn({
  securityFixes = { enabled: false, paused: false },
  securityFixesStatus = 0,
  securityFixesStderr = "",
  alertPages = [[]],
  issues = [],
  comments = [],
  milestone = "v2.6.0",
  boardEditStatus = 0,
} = {}) {
  const calls = [];
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });

  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const joined = args.join(" ");

    if (joined.includes("automated-security-fixes")) {
      return securityFixesStatus === 0
        ? ok(JSON.stringify(securityFixes))
        : {
            status: securityFixesStatus,
            stdout: "",
            stderr: securityFixesStderr,
          };
    }
    if (joined.includes("dependabot/alerts")) {
      // `--slurp` yields one array PER PAGE; main() must flatten them.
      return ok(JSON.stringify(alertPages));
    }
    if (joined.includes("milestones")) return ok(milestone);
    if (args[0] === "issue" && args[1] === "list")
      return ok(JSON.stringify(issues));
    if (args[0] === "issue" && args[1] === "view")
      return ok(JSON.stringify({ comments }));
    if (args[0] === "issue" && args[1] === "create")
      return ok("https://github.com/o/r/issues/77");
    if (args[0] === "project" && args[1] === "item-add")
      return ok(JSON.stringify({ id: "PVTI_fake" }));
    if (args[0] === "project" && args[1] === "field-list")
      return ok(
        JSON.stringify({
          fields: [
            { name: "Status", options: [{ name: "Todo", id: "todo-id" }] },
            { name: "Priority", options: [{ name: "High", id: "high-id" }] },
          ],
        }),
      );
    if (args[0] === "project" && args[1] === "item-edit")
      return boardEditStatus === 0
        ? ok()
        : { status: boardEditStatus, stdout: "", stderr: "field edit blew up" };
    return ok();
  };
  spawn.calls = calls;
  return spawn;
}

const ghCall = (spawn, verb) =>
  spawn.calls.find(
    (c) => c.cmd === "gh" && c.args[0] === "issue" && c.args[1] === verb,
  );
const ghCalls = (spawn, verb) =>
  spawn.calls.filter(
    (c) => c.cmd === "gh" && c.args[0] === "issue" && c.args[1] === verb,
  );

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

/** Run `body` in a temp cwd populated with `files` (path -> JSON value). */
function inTempRepo(files, body) {
  const dir = mkdtempSync(join(tmpdir(), "dependabot-alerts-"));
  const cwd = process.cwd();
  try {
    for (const [path, value] of Object.entries(files)) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, JSON.stringify(value));
    }
    process.chdir(dir);
    return body();
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A lockfile holding one transitive copy of `pkg` at `version`. */
const lockWith = (pkg, version) => ({
  lockfileVersion: 3,
  packages: { "": { dependencies: {} }, [`node_modules/${pkg}`]: { version } },
});

/** Without a PAT the board is never touched, which most tests want. */
function withoutProjectToken(body) {
  const saved = process.env.PROJECT_TOKEN;
  delete process.env.PROJECT_TOKEN;
  try {
    return body();
  } finally {
    if (saved !== undefined) process.env.PROJECT_TOKEN = saved;
  }
}

function withProjectToken(body) {
  const saved = process.env.PROJECT_TOKEN;
  process.env.PROJECT_TOKEN = "pat";
  try {
    return body();
  } finally {
    if (saved === undefined) delete process.env.PROJECT_TOKEN;
    else process.env.PROJECT_TOKEN = saved;
  }
}

test("main files one issue per bump, flattening a paginated alert feed", () => {
  // Two pages, as `--slurp` returns them: a single JSON.parse of concatenated
  // pages would have thrown before this ever reached grouping.
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-a", range: ">= 3.1.3, < 3.1.6" }),
        alert({ ghsa: "GHSA-b" }),
      ],
      [
        alert({
          ghsa: "GHSA-c",
          pkg: "browserslist",
          manifest: "clients/tui/package-lock.json",
          fixed: "4.28.7",
          range: "<= 4.28.6",
        }),
      ],
    ],
  });

  const log = inTempRepo(
    {
      "package-lock.json": lockWith("fast-uri", "3.1.5"),
      "clients/tui/package-lock.json": lockWith("browserslist", "4.28.2"),
    },
    () => withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );

  const created = ghCalls(spawn, "create");
  assert.equal(created.length, 2, "3 advisories, 2 bumps, 2 issues");
  const titles = created.map((c) => c.args[c.args.indexOf("--title") + 1]);
  assert.ok(titles.some((t) => t.includes("`fast-uri` to `3.1.6`")));
  assert.ok(titles.some((t) => t.includes("`browserslist` to `4.28.7`")));
  // The fast-uri issue names both of its advisories.
  const fastUri = created.find((c) =>
    c.args[c.args.indexOf("--title") + 1].includes("fast-uri"),
  );
  const body = fastUri.args[fastUri.args.indexOf("--body") + 1];
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-a", "GHSA-b"]);
  assert.deepEqual(created[0].args.slice(-2), ["--milestone", "v2.6.0"]);
  assert.ok(log.some((l) => l.includes("filed")));
});

test("main skips an alert already out of range on the checked-out branch", () => {
  const spawn = fakeSpawn({ alertPages: [[alert({ ghsa: "GHSA-a" })]] });
  const log = inTempRepo(
    { "package-lock.json": lockWith("fast-uri", "3.1.6") },
    () => withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(log.some((l) => l.includes("already out of range")));
});

test("main skips an alert whose manifest is absent from the checkout", () => {
  const spawn = fakeSpawn({
    alertPages: [
      [alert({ ghsa: "GHSA-a", manifest: "gone/package-lock.json" })],
    ],
  });
  const log = inTempRepo({}, () =>
    withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(log.some((l) => l.includes("absent on v2/main")));
});

test("main is a complete no-op on a second run", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      {
        number: 41,
        body: buildIssueBody(group, nested()),
      },
    ],
  });
  const log = inTempRepo(
    { "package-lock.json": lockWith("fast-uri", "3.1.5") },
    () => withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.equal(ghCall(spawn, "comment"), undefined);
  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.ok(log.some((l) => l.includes("#41 already covers")));
});

test("main will not update an issue whose bump differs, even for the same package", () => {
  // The marker's `fixed=` is what keeps a 4.0.0 bump off the 3.1.6 issue.
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a", fixed: "3.1.6" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-b", fixed: "4.0.0", range: "< 4.0.0" })]],
    issues: [
      {
        number: 41,
        body: buildIssueBody(old, nested()),
      },
    ],
  });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.5") }, () =>
    withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  assert.ok(ghCall(spawn, "create"), "a different bump gets its own issue");
  assert.equal(ghCall(spawn, "edit"), undefined);
});

test("main comments a new advisory BEFORE rewriting the marker", () => {
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
    issues: [
      {
        number: 41,
        body: buildIssueBody(old, nested()),
      },
    ],
  });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.5") }, () =>
    withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );

  const order = spawn.calls
    .filter(
      (c) => c.args[0] === "issue" && ["comment", "edit"].includes(c.args[1]),
    )
    .map((c) => c.args[1]);
  // Marker-first would let a failed comment be skipped forever by the no-op branch.
  assert.deepEqual(order, ["comment", "edit"]);

  const comment = ghCall(spawn, "comment");
  const text = comment.args[comment.args.indexOf("--body") + 1];
  assert.deepEqual(parseCommentMarker(text), ["GHSA-b"]);
  assert.ok(!text.includes("GHSA-a"), "only the newly-seen advisory");

  const edit = ghCall(spawn, "edit");
  assert.deepEqual(
    parseMarker(edit.args[edit.args.indexOf("--body") + 1]).ghsas,
    ["GHSA-a", "GHSA-b"],
  );
});

test("main does not repeat a comment it already posted", () => {
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
    issues: [
      {
        number: 41,
        body: buildIssueBody(old, nested()),
      },
    ],
    comments: [{ body: `${buildCommentMarker(["GHSA-b"])}\nsaid already` }],
  });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.5") }, () =>
    withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  assert.equal(ghCall(spawn, "comment"), undefined);
  // The marker still gets brought up to date.
  assert.ok(ghCall(spawn, "edit"));
});

test("main announces only the advisories no comment has claimed yet", () => {
  // The exact shape a failed marker edit leaves behind: the comment for `b`
  // went out, the body edit did not, and a third advisory has since arrived.
  // Comparing whole GHSA sets would find no match and announce `b` twice.
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-a" }),
        alert({ ghsa: "GHSA-b" }),
        alert({ ghsa: "GHSA-c" }),
      ],
    ],
    issues: [
      {
        number: 41,
        body: buildIssueBody(old, nested()),
      },
    ],
    comments: [{ body: `${buildCommentMarker(["GHSA-b"])}\nannounced b` }],
  });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.5") }, () =>
    withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );

  const comment = ghCall(spawn, "comment");
  assert.ok(comment, "the unannounced advisory still gets a comment");
  const text = comment.args[comment.args.indexOf("--body") + 1];
  assert.deepEqual(parseCommentMarker(text), ["GHSA-c"]);
  assert.ok(!text.includes("GHSA-b"), "b was already announced");
});

test("main refreshes the title when an issue grows another advisory", () => {
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
    issues: [
      {
        number: 41,
        body: buildIssueBody(old, nested()),
      },
    ],
  });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.5") }, () =>
    withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  const edit = ghCall(spawn, "edit");
  // Filed as "(1 advisory)"; editing only the body would leave it saying so.
  assert.match(
    edit.args[edit.args.indexOf("--title") + 1],
    /\(2 advisories\)$/,
  );
});

test("main fails loudly when Dependabot security PRs are back on", () => {
  const spawn = fakeSpawn({ securityFixes: { enabled: true, paused: false } });
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /security-update PRs are ENABLED again/,
  );
  assert.equal(spawn.calls.length, 1, "nothing else runs");
});

test("main continues, reporting UNVERIFIED, when the token cannot read the setting", () => {
  const spawn = fakeSpawn({
    securityFixesStatus: 1,
    securityFixesStderr: "gh: HTTP 403: Resource not accessible by integration",
    alertPages: [[]],
  });
  const log = captureLog(() => main("o/r", spawn));
  assert.ok(log.some((l) => l.includes("UNVERIFIED")));
  assert.ok(log.some((l) => l.includes("no open alerts")));
});

test("main throws when the setting lookup fails for a non-permission reason", () => {
  const spawn = fakeSpawn({
    securityFixesStatus: 1,
    securityFixesStderr: "gh: HTTP 502: Bad Gateway",
  });
  // Swallowing this would exit green having skipped the sweep's own precondition.
  assert.throws(
    () => captureLog(() => main("o/r", spawn)),
    /automated-security-fixes lookup failed.*502/s,
  );
});

test("main leaves an unmilestoned issue off the board for triage", () => {
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    milestone: "",
  });
  const log = inTempRepo(
    { "package-lock.json": lockWith("fast-uri", "3.1.5") },
    () => withProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  assert.ok(ghCall(spawn, "create"));
  // `Incoming` <=> no milestone: boarding it at Todo would assert an approval
  // the invariant reads off the milestone.
  assert.equal(
    spawn.calls.find(
      (c) => c.args[0] === "project" && c.args[1] === "item-add",
    ),
    undefined,
  );
  assert.ok(log.some((l) => l.includes("unmilestoned and unboarded")));
});

test("main fails the run when a card is added but its fields are not set", () => {
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-a" }),
        alert({
          ghsa: "GHSA-b",
          pkg: "qs",
          fixed: "6.16.0",
          range: "< 6.16.0",
        }),
      ],
    ],
    boardEditStatus: 1,
  });
  assert.throws(
    () =>
      inTempRepo(
        {
          "package-lock.json": {
            lockfileVersion: 3,
            packages: {
              "": { dependencies: {} },
              "node_modules/fast-uri": { version: "3.1.5" },
              "node_modules/qs": { version: "6.15.3" },
            },
          },
        },
        () => withProjectToken(() => captureLog(() => main("o/r", spawn))),
      ),
    /incomplete board placement/,
  );
  // A half-placed card is worth failing over — but not before both issues exist.
  assert.equal(ghCalls(spawn, "create").length, 2);
});
