#!/usr/bin/env node
// Dependabot alert sweep (#2233), the alert-consuming half of #2229.
//
// Dependabot's SECURITY-update PRs are turned off in repo settings; its alerts
// stay on. This script is what consumes them:
//
//   alert -> scheduled sweep -> issue (labeled, milestoned, boarded) -> maintainer PR -> v2/main
//
// A Dependabot-opened PR carries no `Closes #N` and no board card, which is the
// carve-out from "every PR references an issue" that #2229 exists to remove.
// The version-update half was removed outright in #2235 and replaced by
// `dependency-refresh.mjs`; this is the security half, and it files issues
// rather than PRs for the same reason.
//
// Three things shape the design, each verified against this repo before it was
// written:
//
//  1. There is no `dependabot_alert` WORKFLOW trigger — it is a webhook event
//     only — so this is a scheduled sweep, not event-driven. Daily is enough;
//     alerts are not minute-sensitive.
//  2. `GITHUB_TOKEN` can read alerts with `vulnerability-alerts: read`, so no
//     PAT is needed for the sweep itself. Two side steps DO need one, and both
//     are best-effort rather than preconditions: writing the board card (an org
//     project is outside `GITHUB_TOKEN`'s reach — an unboarded-but-milestoned
//     issue is swept into Todo by the next `/issue-triage` pass), and reading
//     back the `automated-security-fixes` setting (`administration: read`,
//     which `permissions:` cannot grant at all).
//  3. Alerts are per-ADVISORY but a fix is per-BUMP. Today's seven open alerts
//     are three `overrides` entries, so grouping by
//     `(package, manifest_path, first_patched_version)` is what keeps this from
//     filing seven issues for three pieces of work.
//
// ⚠️ GitHub computes the dependency graph — and therefore every alert — from
// the DEFAULT branch (`main`), while we ship from `v2/main`. So an alert is not
// trusted on its face: the vulnerable range is re-checked against `v2/main`'s
// own lockfile before anything is filed. The blind spot that leaves is stated
// plainly in the workflow header: a vulnerable dependency introduced on
// `v2/main` and not yet merged to `main` produces no alert at all, and no
// approach that consumes GitHub's alerts can see it.
//
// Idempotency key is the marker comment at the top of each issue body, which
// names the package, the manifest and every GHSA the issue covers. A second run
// the same day is a complete no-op; a NEW advisory for a package that already
// has an open issue lands as a comment on it and rewrites the marker, rather
// than filing a second issue.
//
// The pure halves — `toSemverRange`, `lockfileVersions`, `isDirectDependency`,
// `groupAlerts`, `buildMarker`, `parseMarker`, `mergeGhsas`, `buildIssueTitle`,
// `buildIssueBody` and `buildNewAdvisoryComment` — are covered by
// `dependabot-alerts.test.mjs`. `main()` is the CLI entry point, exercised
// against the real repo only via `workflow_dispatch` in CI, per the same split
// `dependency-refresh.mjs` and `verify-skills.mjs` already use.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import semver from "semver";

/** Board #28 (v2). The project and field node ids are stable; option ids are not. */
export const PROJECT_ID = "PVT_kwDOCt2Azc4BJVxt";
export const STATUS_FIELD_ID = "PVTSSF_lADOCt2Azc4BJVxtzg5iI8c";
export const PRIORITY_FIELD_ID = "PVTSSF_lADOCt2Azc4BJVxtzg5iJE4";
/**
 * Option ids are regenerated whenever a single-select field's option list is
 * edited, so they are resolved by NAME at run time rather than hardcoded here —
 * a hardcoded id turns an unrelated board edit into a silently mis-set field.
 */
export const BOARD_STATUS = "Todo";
export const BOARD_PRIORITY = "High";

/**
 * The branch this repo actually ships from, and whose lockfiles are probed.
 *
 * The workflow checks this branch out, so manifests are read from the working
 * tree rather than through `git show` — the same shape `dependency-refresh.mjs`
 * uses to run `npm outdated` against it. Named here only so the issue body can
 * say which branch the versions it quotes came from.
 */
export const TARGET_BRANCH = "v2/main";

const MARKER_RE =
  /^<!-- dependabot-alerts: pkg=(.+?); manifest=(.+?); ghsas=(.+?) -->/;

/**
 * The issue body's first line: the idempotency key.
 *
 * @param {{package: string, manifestPath: string, ghsas: string[]}} group
 * @returns {string}
 */
export function buildMarker({ package: pkg, manifestPath, ghsas }) {
  return `<!-- dependabot-alerts: pkg=${pkg}; manifest=${manifestPath}; ghsas=${[...ghsas].sort().join(",")} -->`;
}

/**
 * Read a marker back off an issue body.
 *
 * @param {string | undefined} body
 * @returns {{package: string, manifestPath: string, ghsas: string[]} | null}
 */
export function parseMarker(body) {
  const match = MARKER_RE.exec(body ?? "");
  if (!match) return null;
  return {
    package: match[1],
    manifestPath: match[2],
    ghsas: match[3].split(",").filter(Boolean),
  };
}

/**
 * Which of `group`'s advisories the existing issue does not already name.
 *
 * @param {string[]} existing the marker's GHSA list
 * @param {string[]} incoming the GHSAs the sweep just saw
 * @returns {{merged: string[], added: string[]}} both sorted
 */
export function mergeGhsas(existing, incoming) {
  const known = new Set(existing);
  const added = [...new Set(incoming.filter((g) => !known.has(g)))].sort();
  const merged = [...new Set([...existing, ...incoming])].sort();
  return { merged, added };
}

/**
 * Translate a GitHub `vulnerable_version_range` into a range npm `semver`
 * understands.
 *
 * ⚠️ GitHub separates conjuncts with a COMMA (`>= 3.1.3, < 3.1.6`); node-semver
 * reads a comma as nothing at all and quietly returns `false` for a version
 * that is in fact in range. Space is semver's AND, so the fix is a split/join —
 * but the failure it prevents is silent, which is why this is its own tested
 * function rather than an inline `.replace`.
 *
 * @param {string} range
 * @returns {string}
 */
export function toSemverRange(range) {
  return range
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Every version of `pkg` installed anywhere in an npm lockfile.
 *
 * A transitive package can legitimately appear more than once (a nested
 * `node_modules/x/node_modules/y`), and the alert applies if ANY copy is in
 * range, so this returns them all rather than picking one.
 *
 * @param {object} lock parsed `package-lock.json` (lockfileVersion 2 or 3)
 * @param {string} pkg
 * @returns {string[]} sorted, deduped
 */
export function lockfileVersions(lock, pkg) {
  const suffix = `node_modules/${pkg}`;
  const versions = new Set();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path !== suffix && !path.endsWith(`/${suffix}`)) continue;
    if (entry?.version) versions.add(entry.version);
  }
  return [...versions].sort(semver.compare);
}

/**
 * Is `pkg` declared by the manifest itself, rather than pulled in transitively?
 *
 * Decides which fix the issue asks for: a direct dependency is a plain version
 * bump, a transitive one is an `overrides` entry per AGENTS.md's Dependency
 * placement — never `npm audit fix`, which "resolves" an advisory with no
 * upward escape by silently downgrading.
 *
 * @param {object} lock parsed `package-lock.json`
 * @param {string} pkg
 * @returns {boolean}
 */
export function isDirectDependency(lock, pkg) {
  const root = lock.packages?.[""] ?? {};
  return Boolean(
    root.dependencies?.[pkg] ??
    root.devDependencies?.[pkg] ??
    root.optionalDependencies?.[pkg] ??
    root.peerDependencies?.[pkg],
  );
}

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, moderate: 2, low: 1 };

/**
 * Collapse per-advisory alerts into one entry per BUMP.
 *
 * Grouped by `(package, manifest_path, first_patched_version)`: that triple is
 * one edit to one manifest, which is the unit a maintainer actually acts on.
 * Two advisories on the same package with different patched versions are
 * different bumps and stay apart.
 *
 * @param {object[]} alerts raw `GET /repos/{o}/{r}/dependabot/alerts` entries
 * @returns {Array<{key: string, package: string, manifestPath: string, fixedIn: string, scope: string, severity: string, ghsas: string[], advisories: Array<{ghsa: string, cve: string | null, severity: string, summary: string, range: string, url: string}>}>}
 */
export function groupAlerts(alerts) {
  const groups = new Map();
  for (const alert of alerts) {
    if (alert.state !== "open") continue;
    const pkg = alert.dependency?.package?.name;
    const manifestPath = alert.dependency?.manifest_path;
    const fixedIn =
      alert.security_vulnerability?.first_patched_version?.identifier;
    // No patched version means there is nothing to bump TO — an issue asking
    // for an unavailable upgrade is noise, so it waits for one to be published.
    if (!pkg || !manifestPath || !fixedIn) continue;

    const key = `${pkg} ${manifestPath} ${fixedIn}`;
    const advisory = {
      ghsa: alert.security_advisory?.ghsa_id ?? "",
      cve: alert.security_advisory?.cve_id ?? null,
      severity: alert.security_advisory?.severity ?? "unknown",
      summary: alert.security_advisory?.summary ?? "",
      range: alert.security_vulnerability?.vulnerable_version_range ?? "*",
      url: alert.html_url ?? "",
    };

    const existing = groups.get(key);
    if (existing) {
      existing.advisories.push(advisory);
      if (
        (SEVERITY_RANK[advisory.severity] ?? 0) >
        (SEVERITY_RANK[existing.severity] ?? 0)
      ) {
        existing.severity = advisory.severity;
      }
      continue;
    }
    groups.set(key, {
      key,
      package: pkg,
      manifestPath,
      fixedIn,
      scope: alert.dependency?.scope ?? "runtime",
      severity: advisory.severity,
      advisories: [advisory],
    });
  }

  return [...groups.values()]
    .map((group) => {
      group.advisories.sort((a, b) => a.ghsa.localeCompare(b.ghsa));
      group.ghsas = group.advisories.map((a) => a.ghsa);
      return group;
    })
    .sort(
      (a, b) =>
        a.package.localeCompare(b.package) ||
        a.manifestPath.localeCompare(b.manifestPath) ||
        a.fixedIn.localeCompare(b.fixedIn),
    );
}

/**
 * @param {ReturnType<typeof groupAlerts>[number]} group
 * @returns {string}
 */
export function buildIssueTitle(group) {
  const n = group.advisories.length;
  return `chore(deps): bump \`${group.package}\` to \`${group.fixedIn}\` in \`${group.manifestPath}\` (${n} ${n === 1 ? "advisory" : "advisories"})`;
}

const PLACEMENT_DOC =
  "https://github.com/modelcontextprotocol/inspector/blob/v2/main/AGENTS.md#dependency-placement";

/**
 * @param {ReturnType<typeof groupAlerts>[number]} group
 * @param {{installed: string[], direct: boolean, ghsas?: string[]}} probe
 *   `ghsas` overrides the marker's list when an existing issue is being
 *   rewritten to cover advisories it did not originally name.
 * @returns {string}
 */
export function buildIssueBody(group, { installed, direct, ghsas }) {
  const covered = ghsas ?? group.ghsas;
  const rows = group.advisories
    .map(
      (a) =>
        `| [${a.ghsa}](${a.url}) | ${a.cve ?? "—"} | ${a.severity} | ${a.range} | ${a.summary.replace(/\|/g, "\\|")} |`,
    )
    .join("\n");

  const fix = direct
    ? `\`${group.package}\` is a **direct** dependency of \`${group.manifestPath.replace(/package-lock\.json$/, "package.json")}\` — bump its declared range to \`>=${group.fixedIn}\`.`
    : `\`${group.package}\` is **transitive**, so the fix is an [\`overrides\`](${PLACEMENT_DOC}) entry pinning it to \`${group.fixedIn}\` — **not** \`npm audit fix\`, which "resolves" an advisory with no upward escape by silently downgrading.`;

  return [
    buildMarker({ ...group, ghsas: covered }),
    `Filed automatically from ${covered.length} open Dependabot ${covered.length === 1 ? "alert" : "alerts"} (#2233). Dependabot opens no security-update PRs on this repo; the fix is written by hand against \`v2/main\`.`,
    "",
    "| | |",
    "| --- | --- |",
    `| Package | \`${group.package}\` |`,
    `| Manifest | \`${group.manifestPath}\` |`,
    `| Installed on \`v2/main\` | ${installed.length > 0 ? installed.map((v) => `\`${v}\``).join(", ") : "—"} |`,
    `| Fixed in | \`${group.fixedIn}\` |`,
    `| Scope | ${group.scope} |`,
    `| Highest severity | ${group.severity} |`,
    "",
    "## Advisories",
    "",
    "| GHSA | CVE | Severity | Vulnerable range | Summary |",
    "| --- | --- | --- | --- | --- |",
    rows,
    "",
    "## Fix",
    "",
    fix,
    "",
    "> [!NOTE]",
    `> **Priority is a standing rubric override.** A routine bump scores Medium; a security bump is filed **${BOARD_PRIORITY}** so it does not sit. The version and severity above come from \`${TARGET_BRANCH}\`'s own lockfile, not from the alert — GitHub computes alerts from the default branch, so an alert is only filed here after its vulnerable range is re-checked against the branch we ship from.`,
  ].join("\n");
}

/**
 * The comment a NEW advisory for an already-open issue gets, instead of a
 * second issue.
 *
 * @param {ReturnType<typeof groupAlerts>[number]} group
 * @param {string[]} added the GHSAs not previously covered
 * @returns {string}
 */
export function buildNewAdvisoryComment(group, added) {
  const rows = group.advisories
    .filter((a) => added.includes(a.ghsa))
    .map(
      (a) =>
        `| [${a.ghsa}](${a.url}) | ${a.severity} | ${a.summary.replace(/\|/g, "\\|")} |`,
    )
    .join("\n");
  return [
    `${added.length} new Dependabot ${added.length === 1 ? "advisory" : "advisories"} for \`${group.package}\`, cleared by the same bump to \`${group.fixedIn}\`. The issue body's marker now covers ${added.length === 1 ? "it" : "them"} too.`,
    "",
    "| GHSA | Severity | Summary |",
    "| --- | --- | --- |",
    rows,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Impure half: everything below shells out to `gh` or `git`.
// ---------------------------------------------------------------------------

function gh(args, { token } = {}) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  const result = spawnSync("gh", args, { encoding: "utf8", env });
  if (result.error) throw result.error;
  return result;
}

function ghJson(args) {
  const result = gh(args);
  if (result.status !== 0) {
    throw new Error(`gh ${args[0]} failed: ${(result.stderr ?? "").trim()}`);
  }
  return JSON.parse(result.stdout || "null");
}

/**
 * Detect whether Dependabot's security-update PRs have been switched back on.
 *
 * `automated-security-fixes` is a repo SETTING, so it can be re-enabled from
 * the UI without a commit and nothing in this repo would record it. This check
 * is this design's analogue of the merge guard #2060 needed: one API call
 * standing in for a required status check plus a ruleset change.
 *
 * ⚠️ **The endpoint needs `administration: read`, which `GITHUB_TOKEN` cannot
 * be granted** — `permissions:` has no such key. So with the default token the
 * call 403s, and treating that as failure would make every scheduled run red
 * for a reason unrelated to the alerts. It is therefore reported and skipped:
 * only an explicit `enabled: true` throws. Give `PROJECT_TOKEN` the extra
 * `administration: read` scope and the guard becomes a real assertion; without
 * it the sweep still does its job, it just cannot see that setting.
 */
function checkSecurityPrsStillDisabled(repo) {
  const result = gh(["api", `repos/${repo}/automated-security-fixes`], {
    token: process.env.PROJECT_TOKEN,
  });
  if (result.status !== 0) {
    console.log(
      "dependabot-alerts: cannot read automated-security-fixes " +
        `(${(result.stderr ?? "").trim()}) — the token lacks \`administration: read\`, ` +
        "so whether Dependabot security PRs are still off is UNVERIFIED this run",
    );
    return;
  }
  const state = JSON.parse(result.stdout || "{}");
  if (state.enabled === true) {
    throw new Error(
      "Dependabot security-update PRs are ENABLED again. This sweep exists to replace them; " +
        "an enabled setting means both flows are running and Dependabot is opening PRs with no " +
        "issue and no board card. Disable it (Settings -> Code security, or " +
        `DELETE /repos/${repo}/automated-security-fixes) and re-run.`,
    );
  }
}

function openAlerts(repo) {
  return ghJson([
    "api",
    "--paginate",
    `repos/${repo}/dependabot/alerts?state=open&per_page=100`,
  ]);
}

/**
 * A manifest's contents in the checkout, or `null` when it is absent — an alert
 * against a manifest this branch does not have is not actionable.
 */
function readManifest(manifestPath) {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function openDependabotIssues(repo) {
  return ghJson([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--label",
    "dependabot",
    "--json",
    "number,body",
    "--limit",
    "100",
  ]);
}

function currentMilestone(repo) {
  const result = gh([
    "api",
    `repos/${repo}/milestones`,
    "--jq",
    'map(select(.state=="open")) | sort_by(.due_on) | .[0].title // empty',
  ]);
  if (result.status !== 0) {
    throw new Error(`milestone lookup failed: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout.trim() || null;
}

/**
 * Resolve a single-select option id by NAME.
 *
 * Option ids are regenerated whenever the field's option list is edited, so
 * looking them up each run is what keeps an unrelated board edit from turning
 * into a silently mis-set field here.
 */
function optionId(fieldName, optionName, token) {
  const result = gh(
    [
      "project",
      "field-list",
      "28",
      "--owner",
      "modelcontextprotocol",
      "--format",
      "json",
    ],
    { token },
  );
  if (result.status !== 0) {
    throw new Error(`field-list failed: ${(result.stderr ?? "").trim()}`);
  }
  const field = JSON.parse(result.stdout).fields.find(
    (f) => f.name === fieldName,
  );
  const option = field?.options?.find((o) => o.name === optionName);
  if (!option) {
    throw new Error(
      `no ${fieldName} option named "${optionName}" on board #28`,
    );
  }
  return option.id;
}

/**
 * Put the issue on board #28 at Todo / High.
 *
 * Best-effort by design: an org project is outside `GITHUB_TOKEN`'s reach, so
 * this needs a PAT the workflow may not have. A failure here is logged and the
 * run continues — the issue is already labeled and milestoned, which is enough
 * for the next `/issue-triage` sweep to board it (its documented exception
 * moves an unboarded-but-milestoned issue straight into Todo).
 *
 * Todo rather than Incoming: arriving through this pipeline IS the approval.
 */
function addToBoard(issueUrl) {
  const token = process.env.PROJECT_TOKEN;
  if (!token) {
    console.log(
      "dependabot-alerts: PROJECT_TOKEN unset — issue left unboarded for the next triage sweep",
    );
    return;
  }
  try {
    const added = gh(
      [
        "project",
        "item-add",
        "28",
        "--owner",
        "modelcontextprotocol",
        "--url",
        issueUrl,
        "--format",
        "json",
      ],
      { token },
    );
    if (added.status !== 0) {
      throw new Error((added.stderr ?? "").trim());
    }
    const itemId = JSON.parse(added.stdout).id;
    // Each item-edit sets exactly one field, so Status and Priority are two calls.
    for (const [fieldId, fieldName, optionName] of [
      [STATUS_FIELD_ID, "Status", BOARD_STATUS],
      [PRIORITY_FIELD_ID, "Priority", BOARD_PRIORITY],
    ]) {
      const edit = gh(
        [
          "project",
          "item-edit",
          "--project-id",
          PROJECT_ID,
          "--id",
          itemId,
          "--field-id",
          fieldId,
          "--single-select-option-id",
          optionId(fieldName, optionName, token),
        ],
        { token },
      );
      if (edit.status !== 0) throw new Error((edit.stderr ?? "").trim());
    }
    console.log(
      `dependabot-alerts: boarded ${issueUrl} at ${BOARD_STATUS}/${BOARD_PRIORITY}`,
    );
  } catch (error) {
    console.log(
      `dependabot-alerts: board write failed (${error.message}) — issue is labeled and milestoned, next triage sweep will board it`,
    );
  }
}

function createIssue(repo, group, body) {
  const milestone = currentMilestone(repo);
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    buildIssueTitle(group),
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
  const result = gh(args);
  if (result.status !== 0) {
    throw new Error(`gh issue create failed: ${(result.stderr ?? "").trim()}`);
  }
  const url = result.stdout.trim();
  if (!milestone) {
    console.log(
      "dependabot-alerts: no open milestone — issue filed unmilestoned",
    );
  }
  console.log(`dependabot-alerts: filed ${url}`);
  return url;
}

export function main(repo = process.env.GITHUB_REPOSITORY) {
  if (!repo) throw new Error("repo not specified (GITHUB_REPOSITORY unset)");

  checkSecurityPrsStillDisabled(repo);

  const groups = groupAlerts(openAlerts(repo));
  if (groups.length === 0) {
    console.log("dependabot-alerts: no open alerts — no-op");
    return;
  }

  const existingIssues = openDependabotIssues(repo).map((issue) => ({
    ...issue,
    marker: parseMarker(issue.body),
  }));

  const manifests = new Map();
  for (const group of groups) {
    if (!manifests.has(group.manifestPath)) {
      manifests.set(group.manifestPath, readManifest(group.manifestPath));
    }
    const lock = manifests.get(group.manifestPath);
    if (lock === null) {
      console.log(
        `dependabot-alerts: ${group.manifestPath} absent on ${TARGET_BRANCH} — skipping ${group.package}`,
      );
      continue;
    }

    const installed = lockfileVersions(lock, group.package);
    const affected = installed.filter((version) =>
      group.advisories.some((a) =>
        semver.satisfies(version, toSemverRange(a.range)),
      ),
    );
    if (affected.length === 0) {
      console.log(
        `dependabot-alerts: ${group.package}@${installed.join("/") || "(absent)"} is already out of range on ${TARGET_BRANCH} — skipping`,
      );
      continue;
    }

    const direct = isDirectDependency(lock, group.package);
    const existing = existingIssues.find(
      (i) =>
        i.marker?.package === group.package &&
        i.marker?.manifestPath === group.manifestPath,
    );

    if (!existing) {
      const url = createIssue(
        repo,
        group,
        buildIssueBody(group, { installed: affected, direct }),
      );
      addToBoard(url);
      continue;
    }

    const { merged, added } = mergeGhsas(existing.marker.ghsas, group.ghsas);
    if (added.length === 0) {
      console.log(
        `dependabot-alerts: #${existing.number} already covers ${group.package} — no-op`,
      );
      continue;
    }

    const edit = gh([
      "issue",
      "edit",
      String(existing.number),
      "--repo",
      repo,
      "--body",
      buildIssueBody(group, { installed: affected, direct, ghsas: merged }),
    ]);
    if (edit.status !== 0) {
      throw new Error(`gh issue edit failed: ${(edit.stderr ?? "").trim()}`);
    }
    const comment = gh([
      "issue",
      "comment",
      String(existing.number),
      "--repo",
      repo,
      "--body",
      buildNewAdvisoryComment(group, added),
    ]);
    if (comment.status !== 0) {
      throw new Error(
        `gh issue comment failed: ${(comment.stderr ?? "").trim()}`,
      );
    }
    console.log(
      `dependabot-alerts: added ${added.join(", ")} to #${existing.number}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
