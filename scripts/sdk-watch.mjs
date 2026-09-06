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
 * The marker the workflow's posting step puts on the analysis comment.
 *
 * ⚠️ **This string also appears in `.github/workflows/sdk-watch.yml`** and the
 * two must agree, or every issue looks permanently unanalyzed and the sweep
 * re-queues it every night. `sdk-watch.test.mjs` asserts the workflow file
 * contains this exact constant, so the pair cannot drift silently.
 *
 * It exists because "an issue for this target exists" and "that issue has been
 * analyzed" are different claims, and the sweep used to equate them: a transient
 * failure in the `analyze` job left an issue nothing would ever revisit, and the
 * next night reported a green no-op over it (Copilot).
 */
export const ANALYSIS_MARKER = "<!-- sdk-watch:analysis -->";

/**
 * The account this sweep's own issues and comments are written by.
 *
 * ⚠️ **This repository is PUBLIC, so a marker is not evidence of anything on its
 * own.** Anyone can open an issue or write a comment whose body starts with any
 * string they like, and every marker here is load-bearing for automation
 * (Copilot). Left untrusted, an outsider could:
 *
 *  * file an issue carrying the current target's marker — and close it — to
 *    suppress the real upgrade issue indefinitely;
 *  * post `<!-- sdk-watch:analysis -->` as a comment to suppress analysis
 *    retries forever;
 *  * forge a supersession marker so the genuine note is never posted.
 *
 * So a marker counts only when the thing carrying it was written by this
 * automation. `gh issue list --json author` reports a bot with the `[bot]`
 * suffix stripped and `is_bot: true`, while the REST comments endpoint reports
 * `github-actions[bot]` with `type: "Bot"` — hence the normalization in both
 * predicates rather than one spelling assumed.
 */
export const AUTOMATION_LOGIN = "github-actions";

/** Labels every issue this sweep files carries; an outsider cannot set them. */
export const SWEEP_LABELS = ["chore", "dependencies"];

const normalizeLogin = (login) =>
  String(login ?? "")
    .toLowerCase()
    .replace(/\[bot\]$/, "");

/**
 * Was this issue actually filed by the sweep, rather than merely shaped like it?
 *
 * Requires BOTH the automation author and the labels the sweep applies. The
 * labels are the stronger half in practice: the issue forms in
 * `.github/ISSUE_TEMPLATE/` apply `bug`/`enhancement` and `v2`, and setting
 * `chore` or `dependencies` needs write access, so a drive-by cannot fake one
 * even from an account named to look official.
 *
 * @param {{author?: {login?: string, is_bot?: boolean}, labels?: Array<{name?: string}>}} issue
 * @returns {boolean}
 */
export function isSweepAuthored(issue) {
  if (normalizeLogin(issue?.author?.login) !== AUTOMATION_LOGIN) return false;
  // `is_bot` is absent on some `gh` versions; only an explicit `false` — a human
  // account that happens to carry the name — is disqualifying.
  if (issue?.author?.is_bot === false) return false;
  const names = new Set((issue?.labels ?? []).map((l) => l?.name));
  return SWEEP_LABELS.every((label) => names.has(label));
}

/**
 * Was this comment written by the automation?
 *
 * @param {{author?: string, isBot?: boolean}} comment
 * @returns {boolean}
 */
export function isAutomationComment(comment) {
  return (
    normalizeLogin(comment?.author) === AUTOMATION_LOGIN &&
    comment?.isBot !== false
  );
}

/**
 * Has this issue already been given its automated analysis?
 *
 * Only a comment the automation wrote counts — see `AUTOMATION_LOGIN`. A comment
 * from anyone else that happens to start with the marker is ordinary text.
 *
 * @param {Array<{author?: string, isBot?: boolean, body?: string}>} comments
 * @returns {boolean}
 */
export function hasAnalysis(comments) {
  return comments.some(
    (c) =>
      isAutomationComment(c) && (c?.body ?? "").startsWith(ANALYSIS_MARKER),
  );
}

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
 * ⚠️ **`target` is the LOWEST latest across the group — the highest version the
 * WHOLE group has reached — not the highest.** For a single-package group the
 * two are the same; for a lockstep group they differ exactly during a partial
 * publication, and taking the highest is wrong twice over (Copilot).
 *
 * npm publishes a release one package at a time, so a sweep landing mid-publish
 * sees, say, `client@2.2.0` beside three packages still at 2.1.0. Targeting 2.2.0
 * then tells maintainers to move all four to a version three of them do not
 * have — and, worse, writes a `target=2.2.0` marker that **suppresses the real
 * filing** once the publication completes, so the release is never tracked at
 * all. Targeting the minimum is right on both counts: 2.1.0 is a version every
 * package genuinely has, and when the publish finishes the minimum becomes
 * 2.2.0, which is a new marker and a new issue.
 *
 * It also avoids the blind spot that simply *skipping* a disagreeing group
 * would create: if we are on 2.0.0 the sweep still files an actionable 2.1.0
 * issue tonight rather than staying silent, and if we are already on 2.1.0
 * nothing is behind and it correctly waits.
 *
 * `behind` is therefore measured against `target`, not against each package's
 * own `latest` — a package whose latest is ahead of the target is not something
 * this issue asks anyone to do.
 *
 * @param {typeof SDK_GROUPS[number]} group
 * @param {Record<string, {declared?: string | null, installed?: string | null, latest?: string | null}>} versions
 * @returns {{group: typeof SDK_GROUPS[number], rows: Array<{name: string, declared: string, installed: string, latest: string, behind: boolean}>, target: string} | null}
 *   `null` when the group is current, or when any package's latest is unknown
 */
export function groupState(group, versions) {
  const latests = group.packages.map((name) => versions[name]?.latest ?? null);
  // One unreadable `latest` makes the group's shared version unknowable, and a
  // guess here would be a version claim nobody checked. `main` already throws on
  // a registry failure; this is the belt to that braces.
  if (latests.some((v) => !v)) return null;

  const target = [...latests].sort(semver.compare)[0];

  const rows = group.packages.map((name) => {
    const {
      declared = null,
      installed = null,
      latest = null,
    } = versions[name] ?? {};
    return {
      name,
      declared: declared ?? "(undeclared)",
      installed: installed ?? "(not installed)",
      latest: latest ?? "(unknown)",
      behind: Boolean(installed && semver.gt(target, installed)),
    };
  });

  if (!rows.some((r) => r.behind)) return null;
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
 * Does adopting `target` require editing the root manifest, or only the lockfile?
 *
 * ⚠️ Not every bump is a manifest edit, and saying so unconditionally was wrong
 * for the very case this script exists to handle separately (Copilot). The four
 * `typescript-sdk` packages are pinned **exactly**, so any new version needs the
 * manifest changed. `ext-apps` is a **range** (`^1.7.4`), so a 1.8.0 target is
 * already satisfied by what `package.json` says and only `npm install` is needed
 * — telling a maintainer to edit the manifest there sends them to change a line
 * that is already correct.
 *
 * A row whose declared value is not a parseable range (an unparsed dependency,
 * or the `(undeclared)` placeholder) counts as needing the edit: that is the
 * conservative direction, since it asks for a look rather than asserting none is
 * required.
 *
 * @param {Array<{declared: string, behind: boolean}>} rows
 * @param {string} target
 * @returns {boolean}
 */
export function needsManifestEdit(rows, target) {
  return rows
    .filter((r) => r.behind)
    .some(
      (r) =>
        !semver.validRange(r.declared) || !semver.satisfies(target, r.declared),
    );
}

/**
 * The first checklist items, which differ by the answer above.
 *
 * @param {Array<{declared: string, behind: boolean}>} rows
 * @param {string} target
 * @returns {string[]}
 */
export function manifestChecklist(rows, target) {
  const placement =
    "every runtime dependency `core/` imports is declared in the **repo-root** `package.json` and nowhere else ([Dependency placement](https://github.com/modelcontextprotocol/inspector/blob/v2/main/AGENTS.md#dependency-placement))";
  return needsManifestEdit(rows, target)
    ? [
        `- [ ] Bump the version(s) in the repo-root \`package.json\` — ${placement}. The four \`typescript-sdk\` packages are pinned **exactly**, so they move together.`,
        "- [ ] `npm install` at the root, and commit the refreshed lockfile.",
      ]
    : [
        `- [ ] **No manifest edit needed** — the declared range already admits ${target}, so this is a lockfile refresh. (${placement}, so if that ever stops being true the bump belongs there.)`,
        "- [ ] `npm install` at the root, and commit the refreshed lockfile.",
      ];
}

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
    // Only when a partial publication is in flight, so the reader is not left
    // wondering why the target is below a `Latest` the table plainly shows.
    ...(rows.some((r) => r.latest !== target)
      ? [
          `> **Note.** One or more packages above show a \`Latest\` newer than the **${target}** this issue targets. These packages release in lockstep and npm publishes them one at a time, so that is a publication still in flight. **${target}** is the newest version the whole group has actually reached, which is what makes it the actionable target. When the newer release finishes publishing, the next sweep files its own issue for it.`,
          "",
        ]
      : []),
    `Release notes: https://github.com/${group.repo}/releases`,
    "",
    "### Why this is an issue and not a PR",
    "",
    "Filed by the nightly SDK watch (#1063), the third of this repo's issue-filing sweeps alongside the monthly dependency refresh (#2229) and the daily Dependabot alert sweep (#2233). None of them opens a PR: a bot-authored PR carries no `Closes #N` and no board card, so the work would be invisible to the board. A maintainer picks this up and opens a normal PR against `v2/main`.",
    "",
    "### Upgrade checklist",
    "",
    ...manifestChecklist(rows, target),
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
 * What appears here is every issue this run created, plus any OPEN issue it had
 * already filed that still carries no analysis comment. The second half is the
 * retry path for an `analyze` job that failed or timed out.
 *
 * What is deliberately absent is an issue that already HAS its analysis — that
 * is what keeps the job downstream to a single run per SDK version rather than a
 * near-identical comment every night for as long as the issue stays open. A
 * CLOSED issue is absent too, for the stronger reason that closing it was a
 * decision and re-analyzing it nightly would re-argue that decision.
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
    "number,body,state,author,labels",
    "--limit",
    "100",
  ]);
  if (result.status !== 0) {
    throw new Error(`gh issue list failed: ${(result.stderr ?? "").trim()}`);
  }
  return JSON.parse(result.stdout || "[]")
    .filter(isSweepAuthored)
    .map((issue) => ({ ...issue, marker: parseMarker(issue.body) }))
    .filter((issue) => issue.marker && semver.valid(issue.marker.target));
}

function currentMilestone(repo, spawn) {
  const result = gh(spawn, ["api", `repos/${repo}/milestones?state=open`]);
  if (result.status !== 0) {
    throw new Error(`milestone lookup failed: ${(result.stderr ?? "").trim()}`);
  }
  return pickMilestone(JSON.parse(result.stdout || "[]"));
}

/**
 * Every comment body on an issue, as WHOLE strings.
 *
 * ⚠️ This used to be `--jq '.[].body'` split on newlines, which destroyed the
 * comment boundaries: a body is multi-line, so every LINE became its own array
 * element. Both callers then read a line as if it were a comment, and both
 * checks are `startsWith` — so a maintainer who quoted `<!-- sdk-watch:analysis
 * -->` at the start of any line of any comment would have permanently convinced
 * the sweep that issue was analyzed, and the retry would never fire again
 * (Copilot). The same held for the supersession marker.
 *
 * `--slurp` returns one array per page, hence the `flat()`. It cannot be
 * combined with `--jq` — `gh` rejects the pair outright — which is exactly why
 * the parsing moved here.
 *
 * ⚠️ It keeps the AUTHOR, not just the body. Reducing a comment to its text
 * discards the only thing that makes its marker trustworthy — this repo is
 * public, so any commenter could otherwise forge one (Copilot). See
 * `AUTOMATION_LOGIN`.
 *
 * @returns {Array<{author: string, isBot: boolean, body: string}>} one per comment
 */
function issueComments(repo, number, spawn) {
  const result = gh(spawn, [
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/issues/${number}/comments`,
  ]);
  if (result.status !== 0) {
    throw new Error(
      `comment lookup for #${number} failed: ${(result.stderr ?? "").trim()}`,
    );
  }
  const pages = JSON.parse(result.stdout || "[]");
  return pages.flat().map((c) => ({
    author: c?.user?.login ?? "",
    isBot: c?.user?.type === "Bot",
    body: c?.body ?? "",
  }));
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
  const failures = [];

  // ⚠️ Creating an issue is IRREVERSIBLE and everything after it is fallible.
  // Letting a later failure propagate out of this loop would skip the `emit`
  // below, so the created issue would never reach the analysis job — and the
  // next night's retry would find its own marker, treat it as already handled,
  // and emit `[]`. The issue would then exist, permanently, with no analysis
  // and nothing left to notice (Copilot). So each group is isolated, `filed` is
  // appended to the moment an issue exists, and the emit happens in a `finally`
  // — the run still fails afterwards, loudly, but never at the cost of losing a
  // record of what it created.
  try {
    for (const state of states) {
      const forGroup = existing.filter((i) => i.marker.key === state.group.key);
      const match = forGroup.find((i) => i.marker.target === state.target);

      try {
        /** Queue an issue number for the analysis job. */
        const record = (issue) =>
          filed.push({
            issue,
            label: state.group.label,
            repo: state.group.repo,
            from: state.rows.find((r) => r.behind).installed,
            to: state.target,
          });

        // ⚠️ An existing issue for this target used to `continue` outright,
        // which quietly made two unrelated claims one claim (Copilot). It meant
        // the sweep could never retry a failed analysis, and it meant a
        // supersession note that failed to post was never posted, because the
        // retry matched here and skipped the reconciliation below. So the
        // existing issue is adopted rather than skipped, and both pieces of
        // follow-up work run against its number exactly as they would a new one.
        let number;
        if (match) {
          number = match.number;
        } else {
          const milestone = currentMilestone(repo, spawn);
          const created = createIssue(repo, state, milestone, spawn);
          number = created.number;
          record(number); // Before further fallible work, for the reason above.
          console.log(`sdk-watch: filed ${created.url}`);
          if (!milestone) {
            // Unmilestoned means unapproved, so triage sweeps it into
            // `Incoming` — NOT `Todo`, which asserts a maintainer signed off.
            console.log(
              "sdk-watch: no dated open milestone — filed unmilestoned, triage will place it in Incoming",
            );
          }
        }

        // "An issue exists" is not "the issue was analyzed". The `analyze` job
        // can fail or time out, and equating the two left the promised analysis
        // silently never retried. A newly created issue has no comments, so
        // this only costs a lookup on the adopted path.
        //
        // ⚠️ OPEN only. `sweepIssues` deliberately reads `--state all`, because a
        // CLOSED issue must keep suppressing its target — that is how a
        // maintainer's "not planned" survives instead of being re-argued nightly.
        // Re-queuing on state alone would have undone exactly that: the closed
        // issue has no analysis marker, so it would be handed to the analyze job
        // and receive a fresh automated comment every night (Copilot). Suppress
        // and re-queue are different questions about the same match.
        if (match && match.state === "OPEN") {
          if (hasAnalysis(issueComments(repo, number, spawn))) {
            console.log(
              `sdk-watch: ${state.group.label} ${state.target} already has an issue and an analysis — no-op`,
            );
          } else {
            record(number);
            console.log(
              `sdk-watch: #${number} has no analysis comment — re-queuing it for the analyze job`,
            );
          }
        } else if (match) {
          console.log(
            `sdk-watch: ${state.group.label} ${state.target} was filed as #${number} and closed — leaving it alone`,
          );
        }

        // Any OPEN issue of this group on an older target is now stale. Note it
        // there rather than closing it; see `buildSupersededComment`. Runs on
        // the adopted path too, so a comment that failed to post gets another
        // chance — the marker check below is what keeps that from duplicating.
        for (const stale of forGroup) {
          if (stale.number === number) continue;
          if (stale.state !== "OPEN") continue;
          if (!semver.lt(stale.marker.target, state.target)) continue;
          // Only the automation's own note counts as "already announced" — a
          // forged one from any commenter would otherwise suppress the real one.
          const announced = issueComments(repo, stale.number, spawn).some(
            (c) =>
              isAutomationComment(c) &&
              parseSupersededMarker(c.body) === String(number),
          );
          if (announced) continue;
          comment(
            repo,
            stale.number,
            buildSupersededComment(number, state.target, stale.marker.target),
            spawn,
          );
          console.log(
            `sdk-watch: noted #${number} supersedes #${stale.number}`,
          );
        }
      } catch (error) {
        // One group's failure must not cost another group its issue.
        failures.push(`${state.group.label}: ${error.message}`);
        console.error(
          `sdk-watch: ${state.group.label} failed — ${error.message}`,
        );
      }
    }
  } finally {
    emit(filed);
  }

  if (failures.length > 0) {
    throw new Error(
      `sdk-watch: ${failures.length} group(s) failed — ${failures.join("; ")}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
