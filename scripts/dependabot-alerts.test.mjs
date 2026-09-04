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
  SUPPORTED_ECOSYSTEM,
  PRIORITY_FIELD_ID,
  STATUS_FIELD_ID,
  buildClearedBody,
  overrideAncestors,
  scopedOverrideExample,
  buildCommentMarker,
  pickMilestone,
  narrowToApplicable,
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
  ecosystem = "npm",
}) {
  return {
    state,
    html_url: `https://github.com/o/r/security/dependabot/${ghsa}`,
    dependency: {
      package: { name: pkg, ecosystem },
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

test("isPermissionDenied tolerates a scope refusal", () => {
  // The two ways GitHub says "this token may not read that": an explicit 403,
  // and a 404 hiding a resource the token cannot see.
  assert.equal(
    isPermissionDenied("gh: HTTP 403: Resource not accessible by integration"),
    true,
  );
  assert.equal(isPermissionDenied("gh: HTTP 404: Not Found"), true);
});

test("isPermissionDenied treats a bad token or a rate limit as a real failure", () => {
  // ⚠️ A rate limit is also a 403, so status alone cannot decide this — waving
  // it through would exit green having skipped the sweep's own precondition.
  assert.equal(
    isPermissionDenied("gh: API rate limit exceeded (HTTP 403)"),
    false,
  );
  assert.equal(
    isPermissionDenied(
      "gh: HTTP 403: You have exceeded a secondary rate limit",
    ),
    false,
  );
  // 401 is a bad or expired token, never a scope question.
  assert.equal(isPermissionDenied("gh: HTTP 401: Bad credentials"), false);
  assert.equal(
    isPermissionDenied("gh: HTTP 500: Internal Server Error"),
    false,
  );
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

test("narrowToApplicable drops advisories the installed version is out of range of", () => {
  // Same package, manifest and patched version, so one group — but different
  // vulnerable ranges, and 3.1.0 is in range of only one of them.
  const [group] = groupAlerts([
    alert({
      ghsa: "GHSA-narrow",
      range: ">= 3.1.3, < 3.1.6",
      severity: "critical",
    }),
    alert({
      ghsa: "GHSA-wide",
      range: ">= 3.0.0, < 3.1.6",
      severity: "medium",
    }),
  ]);
  assert.equal(group.advisories.length, 2);

  const result = narrowToApplicable(group, [
    { path: "node_modules/fast-uri", version: "3.1.0", hoisted: true },
  ]);
  assert.deepEqual(result.group.ghsas, ["GHSA-wide"]);
  // Severity is re-derived: the critical one does not apply here.
  assert.equal(result.group.severity, "medium");
  assert.equal(result.affected.length, 1);
  // ...and the marker cannot claim an advisory this branch is not exposed to.
  assert.deepEqual(parseMarker(buildMarker(result.group)).ghsas, ["GHSA-wide"]);
});

test("narrowToApplicable keeps every advisory that does apply", () => {
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-narrow", range: ">= 3.1.3, < 3.1.6" }),
    alert({ ghsa: "GHSA-wide", range: ">= 3.0.0, < 3.1.6" }),
  ]);
  const result = narrowToApplicable(group, [
    { path: "node_modules/fast-uri", version: "3.1.5", hoisted: true },
  ]);
  assert.deepEqual(result.group.ghsas, ["GHSA-narrow", "GHSA-wide"]);
});

test("narrowToApplicable returns null when nothing installed is in range", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  assert.equal(
    narrowToApplicable(group, [
      { path: "node_modules/fast-uri", version: "3.1.6", hoisted: true },
    ]),
    null,
  );
  assert.equal(narrowToApplicable(group, []), null);
});

test("buildIssueBody escapes a disjoint range so the table survives it", () => {
  // `||` is legal in a semver range and is also the Markdown column separator.
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-a", range: ">= 1.0.0, < 2.0.0 || >= 3.0.0, < 3.5.0" }),
  ]);
  const body = buildIssueBody(group, nested());
  const row = body
    .split("\n")
    .find((line) => line.includes("GHSA-a") && line.startsWith("|"));
  // Count only the pipes Markdown will treat as separators: five columns means
  // four inner separators plus the two outer ones.
  const separators = row.replace(/\\\|/g, "").split("|").length - 1;
  assert.equal(
    separators,
    6,
    `escaped row should keep its column count: ${row}`,
  );
  assert.ok(row.includes(String.raw`\|\|`), "the range's own pipes survive");
});

test("pickMilestone takes the nearest due date, never an undated bucket", () => {
  // jq sorts null before every string, so `sort_by(.due_on) | .[0]` over this
  // list would return "Backlog" — an open bucket with no release date at all.
  const milestones = [
    { title: "Backlog", state: "open", due_on: null },
    { title: "v2.7.0", state: "open", due_on: "2026-09-16T00:00:00Z" },
    { title: "v2.6.0", state: "open", due_on: "2026-09-09T00:00:00Z" },
  ];
  assert.equal(pickMilestone(milestones), "v2.6.0");
});

test("pickMilestone ignores closed milestones and empty input", () => {
  assert.equal(
    pickMilestone([
      { title: "v2.5.0", state: "closed", due_on: "2026-01-01T00:00:00Z" },
    ]),
    null,
  );
  // Nothing dated and open means no bucket to take: filed unmilestoned, and
  // the board write is skipped so triage places it.
  assert.equal(pickMilestone([{ title: "Backlog", due_on: null }]), null);
  assert.equal(pickMilestone([]), null);
  assert.equal(pickMilestone(undefined), null);
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
  assert.match(body, /2\. \*\*Add a parent-scoped \[`overrides`\]/);
  // A package-wide pin would be rejected: the manifest declares it directly.
  assert.match(body, /EOVERRIDE/);
  assert.match(body, /"ajv": \{\n\s+"fast-uri": "3\.1\.6"/);
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
    if (joined.includes("milestones"))
      return ok(
        JSON.stringify(
          milestone
            ? [
                {
                  title: milestone,
                  state: "open",
                  due_on: "2026-09-09T00:00:00Z",
                },
              ]
            : [],
        ),
      );
    // `--slurp`, so one array per page — `issues` may be a flat list or pages.
    if (joined.includes("/issues?"))
      return ok(JSON.stringify(Array.isArray(issues[0]) ? issues : [issues]));
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

/**
 * The probe `main()` derives from `lockWith`: one hoisted, undeclared copy.
 * A fixture issue built from this renders byte-identically to what `main()`
 * would produce, which is what makes the no-op path assertable.
 */
const asInstalled = (version = "3.1.5") => ({
  affected: [{ path: "node_modules/fast-uri", version, hoisted: true }],
  declared: false,
});

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
        title: buildIssueTitle(group),
        body: buildIssueBody(group, asInstalled()),
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
  assert.ok(log.some((l) => l.includes("#41 is up to date")));
});

test("main will not update an issue whose bump differs, even for the same package", () => {
  // The marker's `fixed=` is what keeps a 4.0.0 bump off the 3.1.6 issue.
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a", fixed: "3.1.6" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-b", fixed: "4.0.0", range: "< 4.0.0" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(old),
        body: buildIssueBody(old, asInstalled()),
      },
    ],
  });
  const log = inTempRepo(
    { "package-lock.json": lockWith("fast-uri", "3.1.5") },
    () =>
      withoutProjectToken(() =>
        captureLog(() => main("o/r", spawn, "2026-09-04")),
      ),
  );
  assert.ok(ghCall(spawn, "create"), "a different bump gets its own issue");
  // ...and the 3.1.6 issue, whose alert is no longer in the open feed, is
  // cleared rather than left asserting a vulnerability nobody tracks.
  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "the superseded issue is reconciled");
  assert.match(
    edit.args[edit.args.indexOf("--body") + 1],
    /fixed or dismissed/,
  );
  assert.ok(log.some((l) => l.includes("no open alert remains")));
});

test("main comments a new advisory BEFORE rewriting the marker", () => {
  const [old] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" }), alert({ ghsa: "GHSA-b" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(old),
        body: buildIssueBody(old, asInstalled()),
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
        title: buildIssueTitle(old),
        body: buildIssueBody(old, asInstalled()),
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
        title: buildIssueTitle(old),
        body: buildIssueBody(old, asInstalled()),
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
        title: buildIssueTitle(old),
        body: buildIssueBody(old, asInstalled()),
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

test("main refreshes an issue whose exposure shrank, without commenting", () => {
  // Filed when both advisories applied; `v2/main` has since moved to 3.1.0,
  // which is out of range of the narrow one. Nothing is NEW, so `added` is
  // empty — but the body still claims an advisory that no longer applies.
  const [filed] = groupAlerts([
    alert({ ghsa: "GHSA-narrow", range: ">= 3.1.3, < 3.1.6" }),
    alert({ ghsa: "GHSA-wide", range: ">= 3.0.0, < 3.1.6" }),
  ]);
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-narrow", range: ">= 3.1.3, < 3.1.6" }),
        alert({ ghsa: "GHSA-wide", range: ">= 3.0.0, < 3.1.6" }),
      ],
    ],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(filed),
        body: buildIssueBody(filed, asInstalled()),
      },
    ],
  });
  const log = inTempRepo(
    { "package-lock.json": lockWith("fast-uri", "3.1.0") },
    () => withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );

  // A comment is for genuinely new advisories, and there are none.
  assert.equal(ghCall(spawn, "comment"), undefined);

  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "the stale body is rewritten");
  const body = edit.args[edit.args.indexOf("--body") + 1];
  assert.ok(!body.includes("| [GHSA-narrow]"), "no longer in the table");
  assert.match(body, /`3\.1\.0`/, "the affected version is refreshed");
  assert.match(edit.args[edit.args.indexOf("--title") + 1], /\(1 advisory\)$/);
  // The marker stays monotonic: it records what has been announced, so the
  // dropped advisory cannot be re-announced later.
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-narrow", "GHSA-wide"]);
  assert.ok(log.some((l) => l.includes("refreshed #41")));
});

test("main clears an open issue when the manifest is gone", () => {
  const [group] = groupAlerts([
    alert({ ghsa: "GHSA-a", manifest: "clients/gone/package-lock.json" }),
  ]);
  const spawn = fakeSpawn({
    alertPages: [
      [alert({ ghsa: "GHSA-a", manifest: "clients/gone/package-lock.json" })],
    ],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(group),
        body: buildIssueBody(group, asInstalled()),
      },
    ],
  });
  const log = inTempRepo({}, () =>
    withoutProjectToken(() =>
      captureLog(() => main("o/r", spawn, "2026-09-04")),
    ),
  );

  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "the stale issue is rewritten, not silently skipped");
  const body = edit.args[edit.args.indexOf("--body") + 1];
  assert.match(body, /No longer applicable on `v2\/main` as of 2026-09-04/);
  assert.match(body, /no longer part of this repo/);
  // The marker survives, so the issue is reused if the advisory comes back.
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-a"]);
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(log.some((l) => l.includes("cleared #41")));
});

test("main clears an open issue when every copy moved out of range", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(group),
        body: buildIssueBody(group, asInstalled()),
      },
    ],
  });
  const log = inTempRepo(
    { "package-lock.json": lockWith("fast-uri", "3.1.6") },
    () =>
      withoutProjectToken(() =>
        captureLog(() => main("o/r", spawn, "2026-09-04")),
      ),
  );
  const edit = ghCall(spawn, "edit");
  assert.ok(edit);
  const body = edit.args[edit.args.indexOf("--body") + 1];
  assert.match(body, /every installed copy is out of range \(`3\.1\.6`\)/);
  assert.ok(log.some((l) => l.includes("cleared #41")));
});

test("main does not re-clear an issue it already cleared", () => {
  // The second run of a cleared sweep must touch nothing at all.
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(group),
        body: buildClearedBody(group, {
          ghsas: ["GHSA-a"],
          reason: "every installed copy is out of range (`3.1.6`)",
          today: "2026-09-04",
        }),
      },
    ],
  });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.6") }, () =>
    withoutProjectToken(() =>
      captureLog(() => main("o/r", spawn, "2026-09-04")),
    ),
  );
  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.equal(ghCall(spawn, "create"), undefined);
});

test("main skips quietly when nothing applies and no issue is open", () => {
  const spawn = fakeSpawn({ alertPages: [[alert({ ghsa: "GHSA-a" })]] });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.6") }, () =>
    withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  assert.equal(ghCall(spawn, "edit"), undefined);
  assert.equal(ghCall(spawn, "create"), undefined);
});

test("buildIssueBody counts the applicable alerts in its prose, not the marker", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  // The marker carries a second, since-closed advisory; the prose must not.
  const body = buildIssueBody(group, {
    ...nested(),
    ghsas: ["GHSA-a", "GHSA-closed"],
  });
  assert.match(body, /Filed automatically from 1 open Dependabot alert\b/);
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-a", "GHSA-closed"]);
});

test("main clears an issue when its last alert is fixed or dismissed", () => {
  // `openAlerts` asks for state=open, so a fixed alert simply vanishes and its
  // group is never built. The issue has to be reconciled from the other side.
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(group),
        body: buildIssueBody(group, asInstalled()),
      },
    ],
  });
  const log = inTempRepo(
    { "package-lock.json": lockWith("fast-uri", "3.1.5") },
    () =>
      withoutProjectToken(() =>
        captureLog(() => main("o/r", spawn, "2026-09-04")),
      ),
  );
  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "the zero-alert run still reconciles open issues");
  const body = edit.args[edit.args.indexOf("--body") + 1];
  assert.match(body, /every alert it tracked has been fixed or dismissed/);
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-a"]);
  assert.ok(log.some((l) => l.includes("no open alert remains")));
});

test("main reconciles a vanished group even while other groups remain", () => {
  // The early return is only half of it: a disappeared group is also never
  // visited by the loop when the feed still has other bumps in it.
  const [gone] = groupAlerts([
    alert({ ghsa: "GHSA-gone", pkg: "qs", fixed: "6.16.0" }),
  ]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(gone),
        body: buildIssueBody(gone, {
          affected: [
            { path: "node_modules/qs", version: "6.15.3", hoisted: true },
          ],
          declared: false,
        }),
      },
    ],
  });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.5") }, () =>
    withoutProjectToken(() =>
      captureLog(() => main("o/r", spawn, "2026-09-04")),
    ),
  );
  assert.ok(ghCall(spawn, "create"), "the live bump is still filed");
  const edit = ghCall(spawn, "edit");
  assert.ok(edit, "the vanished bump's issue is still cleared");
  assert.equal(edit.args[2], "41");
});

test("main does not re-clear a vanished group's issue on the next run", () => {
  const spawn = fakeSpawn({
    alertPages: [[]],
    issues: [
      {
        number: 41,
        title:
          "chore(deps): bump `fast-uri` to `3.1.6` in `package-lock.json` (1 advisory)",
        body: buildClearedBody(
          {
            package: "fast-uri",
            manifestPath: "package-lock.json",
            fixedIn: "3.1.6",
          },
          {
            ghsas: ["GHSA-a"],
            reason: "every alert it tracked has been fixed or dismissed",
            today: "2026-09-04",
          },
        ),
      },
    ],
  });
  inTempRepo({}, () =>
    withoutProjectToken(() =>
      captureLog(() => main("o/r", spawn, "2026-09-04")),
    ),
  );
  assert.equal(ghCall(spawn, "edit"), undefined);
});

test("main boards a filed issue at Todo/High using resolved option ids", () => {
  // The acceptance-critical path: the two field edits that actually place the
  // card. Previously only its failure modes were covered.
  const spawn = fakeSpawn({ alertPages: [[alert({ ghsa: "GHSA-a" })]] });
  const log = inTempRepo(
    { "package-lock.json": lockWith("fast-uri", "3.1.5") },
    () => withProjectToken(() => captureLog(() => main("o/r", spawn))),
  );

  const add = spawn.calls.find(
    (c) => c.args[0] === "project" && c.args[1] === "item-add",
  );
  assert.ok(add, "the card is added");
  const edits = spawn.calls.filter(
    (c) => c.args[0] === "project" && c.args[1] === "item-edit",
  );
  assert.equal(edits.length, 2, "Status and Priority are separate calls");
  const optionOf = (call) =>
    call.args[call.args.indexOf("--single-select-option-id") + 1];
  const fieldOf = (call) => call.args[call.args.indexOf("--field-id") + 1];
  assert.deepEqual(
    edits.map((e) => [fieldOf(e), optionOf(e)]),
    [
      [STATUS_FIELD_ID, "todo-id"],
      [PRIORITY_FIELD_ID, "high-id"],
    ],
  );
  // Resolved by NAME at run time, never hardcoded.
  assert.ok(
    spawn.calls.some(
      (c) => c.args[0] === "project" && c.args[1] === "field-list",
    ),
  );
  assert.ok(log.some((l) => l.includes("boarded")));
});

test("overrideAncestors reads the parent chain, scoped names included", () => {
  assert.deepEqual(
    overrideAncestors("node_modules/ajv/node_modules/fast-uri"),
    ["ajv"],
  );
  assert.deepEqual(
    overrideAncestors(
      "node_modules/@sc/a/node_modules/b/node_modules/fast-uri",
    ),
    ["@sc/a", "b"],
  );
  assert.deepEqual(overrideAncestors("node_modules/fast-uri"), []);
});

test("scopedOverrideExample nests each vulnerable copy under its parents", () => {
  const json = scopedOverrideExample(
    [
      { path: "node_modules/fast-uri", hoisted: true },
      { path: "node_modules/ajv/node_modules/fast-uri", hoisted: false },
      { path: "node_modules/@sc/x/node_modules/fast-uri", hoisted: false },
    ],
    { package: "fast-uri", fixedIn: "3.1.6" },
  );
  // The hoisted copy is the declared one and gets no override entry.
  assert.deepEqual(JSON.parse(json), {
    overrides: {
      ajv: { "fast-uri": "3.1.6" },
      "@sc/x": { "fast-uri": "3.1.6" },
    },
  });
});

test("groupAlerts records the ecosystem so non-npm alerts are identifiable", () => {
  const [docker] = groupAlerts([
    alert({
      ghsa: "GHSA-d",
      pkg: "node",
      manifest: "Dockerfile",
      ecosystem: "docker",
    }),
  ]);
  assert.equal(docker.ecosystem, "docker");
  assert.notEqual(docker.ecosystem, SUPPORTED_ECOSYSTEM);
});

test("main skips a non-npm alert loudly instead of crashing on its manifest", () => {
  // ⚠️ This repo has a Dockerfile, so this is reachable. Parsing it as a
  // lockfile threw and aborted the entire sweep before any npm group ran.
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({
          ghsa: "GHSA-docker",
          pkg: "node",
          manifest: "Dockerfile",
          ecosystem: "docker",
        }),
        alert({ ghsa: "GHSA-a" }),
      ],
    ],
  });
  const log = inTempRepo(
    {
      "package-lock.json": lockWith("fast-uri", "3.1.5"),
    },
    () => withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );

  // The npm bump is still filed — the non-npm alert must not abort the run.
  const created = ghCalls(spawn, "create");
  assert.equal(created.length, 1);
  assert.match(
    created[0].args[created[0].args.indexOf("--title") + 1],
    /`fast-uri`/,
  );
  // ...and the skipped one is named, with its GHSA, so a human can file it.
  assert.ok(
    log.some(
      (l) =>
        l.includes("docker") &&
        l.includes("Dockerfile") &&
        l.includes("GHSA-docker") &&
        l.includes("raise it by hand"),
    ),
    `expected a loud skip line, got: ${log.join(" | ")}`,
  );
});

test("main says superseded, not fixed, when the GHSA is still open elsewhere", () => {
  // GitHub revised `first_patched_version`, so the advisory moved to a new key
  // while staying open. Calling that "fixed or dismissed" would stand down a
  // live exposure.
  const [filed] = groupAlerts([alert({ ghsa: "GHSA-a", fixed: "3.1.6" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a", fixed: "3.1.7", range: "< 3.1.7" })]],
    issues: [
      {
        number: 41,
        title: buildIssueTitle(filed),
        body: buildIssueBody(filed, asInstalled()),
      },
    ],
  });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.5") }, () =>
    withoutProjectToken(() =>
      captureLog(() => main("o/r", spawn, "2026-09-04")),
    ),
  );
  const edit = ghCall(spawn, "edit");
  assert.ok(edit);
  const body = edit.args[edit.args.indexOf("--body") + 1];
  assert.match(body, /superseded/);
  assert.match(body, /`GHSA-a` is still open/);
  assert.doesNotMatch(body, /fixed or dismissed/);
  // ...and the new bump gets its own issue.
  assert.ok(ghCall(spawn, "create"));
});

test("buildIssueBody does not claim security PRs are off when unverified", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const verified = buildIssueBody(group, nested());
  assert.match(verified, /Dependabot opens no security-update PRs/);

  const unverified = buildIssueBody(group, {
    ...nested(),
    securityPrsOff: false,
  });
  assert.doesNotMatch(unverified, /opens no security-update PRs/);
  assert.match(unverified, /The fix is written by hand/);
});

test("main omits the security-PR claim when the token could not read it", () => {
  const spawn = fakeSpawn({
    securityFixesStatus: 1,
    securityFixesStderr: "gh: HTTP 403: Resource not accessible by integration",
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
  });
  const log = inTempRepo(
    { "package-lock.json": lockWith("fast-uri", "3.1.5") },
    () => withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  assert.ok(log.some((l) => l.includes("UNVERIFIED")));
  const create = ghCall(spawn, "create");
  assert.ok(create);
  assert.doesNotMatch(
    create.args[create.args.indexOf("--body") + 1],
    /opens no security-update PRs/,
  );
});

test("main reads every page of open dependabot issues", () => {
  // The second page holds the matching marker. Truncating the lookup would
  // file a duplicate issue rather than recognising this one.
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [
      [{ number: 1, body: "an unrelated dependabot issue" }],
      [
        {
          number: 41,
          title: buildIssueTitle(group),
          body: buildIssueBody(group, asInstalled()),
        },
      ],
    ],
  });
  const log = inTempRepo(
    { "package-lock.json": lockWith("fast-uri", "3.1.5") },
    () => withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  assert.equal(ghCall(spawn, "create"), undefined);
  assert.ok(log.some((l) => l.includes("#41 is up to date")));
});

test("main drops a pull request returned by the issues endpoint", () => {
  // `/issues` returns PRs too; one carrying no marker must not be mistaken for
  // a match, nor crash the lookup.
  const spawn = fakeSpawn({
    alertPages: [[alert({ ghsa: "GHSA-a" })]],
    issues: [[{ number: 9, body: "a PR body", pull_request: { url: "..." } }]],
  });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.5") }, () =>
    withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  assert.ok(ghCall(spawn, "create"), "the issue is still filed");
});

test("main files an issue naming only the advisories that apply here", () => {
  const spawn = fakeSpawn({
    alertPages: [
      [
        alert({ ghsa: "GHSA-narrow", range: ">= 3.1.3, < 3.1.6" }),
        alert({ ghsa: "GHSA-wide", range: ">= 3.0.0, < 3.1.6" }),
      ],
    ],
  });
  inTempRepo({ "package-lock.json": lockWith("fast-uri", "3.1.0") }, () =>
    withoutProjectToken(() => captureLog(() => main("o/r", spawn))),
  );
  const create = ghCall(spawn, "create");
  const body = create.args[create.args.indexOf("--body") + 1];
  assert.deepEqual(parseMarker(body).ghsas, ["GHSA-wide"]);
  assert.ok(!body.includes("GHSA-narrow"), "3.1.0 is out of that range");
  assert.match(
    create.args[create.args.indexOf("--title") + 1],
    /\(1 advisory\)$/,
  );
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
