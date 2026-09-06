#!/usr/bin/env node
// Nightly MCP SDK watch (#1063).
//
// Staying abreast of SDK releases had been a manual habit rather than a
// mechanism, which is what #1063 was filed to fix. This script is the
// mechanism: once a night it compares the `@modelcontextprotocol/*` packages
// this repo installs against what the registry publishes, and files ONE
// tracking issue per upstream that is behind.
//
//   npm registry -> this sweep -> issue (labeled, milestoned) -> maintainer PR -> v2/main
//
// It is the third instance of a shape this repo already runs twice
// (`dependency-refresh.mjs`, `dependabot-alerts.mjs`) and it deliberately files
// an ISSUE rather than opening a PR, for the reason #2229 exists: a
// bot-authored PR carries no `Closes #N` and no board card, so the work is
// invisible to the project board.
//
// Four things shape the design, each verified against this repo before it was
// written:
//
//  1. **Two upstreams, not one.** `client`/`core`/`server`/`server-legacy` all
//     ship from `modelcontextprotocol/typescript-sdk` and release in lockstep;
//     `ext-apps` ships from its own repo on its own cadence. Treating them as
//     one group would file an issue naming a version that only some of the
//     packages have, so `SDK_GROUPS` keeps them separate and each gets its own
//     issue and its own marker.
//  2. **Compare the INSTALLED version, not the declared range.** #1063 phrases
//     the check as "is the current version > than the one we have in our
//     package.json", which is exact today only because the four SDK packages
//     are pinned exactly. `ext-apps` is a caret range (`^1.7.4`) whose lockfile
//     already resolves higher, so comparing against the declared string would
//     file an issue for a bump `npm install` has already taken. The declared
//     range is still reported — it is what says whether the fix is a manifest
//     edit or a lockfile refresh — but the comparison is against the lockfile.
//  3. **A new SDK package must not be watched silently by nobody.** The group
//     table is a hardcoded list, so a fifth `@modelcontextprotocol/*` package
//     added to the root manifest would never be checked and nothing would say
//     so. `assertEveryPackageWatched` turns that into a loud failure instead —
//     the sweep goes red rather than reporting a clean night over a package it
//     never looked at.
//  4. **No board write.** Both siblings want an org-project PAT for that, and
//     `PROJECT_TOKEN` is set nowhere in this org — the only org secret
//     available to this repo is `ANTHROPIC_API_KEY`. So rather than carry ~90
//     lines of placement code that cannot run (and a second copy of board
//     #28's node ids, which AGENTS.md explicitly calls worse than one), this
//     follows `dependency-refresh.mjs`: the issue is filed labeled and
//     milestoned, and the next `/issue-triage` sweep boards it. That is the
//     documented normal outcome, not a failure.
//
// ⚠️ A scheduled workflow only ever runs from the DEFAULT branch (`main`),
// while we ship from `v2/main`. So the workflow checks `v2/main` out explicitly
// and this script reads the manifests from the working tree — the same shape
// both sibling sweeps use, and the reason `TARGET_BRANCH` is named in the issue
// body rather than left for the reader to assume.
//
// Idempotency key is the marker comment at the top of each issue body, which
// names the group and the target version. A second run the same night is a
// complete no-op. A run after a FURTHER release files a new issue for the new
// target and leaves a supersession comment on the old one — it never closes it,
// because closing is a maintainer act and the board card may already have moved.
//
// The pure halves are tested directly and `main()` through an injected spawn
// function, the same way both siblings do it; `workflow_dispatch` is a
// production trigger, not a test.

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import semver from "semver";

/** The branch this repo ships from, and whose manifests are read. */
export const TARGET_BRANCH = "v2/main";

/**
 * The upstreams this sweep watches, and the packages each one publishes.
 *
 * Split by REPOSITORY rather than by npm scope: the four `typescript-sdk`
 * packages are cut from one release and always share a version, so one issue
 * covers the whole bump, while `ext-apps` moves independently and would
 * otherwise drag three unrelated packages into its title.
 */
export const SDK_GROUPS = [
  {
    key: "typescript-sdk",
    label: "MCP TypeScript SDK",
    repo: "modelcontextprotocol/typescript-sdk",
    packages: [
      "@modelcontextprotocol/client",
      "@modelcontextprotocol/core",
      "@modelcontextprotocol/server",
      "@modelcontextprotocol/server-legacy",
    ],
  },
  {
    key: "ext-apps",
    label: "MCP Apps extension SDK",
    repo: "modelcontextprotocol/ext-apps",
    packages: ["@modelcontextprotocol/ext-apps"],
  },
];

/** Every package under this prefix is in scope for the watch. */
export const SDK_SCOPE = "@modelcontextprotocol/";

const MARKER_RE = /^<!-- sdk-watch: group=(.+?); target=(.+?) -->/;

/** Marker on the comment left when a newer target supersedes an open issue. */
const SUPERSEDED_MARKER_RE = /^<!-- sdk-watch:superseded-by (.+?) -->/;

/**
 * The issue body's first line: the idempotency key.
 *
 * Keyed on `(group, target)` rather than group alone, so a second release
 * during the same milestone files its own issue instead of silently matching
 * the first and leaving the sweep reporting a bump nobody was told about.
 *
 * @param {{key: string}} group
 * @param {string} target the version being upgraded TO
 * @returns {string}
 */
export function buildMarker(group, target) {
  return `<!-- sdk-watch: group=${group.key}; target=${target} -->`;
}

/**
 * Read a marker back off an issue body.
 *
 * @param {string | undefined} body
 * @returns {{key: string, target: string} | null}
 */
export function parseMarker(body) {
  const match = MARKER_RE.exec(body ?? "");
  return match ? { key: match[1], target: match[2] } : null;
}

/**
 * @param {string | undefined} body
 * @returns {string | null} the issue number a supersession comment already named
 */
export function parseSupersededMarker(body) {
  const match = SUPERSEDED_MARKER_RE.exec(body ?? "");
  return match ? match[1] : null;
}

/**
 * Fail loudly when the root manifest declares an SDK package no group watches.
 *
 * The group table is hardcoded, so an added fifth package would be checked by
 * nobody and the sweep would still print a clean result — a silent blind spot
 * in the one mechanism that exists to remove a silent blind spot. Throwing
 * turns "we forgot to add it here" into a red run on the next night.
 *
 * @param {Record<string, string> | undefined} dependencies the root manifest's `dependencies`
 * @throws when an in-scope package is not named in `SDK_GROUPS`
 */
export function assertEveryPackageWatched(dependencies) {
  const watched = new Set(SDK_GROUPS.flatMap((g) => g.packages));
  const unwatched = Object.keys(dependencies ?? {})
    .filter((name) => name.startsWith(SDK_SCOPE))
    .filter((name) => !watched.has(name))
    .sort();
  if (unwatched.length > 0) {
    throw new Error(
      `root package.json declares SDK package(s) no group in SDK_GROUPS watches: ${unwatched.join(", ")} — add them to a group, or this sweep silently never checks them`,
    );
  }
}

/**
 * The version actually installed, per the lockfile.
 *
 * Reads the HOISTED path only. A nested copy of an SDK package would be a
 * duplicate install and a different problem entirely (`verify:dep-lockstep`
 * territory); this sweep asks the narrower question of what the root install
 * resolves to, and answering it from a nested copy would report a version no
 * client actually loads.
 *
 * @param {object} lock parsed `package-lock.json`
 * @param {string} pkg
 * @returns {string | null} `null` when the package is not installed at all
 */
export function installedVersion(lock, pkg) {
  return lock?.packages?.[`node_modules/${pkg}`]?.version ?? null;
}

/**
 * Decide whether one group is behind, and by how much.
 *
 * `target` is the HIGHEST latest among the packages that are actually behind,
 * rather than any single package's. The four `typescript-sdk` packages are
 * published from one release and normally agree, but a partially-published
 * release (one package live, three still uploading) would otherwise put a lower
 * version in the title than the issue's own table shows.
 *
 * @param {typeof SDK_GROUPS[number]} group
 * @param {Record<string, {declared?: string | null, installed?: string | null, latest?: string | null}>} versions
 * @returns {{group: typeof SDK_GROUPS[number], rows: Array<{name: string, declared: string, installed: string, latest: string, behind: boolean}>, target: string} | null}
 *   `null` when every package in the group is current
 */
export function groupState(group, versions) {
  const rows = group.packages.map((name) => {
    const {
      declared = null,
      installed = null,
      latest = null,
    } = versions[name] ?? {};
    const behind = Boolean(installed && latest && semver.gt(latest, installed));
    return {
      name,
      declared: declared ?? "(undeclared)",
      installed: installed ?? "(not installed)",
      latest: latest ?? "(unknown)",
      behind,
    };
  });

  const behindRows = rows.filter((r) => r.behind);
  if (behindRows.length === 0) return null;

  const target = behindRows.map((r) => r.latest).sort(semver.rcompare)[0];
  return { group, rows, target };
}

/**
 * @param {NonNullable<ReturnType<typeof groupState>>} state
 * @returns {string}
 */
export function buildIssueTitle(state) {
  return `chore(deps): upgrade the ${state.group.label} to ${state.target}`;
}

const cell = (value) => String(value).replace(/\|/g, "\\|");

/**
 * @param {NonNullable<ReturnType<typeof groupState>>} state
 * @returns {string}
 */
export function buildIssueBody(state) {
  const { group, rows, target } = state;
  const table = rows
    .map(
      (r) =>
        `| \`${cell(r.name)}\` | ${cell(r.declared)} | ${cell(r.installed)} | ${cell(r.latest)} | ${r.behind ? "**yes**" : "no"} |`,
    )
    .join("\n");

  return [
    buildMarker(group, target),
    `A new **${group.label}** release is out. What is installed on \`${TARGET_BRANCH}\` is behind what the npm registry publishes.`,
    "",
    `| Package | Declared | Installed on \`${TARGET_BRANCH}\` | Latest on npm | Behind |`,
    "| --- | --- | --- | --- | --- |",
    table,
    "",
    `Release notes: https://github.com/${group.repo}/releases`,
    "",
    "### Why this is an issue and not a PR",
    "",
    "Filed by the nightly SDK watch (#1063), the third of this repo's issue-filing sweeps alongside the monthly dependency refresh (#2229) and the daily Dependabot alert sweep (#2233). None of them opens a PR: a bot-authored PR carries no `Closes #N` and no board card, so the work would be invisible to the board. A maintainer picks this up and opens a normal PR against `v2/main`.",
    "",
    "### Upgrade checklist",
    "",
    "- [ ] Bump the version(s) in the **repo-root** `package.json` — every runtime dependency `core/` imports is declared there and nowhere else ([Dependency placement](https://github.com/modelcontextprotocol/inspector/blob/v2/main/AGENTS.md#dependency-placement)). The four `typescript-sdk` packages are pinned **exactly**, so they move together.",
    "- [ ] `npm install` at the root, and commit the refreshed lockfile.",
    "- [ ] Re-check the bundler `external` lists (`clients/{cli,tui}/tsup.config.ts`, `clients/web/tsup.runner.config.ts`) if the release adds or renames an entry point; `npm run verify:bundle-externals` enforces this against the built output.",
    "- [ ] `npm run format`, then `npm run local:gate`.",
    "",
    "An automated review of what actually changed upstream — and which parts of this app it touches — is posted as a comment below.",
    "",
    "A later run of this sweep will not refile this issue. A **further** SDK release files its own issue and leaves a supersession note here rather than editing this one.",
  ].join("\n");
}

/**
 * The comment left on an open issue whose target a newer release has passed.
 *
 * It does not close anything: the board card may already have moved, and
 * closing an issue this sweep cannot verify shipped would make the board claim
 * work landed that did not. A maintainer closes it.
 *
 * @param {number} newer the issue number covering the newer target
 * @param {string} newerTarget
 * @param {string} staleTarget
 * @returns {string}
 */
export function buildSupersededComment(newer, newerTarget, staleTarget) {
  return [
    `<!-- sdk-watch:superseded-by ${newer} -->`,
    `Superseded by #${newer}: the upstream has since released **${newerTarget}**, so upgrading to ${staleTarget} is no longer the current target.`,
    "",
    "Left open rather than closed — this sweep does not close issues, since the board card may already have moved and it cannot verify what shipped. Close this one by hand if nothing here is still worth keeping.",
  ].join("\n");
}

/**
 * The nearest-due open milestone.
 *
 * An undated bucket has no due date and so cannot be the nearest; it is dropped
 * rather than sorted last, and if nothing dated is open the issue is filed
 * unmilestoned and triage places it into `Incoming`.
 *
 * @param {Array<{title: string, state?: string, due_on?: string | null}>} milestones
 * @returns {string | null}
 */
export function pickMilestone(milestones) {
  const dated = (milestones ?? []).filter(
    (m) => (m.state ?? "open") === "open" && m.due_on,
  );
  if (dated.length === 0) return null;
  return dated.sort((a, b) => a.due_on.localeCompare(b.due_on))[0].title;
}

/**
 * The `$GITHUB_OUTPUT` line naming what was filed this run.
 *
 * Only NEWLY CREATED issues appear here. That is what keeps the analysis job
 * downstream to exactly one run per SDK version: an issue that already existed
 * has already been analyzed, and re-running Opus against it nightly would add a
 * near-identical comment every single night.
 *
 * @param {Array<{issue: number, label: string, repo: string, from: string, to: string}>} filed
 * @returns {string}
 */
export function formatFiledOutput(filed) {
  return `filed=${JSON.stringify(filed)}`;
}

// ---------------------------------------------------------------------------
// Impure half: everything below shells out to `npm` or `gh`. Each takes its
// spawn function as a parameter, defaulted to `spawnSync`, so `main()` is
// testable with an injected fake — the same shape both sibling sweeps use.
// ---------------------------------------------------------------------------

function latestVersion(pkg, spawn) {
  const result = spawn("npm", ["view", pkg, "version"], { encoding: "utf8" });
  if (result.error) throw result.error;
  // A non-zero exit MUST throw. `npm view` also prints nothing to stdout on
  // failure, so treating it as "no newer version" would turn a registry outage
  // into a clean all-current report — the silent all-clear this sweep exists to
  // prevent. The same reasoning covers an unparseable version below: `latest`
  // feeds a `semver.gt`, which answers `false` for garbage rather than throwing.
  if (result.status !== 0) {
    throw new Error(
      `npm view ${pkg} failed (exit ${result.status}): ${(result.stderr ?? "").trim()}`,
    );
  }
  const version = (result.stdout ?? "").trim();
  if (!semver.valid(version)) {
    throw new Error(
      `npm view ${pkg} returned an unusable version: "${version}"`,
    );
  }
  return version;
}

function gh(spawn, args) {
  const result = spawn("gh", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

/**
 * Every issue this sweep has ever filed, open or closed.
 *
 * `--state all` is deliberate: an issue closed as "not planned" must keep
 * suppressing its target, or the sweep refiles it the very next night and every
 * night after — turning a maintainer's decision into a nightly argument.
 */
function sweepIssues(repo, spawn) {
  const result = gh(spawn, [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--search",
    "sdk-watch in:body",
    "--json",
    "number,body,state",
    "--limit",
    "100",
  ]);
  if (result.status !== 0) {
    throw new Error(`gh issue list failed: ${(result.stderr ?? "").trim()}`);
  }
  return JSON.parse(result.stdout || "[]")
    .map((issue) => ({ ...issue, marker: parseMarker(issue.body) }))
    .filter((issue) => issue.marker);
}

function currentMilestone(repo, spawn) {
  const result = gh(spawn, ["api", `repos/${repo}/milestones?state=open`]);
  if (result.status !== 0) {
    throw new Error(`milestone lookup failed: ${(result.stderr ?? "").trim()}`);
  }
  return pickMilestone(JSON.parse(result.stdout || "[]"));
}

function issueComments(repo, number, spawn) {
  const result = gh(spawn, [
    "api",
    "--paginate",
    `repos/${repo}/issues/${number}/comments`,
    "--jq",
    ".[].body",
  ]);
  if (result.status !== 0) {
    throw new Error(
      `comment lookup for #${number} failed: ${(result.stderr ?? "").trim()}`,
    );
  }
  return (result.stdout ?? "").split("\n").filter(Boolean);
}

function comment(repo, number, body, spawn) {
  const result = gh(spawn, [
    "issue",
    "comment",
    String(number),
    "--repo",
    repo,
    "--body",
    body,
  ]);
  if (result.status !== 0) {
    throw new Error(`gh issue comment failed: ${(result.stderr ?? "").trim()}`);
  }
}

function createIssue(repo, state, milestone, spawn) {
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    buildIssueTitle(state),
    "--label",
    "v2",
    "--label",
    "chore",
    "--label",
    "dependencies",
    "--body",
    buildIssueBody(state),
  ];
  if (milestone) args.push("--milestone", milestone);
  const result = gh(spawn, args);
  if (result.status !== 0) {
    throw new Error(`gh issue create failed: ${(result.stderr ?? "").trim()}`);
  }
  const url = result.stdout.trim();
  const number = Number(url.split("/").pop());
  if (!Number.isInteger(number)) {
    throw new Error(`could not read an issue number out of "${url}"`);
  }
  return { url, number };
}

export function main(
  repo = process.env.GITHUB_REPOSITORY,
  spawn = spawnSync,
  {
    readFile = (path) => readFileSync(path, "utf8"),
    output = process.env.GITHUB_OUTPUT,
  } = {},
) {
  if (!repo) throw new Error("repo not specified (GITHUB_REPOSITORY unset)");

  const manifest = JSON.parse(readFile("package.json"));
  const lock = JSON.parse(readFile("package-lock.json"));
  assertEveryPackageWatched(manifest.dependencies);

  const versions = {};
  for (const pkg of SDK_GROUPS.flatMap((g) => g.packages)) {
    versions[pkg] = {
      declared: manifest.dependencies?.[pkg] ?? null,
      installed: installedVersion(lock, pkg),
      latest: latestVersion(pkg, spawn),
    };
  }

  const states = SDK_GROUPS.map((group) => groupState(group, versions)).filter(
    Boolean,
  );

  const emit = (filed) => {
    if (output) appendFileSync(output, `${formatFiledOutput(filed)}\n`);
  };

  if (states.length === 0) {
    console.log("sdk-watch: every MCP SDK package is current — no-op");
    emit([]);
    return;
  }

  // One lookup covers every group; filed issues are matched client-side.
  const existing = sweepIssues(repo, spawn);
  const filed = [];

  for (const state of states) {
    const forGroup = existing.filter((i) => i.marker.key === state.group.key);
    if (forGroup.some((i) => i.marker.target === state.target)) {
      console.log(
        `sdk-watch: ${state.group.label} ${state.target} already has an issue — no-op`,
      );
      continue;
    }

    const milestone = currentMilestone(repo, spawn);
    const created = createIssue(repo, state, milestone, spawn);
    console.log(`sdk-watch: filed ${created.url}`);
    if (!milestone) {
      // Unmilestoned means unapproved, so triage sweeps it into `Incoming` —
      // NOT `Todo`, which asserts a maintainer signed off.
      console.log(
        "sdk-watch: no dated open milestone — filed unmilestoned, triage will place it in Incoming",
      );
    }

    // Any OPEN issue of this group on an older target is now stale. Note it
    // there rather than closing it; see `buildSupersededComment`.
    for (const stale of forGroup) {
      if (stale.state !== "OPEN") continue;
      if (!semver.lt(stale.marker.target, state.target)) continue;
      const announced = issueComments(repo, stale.number, spawn).some(
        (body) => parseSupersededMarker(body) === String(created.number),
      );
      if (announced) continue;
      comment(
        repo,
        stale.number,
        buildSupersededComment(
          created.number,
          state.target,
          stale.marker.target,
        ),
        spawn,
      );
      console.log(
        `sdk-watch: noted #${created.number} supersedes #${stale.number}`,
      );
    }

    filed.push({
      issue: created.number,
      label: state.group.label,
      repo: state.group.repo,
      from: state.rows.find((r) => r.behind).installed,
      to: state.target,
    });
  }

  emit(filed);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
