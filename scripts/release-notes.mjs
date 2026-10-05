#!/usr/bin/env node
// Assemble a release's notes and create the GitHub Release (#2550) —
// `npm run release:notes -- --merge-branch <b> --ledger-url <u> [...]`.
// The recipe the release skill's step 3a previously transcribed inline.
//
// The notes are four parts, in this order: GitHub's generated "What's
// Changed" list (the same `releases/generate-notes` API the UI button uses),
// the smoke-ledger line, a `## Known issue(s)` section from what the
// maintainer passes in (a judgment call, so never generated), and a
// `## Thanks for helping us improve` section crediting the community members
// whose issues the listed PRs close. GitHub adds everyone `@`-mentioned in a
// release body to its Contributors strip, so that section is what puts the
// reporters there.
//
// FAIL FAST. Every `gh`/`git` call is checked and a failure throws: a
// permission lookup that errors must never read as "community" (that could
// credit a maintainer), and a rate-limited PR or issue lookup must never be
// silently skipped (that would publish a partial Thanks list). A permission
// value outside the known set throws for the same reason.
//
// The default run is a PREVIEW that prints the notes and creates nothing.
// Publishing the Release triggers `package` → `publish` (npm) and the GHCR
// image, so it is never implicit: `--draft` creates a draft for review and
// `--publish` publishes. Both pass the bare `x.y.z` tag and `--target main`,
// and both refuse unless that version is the one on origin/main.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { versionFrom } from "./release-tag.mjs";

export const REPO = "modelcontextprotocol/inspector";
const [OWNER, NAME] = REPO.split("/");

// What `collaborators/{user}/permission` reports in its `permission` field.
// A public repo reports `read` for anyone without a role, so a community
// member is `read` (or `triage`/`none`), and a maintainer is anyone above it.
const MAINTAINER_PERMISSIONS = new Set(["admin", "maintain", "write"]);
const COMMUNITY_PERMISSIONS = new Set(["triage", "read", "none"]);

export const THANKS_LEAD_IN =
  "This release addresses issues reported by these community members. Thank you for taking the time to file them:";

export function parseNotesArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "merge-branch": { type: "string" },
      "ledger-url": { type: "string" },
      "known-issue": { type: "string", multiple: true },
      version: { type: "string" },
      "previous-tag": { type: "string" },
      draft: { type: "boolean" },
      publish: { type: "boolean" },
    },
  });
  const mergeBranch = values["merge-branch"];
  const ledgerUrl = values["ledger-url"];
  if (!mergeBranch || !ledgerUrl) {
    throw new Error("--merge-branch and --ledger-url are both required");
  }
  if (!/^https:\/\/\S+$/.test(ledgerUrl)) {
    throw new Error(`--ledger-url "${ledgerUrl}" is not an https URL`);
  }
  for (const [flag, tag] of [
    ["--version", values.version],
    ["--previous-tag", values["previous-tag"]],
  ]) {
    if (tag !== undefined && !isStableTag(tag)) {
      throw new Error(`${flag} "${tag}" is not a bare x.y.z`);
    }
  }
  if (values.draft && values.publish) {
    throw new Error("--draft and --publish are mutually exclusive");
  }
  // A Release created here always starts from the previous stable tag; an
  // override (a typo, a stale value) would publish the wrong range of
  // changes and credits, so it is a preview-only knob like --version.
  if ((values.draft || values.publish) && values["previous-tag"]) {
    throw new Error("--previous-tag is preview-only");
  }
  return {
    mergeBranch,
    ledgerUrl,
    knownIssues: values["known-issue"] ?? [],
    version: values.version,
    previousTag: values["previous-tag"],
    mode: values.publish ? "publish" : values.draft ? "draft" : "preview",
  };
}

function run(spawn, cmd, args, input) {
  const result = spawn(cmd, args, { encoding: "utf8", input });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`,
    );
  }
  return (result.stdout ?? "").trim();
}

function graphql(spawn, query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    // -F types a number as Int; -f keeps a cursor a String.
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  const response = JSON.parse(run(spawn, "gh", args));
  if (response.errors?.length) {
    throw new Error(`gh api graphql: ${JSON.stringify(response.errors)}`);
  }
  return response.data;
}

export function isStableTag(tag) {
  return /^\d+\.\d+\.\d+$/.test(tag);
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * The highest STABLE tag below `version`. Whole-name match: this repo also
 * has 2.0.0-rc.N, x.y.z-hotfix, x.y.z-amended and v2-alpha-1 tags, and
 * picking one of those as the previous tag would drop changes from the list.
 */
export function previousStableTag(tags, version) {
  const below = tags
    .filter(isStableTag)
    .filter((tag) => compareVersions(tag, version) < 0)
    .sort(compareVersions);
  if (below.length === 0) {
    throw new Error(`no stable x.y.z tag below ${version}`);
  }
  return below[below.length - 1];
}

/** Every PR of this repo the generated list links to, ascending. */
export function pullNumbersFrom(generated) {
  const pattern = new RegExp(`https://github\\.com/${REPO}/pull/(\\d+)`, "g");
  return [...new Set([...generated.matchAll(pattern)].map((m) => +m[1]))].sort(
    (a, b) => a - b,
  );
}

/**
 * Issue numbers a PR body closes by keyword — GitHub's nine closing keywords,
 * with its optional colon. A bare `#N` only, so a cross-repo `owner/repo#N`
 * is not mistaken for one of ours.
 */
export function closingKeywordIssues(body) {
  const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;
  return [...(body ?? "").matchAll(pattern)].map((m) => +m[1]);
}

const CLOSING_QUERY = `query($n:Int!,$after:String){repository(owner:"${OWNER}",name:"${NAME}"){pullRequest(number:$n){body closingIssuesReferences(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{number repository{nameWithOwner}}}}}}`;

/** Every issue of this repo one PR closes: manual links (paginated) + body keywords. */
export function issuesClosedBy(spawn, pr) {
  const numbers = new Set();
  let body;
  let after;
  for (;;) {
    const variables = after === undefined ? { n: pr } : { n: pr, after };
    const pull = graphql(spawn, CLOSING_QUERY, variables).repository
      .pullRequest;
    if (!pull) {
      throw new Error(`PR #${pr} not found`);
    }
    body ??= pull.body;
    const refs = pull.closingIssuesReferences;
    for (const node of refs.nodes) {
      if (node.repository.nameWithOwner === REPO) numbers.add(node.number);
    }
    if (!refs.pageInfo.hasNextPage) break;
    after = refs.pageInfo.endCursor;
  }
  for (const n of closingKeywordIssues(body)) numbers.add(n);
  return numbers;
}

const AUTHOR_QUERY = `query($n:Int!){repository(owner:"${OWNER}",name:"${NAME}"){issueOrPullRequest(number:$n){__typename ... on Issue{author{login __typename}}}}}`;

/**
 * The login to credit for issue `n`, or null when there is nobody to credit:
 * the number is a PR rather than an issue, or the author is a bot (the
 * SDK-watch and Dependabot sweeps) or a deleted account.
 */
export function creditableAuthor(spawn, n) {
  const node = graphql(spawn, AUTHOR_QUERY, { n }).repository
    .issueOrPullRequest;
  if (!node) {
    throw new Error(`#${n} not found`);
  }
  if (node.__typename !== "Issue") return null;
  return node.author?.__typename === "User" ? node.author.login : null;
}

/** True for a maintainer, false for a community member; throws otherwise. */
export function isMaintainer(spawn, login) {
  const permission = run(spawn, "gh", [
    "api",
    `repos/${REPO}/collaborators/${login}/permission`,
    "--jq",
    ".permission",
  ]);
  if (MAINTAINER_PERMISSIONS.has(permission)) return true;
  if (COMMUNITY_PERMISSIONS.has(permission)) return false;
  throw new Error(`unexpected permission "${permission}" for @${login}`);
}

/** Community reporter → the issues of theirs the listed PRs close. */
export function collectReporters(spawn, pulls) {
  const issues = new Set();
  for (const pr of pulls) {
    for (const n of issuesClosedBy(spawn, pr)) issues.add(n);
  }
  const reporters = new Map();
  const maintainer = new Map();
  for (const n of [...issues].sort((a, b) => a - b)) {
    const login = creditableAuthor(spawn, n);
    if (login === null) continue;
    if (!maintainer.has(login)) {
      maintainer.set(login, isMaintainer(spawn, login));
    }
    if (maintainer.get(login)) continue;
    if (!reporters.has(login)) reporters.set(login, []);
    reporters.get(login).push(n);
  }
  return reporters;
}

/** One line per person, most issues first, then by name; "" when nobody. */
export function formatThanks(reporters) {
  if (reporters.size === 0) return "";
  const lines = [...reporters]
    .sort(
      ([a, ia], [b, ib]) =>
        ib.length - ia.length ||
        a.localeCompare(b, "en", { sensitivity: "base" }),
    )
    .map(
      ([login, nums]) => `* @${login} (${nums.map((n) => `#${n}`).join(", ")})`,
    );
  return `## Thanks for helping us improve\n\n${THANKS_LEAD_IN}\n\n${lines.join("\n")}`;
}

export function formatKnownIssues(knownIssues) {
  if (knownIssues.length === 0) return "";
  const heading = knownIssues.length === 1 ? "Known issue" : "Known issues";
  return `## ${heading}\n\n${knownIssues.join("\n\n")}`;
}

export function assembleNotes({
  generated,
  mergeBranch,
  ledgerUrl,
  knownIssues,
  thanks,
}) {
  const ledger = `**Smoke test ledger for milestone branch**: [${mergeBranch}](${ledgerUrl})`;
  const sections = [formatKnownIssues(knownIssues), thanks].filter(Boolean);
  return [`${generated.trimEnd()}\n${ledger}`, ...sections].join("\n\n") + "\n";
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const args = parseNotesArgs(argv);

  // Tags first: a refspec-less fetch rewrites FETCH_HEAD, so the main fetch
  // has to come last for FETCH_HEAD to be main (see release-tag.mjs on why
  // FETCH_HEAD and not the origin/main tracking ref).
  run(spawn, "git", ["fetch", "origin", "--tags"]);
  run(spawn, "git", ["fetch", "origin", "main"]);
  const sha = run(spawn, "git", ["rev-parse", "FETCH_HEAD"]);
  const mainVersion = versionFrom(
    run(spawn, "git", ["show", `${sha}:package.json`]),
  );
  const version = args.version ?? mainVersion;
  if (args.mode !== "preview" && version !== mainVersion) {
    // --target main would attach this version's Release to another
    // version's tree; regenerating an older release's notes is preview-only.
    throw new Error(
      `--${args.mode} creates ${version} on main, but origin/main is ${mainVersion}`,
    );
  }
  const previousTag =
    args.previousTag ??
    previousStableTag(run(spawn, "git", ["tag", "-l"]).split("\n"), version);
  console.error(`release notes: ${previousTag} → ${version}`);

  const generated = run(spawn, "gh", [
    "api",
    `repos/${REPO}/releases/generate-notes`,
    "-f",
    `tag_name=${version}`,
    "-f",
    "target_commitish=main",
    "-f",
    `previous_tag_name=${previousTag}`,
    "--jq",
    ".body",
  ]);
  const pulls = pullNumbersFrom(generated);
  console.error(`crediting reporters of issues closed by ${pulls.length} PRs`);
  const notes = assembleNotes({
    generated,
    mergeBranch: args.mergeBranch,
    ledgerUrl: args.ledgerUrl,
    knownIssues: args.knownIssues,
    thanks: formatThanks(collectReporters(spawn, pulls)),
  });

  if (args.mode === "preview") {
    process.stdout.write(notes);
    console.error(
      "preview only — nothing created; re-run with --draft (or --publish)",
    );
    return notes;
  }
  const create = [
    "release",
    "create",
    version,
    "--repo",
    REPO,
    "--target",
    "main",
    "--title",
    version,
    "--notes-file",
    "-",
    args.mode === "draft" ? "--draft" : "--latest",
  ];
  const url = run(spawn, "gh", create, notes);
  console.error(
    args.mode === "draft"
      ? `draft created: ${url} — review it, then publish (this triggers npm + GHCR)`
      : `published: ${url}`,
  );
  return notes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
