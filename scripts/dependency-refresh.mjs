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
// `parseOutdated` and `buildIssueBody` are pure and covered by
// `dependency-refresh.test.mjs`; `main()` is the CLI entry point, exercised
// against the real repo only via `workflow_dispatch` in CI, not by the test
// suite (it shells out to `npm outdated` and `gh`, per the workflow-script
// convention `verify-skills.mjs` and its siblings already use).

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

function runOutdated(dir) {
  const result = spawnSync("npm", ["outdated", "--json"], {
    cwd: dir,
    encoding: "utf8",
  });
  // `npm outdated` exits 1 when it finds anything outdated — that is not a
  // failure of the command, only stderr / a thrown parse is.
  if (result.error) throw result.error;
  return result.stdout ?? "";
}

function findExistingIssue(repo) {
  const result = spawnSync(
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

function currentMilestone(repo) {
  const result = spawnSync(
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

export function main(repo = process.env.GITHUB_REPOSITORY) {
  if (!repo) throw new Error("repo not specified (GITHUB_REPOSITORY unset)");

  const installs = INSTALLS.map(({ dir, label }) => ({
    label,
    packages: parseOutdated(runOutdated(dir)),
  }));

  const body = buildIssueBody(installs);
  if (body === null) {
    console.log("dependency-refresh: nothing outdated in any install — no-op");
    return;
  }

  const existing = findExistingIssue(repo);
  if (existing) {
    const edit = spawnSync(
      "gh",
      [
        "issue",
        "edit",
        String(existing.number),
        "--repo",
        repo,
        "--body",
        body,
      ],
      { encoding: "utf8" },
    );
    if (edit.status !== 0)
      throw new Error(`gh issue edit failed: ${edit.stderr}`);
    console.log(`dependency-refresh: updated existing #${existing.number}`);
    return;
  }

  const milestone = currentMilestone(repo);
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

  const create = spawnSync("gh", args, { encoding: "utf8" });
  if (create.status !== 0)
    throw new Error(`gh issue create failed: ${create.stderr}`);
  if (!milestone) {
    console.log(
      "dependency-refresh: no open milestone — issue filed unmilestoned, will be swept into Todo at next triage",
    );
  }
  console.log(`dependency-refresh: filed ${create.stdout.trim()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
