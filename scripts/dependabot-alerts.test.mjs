// Unit tests for the pure halves of dependabot-alerts.mjs (#2233). The impure
// half (`main()`, which shells out to `gh`) is exercised only via
// `workflow_dispatch` in CI, per the same split `dependency-refresh.mjs` and
// `verify-skills.mjs` use. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIssueBody,
  buildIssueTitle,
  buildMarker,
  buildNewAdvisoryComment,
  groupAlerts,
  isDirectDependency,
  lockfileVersions,
  mergeGhsas,
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
    ghsas: ["GHSA-b", "GHSA-a"],
  });
  assert.equal(
    marker,
    "<!-- dependabot-alerts: pkg=fast-uri; manifest=package-lock.json; ghsas=GHSA-a,GHSA-b -->",
  );
  assert.deepEqual(parseMarker(`${marker}\nbody text`), {
    package: "fast-uri",
    manifestPath: "package-lock.json",
    ghsas: ["GHSA-a", "GHSA-b"],
  });
});

test("parseMarker returns null for an unmarked or absent body", () => {
  assert.equal(parseMarker(undefined), null);
  assert.equal(parseMarker("just an issue someone wrote"), null);
  // The marker is the FIRST line or it is not the idempotency key.
  assert.equal(
    parseMarker(
      "preamble\n<!-- dependabot-alerts: pkg=x; manifest=y; ghsas=GHSA-a -->",
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
  const body = buildIssueBody(group, { installed: ["3.1.5"], direct: false });

  assert.ok(body.startsWith(buildMarker(group)));
  assert.match(body, /\| Installed on `v2\/main` \| `3\.1\.5` \|/);
  assert.match(body, /\| Fixed in \| `3\.1\.6` \|/);
  assert.match(body, /GHSA-a/);
  assert.match(body, /CVE-2026-1/);
  assert.match(body, /`overrides`/);
  assert.doesNotMatch(body, /bump its declared range/);
});

test("buildIssueBody asks for a plain range bump when the dependency is direct", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const body = buildIssueBody(group, { installed: ["3.1.5"], direct: true });
  assert.match(body, /\*\*direct\*\* dependency of `package\.json`/);
  assert.match(body, /bump its declared range to `>=3\.1\.6`/);
});

test("buildIssueBody honors an overridden GHSA list when rewriting an issue", () => {
  const [group] = groupAlerts([alert({ ghsa: "GHSA-a" })]);
  const body = buildIssueBody(group, {
    installed: ["3.1.5"],
    direct: false,
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
