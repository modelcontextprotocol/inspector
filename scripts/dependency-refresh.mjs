#!/usr/bin/env node
// Monthly npm-outdated sweep (#2229), replacing Dependabot version-update PRs.
//
// A Dependabot version-update PR carries no issue and no board card — the same
// carve-out from "every PR references an issue" that the security-update flow
// had (that half is handled separately by the alert-driven pipeline, also
// #2229). Turning npm version updates off in `.github/dependabot.yml` is #2235;
// this script is the replacement it switches over to, and lands first, so the
// two flows overlap until #2235 does. Once a month it runs
// `npm outdated` across the root install and every client under `clients/*`
// (each has its own package.json + lockfile — v2 is not a workspace), and
// files or updates ONE tracking issue listing everything behind. A maintainer
// picks what to bump and opens a normal PR against `v2/main`; there is no
// auto-generated PR here at all.
//
// Idempotent by design: the issue body starts with a fixed HTML marker
// (ISSUE_MARKER below), which is how a second run in the same month finds and
// updates the existing open issue instead of filing a duplicate.
//
// `parseOutdated`, `buildIssueBody` and `buildClearedBody` are pure. `main()`
// shells out to `npm outdated` and `gh`, so it takes its spawn function as a
// parameter (defaulting to the real one) and `dependency-refresh.test.mjs`
// drives it with a fake — covering npm failure, create vs. edit, the milestone
// lookup and both no-op paths. `workflow_dispatch` is a production trigger,
// not a substitute for that (Copilot): the helper-only tests it replaced let a
// non-zero `npm outdated` exit report a clean sweep.

import { spawnSync } from "node:child_process";

export const ISSUE_MARKER = "<!-- dependency-refresh:monthly-sweep -->";

/** Installs to check, relative to the repo root, and their npm-outdated label. */
export const INSTALLS = [
  { dir: ".", label: "root" },
  { dir: "clients/web", label: "clients/web" },
  { dir: "clients/cli", label: "clients/cli" },
  { dir: "clients/tui", label: "clients/tui" },
  { dir: "clients/launcher", label: "clients/launcher" },
];

/**
 * Normalize one install's `npm outdated --json` output.
 *
 * @param {string} json raw stdout from `npm outdated --json` (may be `""` or `"{}"`)
 * @returns {Array<{name: string, current: string, wanted: string, latest: string}>}
 */
export function parseOutdated(json) {
  const trimmed = json.trim();
  if (trimmed === "") return [];
  const parsed = JSON.parse(trimmed);
  return Object.entries(parsed)
    .map(([name, info]) => ({
      name,
      current: info.current ?? "(missing)",
      wanted: info.wanted ?? info.current ?? "?",
      latest: info.latest ?? "?",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {Array<{label: string, packages: ReturnType<typeof parseOutdated>}>} installs
 * @returns {string | null} the issue body, or `null` when nothing is outdated anywhere
 */
export function buildIssueBody(installs) {
  const withPackages = installs.filter((i) => i.packages.length > 0);
  if (withPackages.length === 0) return null;

  const sections = withPackages.map(({ label, packages }) => {
    const rows = packages
      .map(
        (p) => `| \`${p.name}\` | ${p.current} | ${p.wanted} | ${p.latest} |`,
      )
      .join("\n");
    return `### \`${label}\`\n\n| Package | Current | Wanted | Latest |\n| --- | --- | --- | --- |\n${rows}`;
  });

  return [
    ISSUE_MARKER,
    "Routine dependency refresh — `npm outdated` run against `v2/main` on a monthly schedule, replacing Dependabot version-update PRs (#2229).",
    "",
    "This is a tracking issue, not a diff: pick what's worth bumping (`wanted` is the safe default; `latest` may cross a major and needs its own judgment call, especially for anything root-declared per [Dependency placement](https://github.com/modelcontextprotocol/inspector/blob/v2/main/AGENTS.md#dependency-placement)) and open a normal PR against `v2/main`.",
    "",
    ...sections,
    "",
    "A second run of this sweep before this issue closes updates this body in place rather than filing a duplicate.",
  ].join("\n");
}

/**
 * The body a still-open tracking issue is rewritten to once every install is
 * current again. Without it the issue keeps its last package table forever and
 * reads as live work that no longer exists (Copilot).
 *
 * The sweep rewrites rather than closes: it deliberately takes no board
 * actions (see the workflow header), and closing an issue whose card a
 * maintainer has already moved would make the board claim work shipped that
 * this script cannot verify shipped. A maintainer closes it.
 *
 * @param {string} isoDate the sweep date, as `YYYY-MM-DD`
 * @returns {string}
 */
export function buildClearedBody(isoDate) {
  return [
    ISSUE_MARKER,
    `Every install is up to date as of ${isoDate} — nothing is outdated at the root or in any client.`,
    "",
    "This issue was filed by an earlier run of the monthly sweep (#2229) and its package table is gone because the packages it listed are no longer behind. Either they were bumped or their ranges caught up; nothing here is outstanding.",
    "",
    "Safe to close. A later sweep that finds something outdated will refile this body with a fresh table rather than open a duplicate.",
  ].join("\n");
}

function runOutdated(dir, spawn) {
  const result = spawn("npm", ["outdated", "--json"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  // `npm outdated` exits 0 when everything is current and 1 when it finds
  // something outdated — both are successful runs. Every other status is a
  // real failure (a registry or config error exits 2), and it MUST throw
  // rather than fall through: a failed run also prints nothing to stdout, so
  // accepting it parses to an empty package list and reports a clean no-op.
  // With five installs swept in a loop, that turns a total outage into a
  // silent "nothing to do" (Copilot).
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `npm outdated failed in ${dir} (exit ${result.status}): ${(result.stderr ?? "").trim()}`,
    );
  }
  return result.stdout ?? "";
}

function findExistingIssue(repo, spawn) {
  const result = spawn(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--search",
      ISSUE_MARKER,
      "--json",
      "number,body",
      "--limit",
      "10",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`gh issue list failed: ${result.stderr}`);
  }
  const issues = JSON.parse(result.stdout || "[]");
  return issues.find((i) => i.body?.startsWith(ISSUE_MARKER)) ?? null;
}

function currentMilestone(repo, spawn) {
  const result = spawn(
    "gh",
    [
      "api",
      `repos/${repo}/milestones`,
      "--jq",
      'map(select(.state=="open")) | sort_by(.due_on) | .[0].title // empty',
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`milestone lookup failed: ${result.stderr}`);
  }
  return result.stdout.trim() || null;
}

function editIssue(repo, number, body, spawn) {
  const edit = spawn(
    "gh",
    ["issue", "edit", String(number), "--repo", repo, "--body", body],
    { encoding: "utf8" },
  );
  if (edit.status !== 0)
    throw new Error(`gh issue edit failed: ${edit.stderr}`);
}

export function main(repo = process.env.GITHUB_REPOSITORY, spawn = spawnSync) {
  if (!repo) throw new Error("repo not specified (GITHUB_REPOSITORY unset)");

  const installs = INSTALLS.map(({ dir, label }) => ({
    label,
    packages: parseOutdated(runOutdated(dir, spawn)),
  }));

  // Look the existing issue up BEFORE branching on `body`: the nothing-
  // outdated case still has to reach an open issue to clear it.
  const existing = findExistingIssue(repo, spawn);
  const body = buildIssueBody(installs);

  if (body === null) {
    if (!existing) {
      console.log(
        "dependency-refresh: nothing outdated in any install — no-op",
      );
      return;
    }
    editIssue(
      repo,
      existing.number,
      buildClearedBody(new Date().toISOString().slice(0, 10)),
      spawn,
    );
    console.log(
      `dependency-refresh: nothing outdated — cleared stale list on #${existing.number}`,
    );
    return;
  }

  if (existing) {
    editIssue(repo, existing.number, body, spawn);
    console.log(`dependency-refresh: updated existing #${existing.number}`);
    return;
  }

  const milestone = currentMilestone(repo, spawn);
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    "chore(deps): monthly dependency refresh",
    "--label",
    "v2",
    "--label",
    "chore",
    "--label",
    "dependabot",
    "--body",
    body,
  ];
  if (milestone) args.push("--milestone", milestone);

  const create = spawn("gh", args, { encoding: "utf8" });
  if (create.status !== 0)
    throw new Error(`gh issue create failed: ${create.stderr}`);
  if (!milestone) {
    // Unmilestoned means unapproved, so triage sweeps it into `Incoming` — NOT
    // `Todo`, which asserts a maintainer signed off (Copilot).
    console.log(
      "dependency-refresh: no open milestone — issue filed unmilestoned, will be swept into Incoming at next triage",
    );
  }
  console.log(`dependency-refresh: filed ${create.stdout.trim()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
