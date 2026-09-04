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
//     degrade rather than block: writing the board card (an org project is
//     outside `GITHUB_TOKEN`'s reach — an unboarded-but-milestoned issue is
//     swept into Todo by the next `/issue-triage` pass), and reading back the
//     `automated-security-fixes` setting (`administration: read`, which
//     `permissions:` cannot grant at all — so that guard reports UNVERIFIED
//     rather than failing when the token cannot see it).
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
// approach that consumes GitHub's alerts can see it. The release-time
// `npm audit --audit-level=high` report (#2231) is the partial second signal.
//
// Idempotency key is the marker comment at the top of each issue body, which
// names the package, the manifest and every GHSA the issue covers. A second run
// the same day is a complete no-op; a NEW advisory for a package that already
// has an open issue lands as a comment on it and rewrites the marker, rather
// than filing a second issue.
//
// Everything here is covered by `dependabot-alerts.test.mjs`: the pure halves
// directly, and `main()` through an injected spawn function, the same way
// `dependency-refresh.mjs` does it. `workflow_dispatch` is a production
// trigger, not a test, so the orchestration that handles API failures, lockfile
// filtering, issue idempotency and partial board writes is exercised here
// rather than left to a real run (Copilot).

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

/**
 * The one ecosystem this sweep can act on.
 *
 * ⚠️ Dependabot alerts are NOT npm-only. This repo has a `Dockerfile` and
 * GitHub Actions workflows, and an alert against either arrives in the same
 * feed with a `manifest_path` that is not a lockfile — which the JSON parse
 * would reject, aborting the whole daily sweep before any npm group was
 * processed (Copilot). Everything downstream reads npm lockfiles, so a non-npm
 * alert is reported and skipped rather than guessed at: filing it properly
 * means knowing how to fix it, which is different work per ecosystem.
 */
export const SUPPORTED_ECOSYSTEM = "npm";

const MARKER_RE =
  /^<!-- dependabot-alerts: pkg=(.+?); manifest=(.+?); fixed=(.+?); ghsas=(.+?) -->/;

/** Marker on the comment that announces newly-seen advisories, keyed by GHSA. */
const COMMENT_MARKER_RE = /^<!-- dependabot-alerts:added (.+?) -->/;

/**
 * The issue body's first line: the idempotency key.
 *
 * It carries `fixedIn` as well as the package and manifest because that triple
 * IS the grouping key — two advisories on one package needing different patched
 * versions are different bumps and get different issues. Keyed on the pair
 * alone, a second bump would match the first issue and merge its GHSAs and its
 * target version into the wrong one (Copilot).
 *
 * @param {{package: string, manifestPath: string, fixedIn: string, ghsas: string[]}} group
 * @returns {string}
 */
export function buildMarker({ package: pkg, manifestPath, fixedIn, ghsas }) {
  return `<!-- dependabot-alerts: pkg=${pkg}; manifest=${manifestPath}; fixed=${fixedIn}; ghsas=${[...ghsas].sort().join(",")} -->`;
}

/**
 * Read a marker back off an issue body.
 *
 * @param {string | undefined} body
 * @returns {{package: string, manifestPath: string, fixedIn: string, ghsas: string[]} | null}
 */
export function parseMarker(body) {
  const match = MARKER_RE.exec(body ?? "");
  if (!match) return null;
  return {
    package: match[1],
    manifestPath: match[2],
    fixedIn: match[3],
    ghsas: match[4].split(",").filter(Boolean),
  };
}

/**
 * The GHSAs a previously-posted "new advisories" comment already announced.
 *
 * @param {string | undefined} body
 * @returns {string[] | null} `null` when the comment carries no marker
 */
export function parseCommentMarker(body) {
  const match = COMMENT_MARKER_RE.exec(body ?? "");
  if (!match) return null;
  return match[1].split(",").filter(Boolean);
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
 * Every installed copy of `pkg` in an npm lockfile, with its tree path.
 *
 * A package can legitimately appear more than once — a hoisted
 * `node_modules/x` plus one or more nested `node_modules/y/node_modules/x` —
 * and the copies can be at DIFFERENT versions. The path is kept rather than
 * just the version because it is what distinguishes the copy the manifest
 * declares from a copy some dependency dragged in, and the fix for those two
 * is not the same (Copilot).
 *
 * @param {object} lock parsed `package-lock.json` (lockfileVersion 2 or 3)
 * @param {string} pkg
 * @returns {Array<{path: string, version: string, hoisted: boolean}>} sorted by version
 */
export function lockfileEntries(lock, pkg) {
  const hoistedPath = `node_modules/${pkg}`;
  const entries = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path !== hoistedPath && !path.endsWith(`/${hoistedPath}`)) continue;
    if (!entry?.version) continue;
    entries.push({
      path,
      version: entry.version,
      hoisted: path === hoistedPath,
    });
  }
  return entries.sort(
    (a, b) =>
      semver.compare(a.version, b.version) || a.path.localeCompare(b.path),
  );
}

/**
 * Every version of `pkg` installed anywhere in an npm lockfile.
 *
 * @param {object} lock parsed `package-lock.json` (lockfileVersion 2 or 3)
 * @param {string} pkg
 * @returns {string[]} sorted, deduped
 */
export function lockfileVersions(lock, pkg) {
  return [...new Set(lockfileEntries(lock, pkg).map((e) => e.version))].sort(
    semver.compare,
  );
}

/**
 * Is `pkg` declared by the manifest itself, rather than pulled in transitively?
 *
 * ⚠️ Being declared is NOT by itself the question the issue needs answered —
 * see `remediation` below. A manifest can declare a safe `pkg@^4` while some
 * dependency drags a vulnerable `pkg@3` into a nested folder, and telling the
 * maintainer to raise an already-safe range would leave the vulnerable copy
 * exactly where it is (Copilot).
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
 * The grouping key: one bump, i.e. one edit to one manifest.
 *
 * JSON rather than a delimited string, because the three fields are free-form
 * and any separator would have to be argued for — the one that was here was a
 * literal NUL, which classified the whole source file as binary and made
 * repository searches skip it (Copilot). Shared with the end-of-run
 * reconciliation, so a key built from a marker and a key built from an alert
 * cannot drift apart.
 *
 * @returns {string}
 */
export function groupKey(pkg, manifestPath, fixedIn) {
  return JSON.stringify([pkg, manifestPath, fixedIn]);
}

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
    const ecosystem = alert.dependency?.package?.ecosystem ?? "unknown";
    const manifestPath = alert.dependency?.manifest_path;
    const fixedIn =
      alert.security_vulnerability?.first_patched_version?.identifier;
    // No patched version means there is nothing to bump TO — an issue asking
    // for an unavailable upgrade is noise, so it waits for one to be published.
    if (!pkg || !manifestPath || !fixedIn) continue;

    const key = groupKey(pkg, manifestPath, fixedIn);
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
      ecosystem,
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
 * The milestone a new issue takes: the open one with the NEAREST due date.
 *
 * ⚠️ Selected here rather than in a `jq` expression because jq sorts `null`
 * BEFORE every string, so a `sort_by(.due_on) | .[0]` over the raw list hands
 * back an undated milestone in preference to every dated one (Copilot). An
 * undated bucket has no due date and so cannot be the nearest; it is dropped
 * rather than sorted last, and if nothing dated is open the issue is filed
 * unmilestoned and triage places it.
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
 * Narrow a group to the advisories that actually apply to what is installed.
 *
 * ⚠️ Grouping is by `(package, manifest, first_patched_version)`, and two
 * advisories sharing that triple can still have DIFFERENT vulnerable ranges —
 * `>= 3.1.3, < 3.1.6` and `>= 3.0.0, < 3.1.6` both patch at 3.1.6, and an
 * installed `3.1.0` matches only the second. Validating at the group level
 * ("does ANY advisory match?") keeps both, and the issue's marker, title,
 * severity, advisory table and later comments then all claim an advisory that
 * does not apply on this branch (Copilot).
 *
 * @param {ReturnType<typeof groupAlerts>[number]} group
 * @param {Array<{path: string, version: string, hoisted: boolean}>} entries every installed copy
 * @returns {{group: ReturnType<typeof groupAlerts>[number], affected: Array<{path: string, version: string, hoisted: boolean}>} | null}
 *   `null` when nothing installed is in range of any of the group's advisories
 */
export function narrowToApplicable(group, entries) {
  const applies = (advisory, entry) =>
    semver.satisfies(entry.version, toSemverRange(advisory.range));

  const advisories = group.advisories.filter((a) =>
    entries.some((e) => applies(a, e)),
  );
  if (advisories.length === 0) return null;

  const affected = entries.filter((e) => advisories.some((a) => applies(a, e)));
  const severity = advisories.reduce(
    (worst, a) =>
      (SEVERITY_RANK[a.severity] ?? 0) > (SEVERITY_RANK[worst] ?? 0)
        ? a.severity
        : worst,
    advisories[0].severity,
  );

  return {
    group: {
      ...group,
      advisories,
      ghsas: advisories.map((a) => a.ghsa),
      severity,
    },
    affected,
  };
}

/**
 * The title counts the advisories that APPLY, which is what the body shows —
 * so it tracks an issue that grows a new advisory and one whose exposure
 * shrinks alike. The marker's GHSA list is a different thing: it is monotonic,
 * because its job is to remember what has already been announced.
 *
 * @param {ReturnType<typeof groupAlerts>[number]} group narrowed to what applies
 * @returns {string}
 */
export function buildIssueTitle(group) {
  const n = group.advisories.length;
  return `chore(deps): bump \`${group.package}\` to \`${group.fixedIn}\` in \`${group.manifestPath}\` (${n} ${n === 1 ? "advisory" : "advisories"})`;
}

/** Escape a value going into a Markdown table cell. */
const cell = (value) => String(value).replace(/\|/g, "\\|");

const PLACEMENT_DOC =
  "https://github.com/modelcontextprotocol/inspector/blob/v2/main/AGENTS.md#dependency-placement";

/**
 * The packages a nested copy sits under, outermost first.
 *
 * `node_modules/ajv/node_modules/fast-uri` -> `["ajv"]`. Scope-aware, since a
 * scoped name contains a slash of its own.
 *
 * @param {string} path a lockfile `packages` key
 * @returns {string[]} empty for the hoisted copy
 */
export function overrideAncestors(path) {
  const segments = path.replace(/^node_modules\//, "").split("/node_modules/");
  return segments.slice(0, -1);
}

/**
 * A concrete parent-scoped `overrides` block for the nested vulnerable copies.
 *
 * npm rejects a package-wide override that contradicts a direct dependency of
 * the same name (`EOVERRIDE`), so when the manifest declares the package the
 * nested copies must be reached through their parents instead.
 *
 * @param {Array<{path: string, hoisted: boolean}>} affected
 * @param {{package: string, fixedIn: string}} group
 * @returns {string} pretty-printed JSON
 */
export function scopedOverrideExample(affected, group) {
  const overrides = {};
  for (const entry of affected) {
    const ancestors = overrideAncestors(entry.path);
    if (ancestors.length === 0) continue;
    let node = overrides;
    for (const ancestor of ancestors) {
      node[ancestor] = node[ancestor] ?? {};
      node = node[ancestor];
    }
    node[group.package] = group.fixedIn;
  }
  return JSON.stringify({ overrides }, null, 2);
}

/**
 * What the maintainer actually has to change, derived from WHICH copies are
 * vulnerable rather than from whether the package is declared.
 *
 * The three cases are genuinely different edits, and the mixed one is why this
 * is not a boolean (Copilot):
 *
 * | vulnerable copies | fix |
 * | --- | --- |
 * | the declared (hoisted) one | raise the declared range |
 * | nested ones only | an `overrides` pin |
 * | both | both, and neither alone is enough |
 *
 * A manifest declaring a safe `pkg@^4` alongside a dependency that drags in a
 * vulnerable nested `pkg@3` lands in the middle row: the declared range is
 * already correct, and raising it changes nothing.
 *
 * @param {Array<{path: string, version: string, hoisted: boolean}>} affected
 * @param {boolean} declared whether the manifest declares the package
 * @returns {{direct: boolean, transitive: boolean}}
 */
export function remediation(affected, declared) {
  const isDeclaredCopy = (entry) => declared && entry.hoisted;
  return {
    direct: affected.some(isDeclaredCopy),
    // Everything that is NOT the declared copy needs the override — nested
    // copies, and also a hoisted copy of a package this manifest never
    // declared, which got there transitively like any other.
    transitive: affected.some((entry) => !isDeclaredCopy(entry)),
  };
}

/**
 * @param {ReturnType<typeof groupAlerts>[number]} group
 * @param {{affected: Array<{path: string, version: string, hoisted: boolean}>, declared: boolean, ghsas?: string[]}} probe
 *   `ghsas` overrides the marker's list when an existing issue is being
 *   rewritten to cover advisories it did not originally name.
 * @returns {string}
 */
export function buildIssueBody(
  group,
  { affected, declared, ghsas, securityPrsOff = true },
) {
  const covered = ghsas ?? group.ghsas;
  const applying = group.advisories.length;
  // ⚠️ Every free-form cell is escaped, the RANGE included: a semver range is
  // allowed to contain `||`, so a disjoint advisory range like
  // `>= 1.0, < 2.0 || >= 3.0, < 3.5` would otherwise inject two extra column
  // separators and shear the table apart (Copilot).
  const rows = group.advisories
    .map(
      (a) =>
        `| [${a.ghsa}](${a.url}) | ${cell(a.cve ?? "—")} | ${cell(a.severity)} | ${cell(a.range)} | ${cell(a.summary)} |`,
    )
    .join("\n");

  const manifestJson = group.manifestPath.replace(
    /package-lock\.json$/,
    "package.json",
  );
  const { direct, transitive } = remediation(affected, declared);
  const steps = [];
  if (direct) {
    steps.push(
      `**Raise the declared range in \`${manifestJson}\`** so \`${group.package}\` can no longer resolve below \`${group.fixedIn}\`, keeping the operator the manifest already uses — widening it to a bare \`>=\` would drop the compatibility bound with it.`,
    );
  }
  if (transitive) {
    steps.push(
      direct
        ? // ⚠️ A package-wide override cannot be used here: npm rejects an
          // override whose spec differs from a direct dependency of the same
          // name with EOVERRIDE, and this manifest declares one (Copilot). The
          // nested copies have to be reached through their parents.
          `**Add a parent-scoped [\`overrides\`](${PLACEMENT_DOC}) entry** for the nested copies below, which the declared range does not reach:\n\n\`\`\`json\n${scopedOverrideExample(affected, group)}\n\`\`\`\n\n   A package-wide \`"${group.package}": "${group.fixedIn}"\` would be rejected with \`EOVERRIDE\`, because this manifest also declares \`${group.package}\` directly and npm refuses an override that contradicts a direct dependency. **Not** \`npm audit fix\` either, which "resolves" an advisory with no upward escape by silently downgrading.`
        : `**Add an [\`overrides\`](${PLACEMENT_DOC}) entry** pinning \`${group.package}\` to \`${group.fixedIn}\`, for the copies below, which no declared range reaches. **Not** \`npm audit fix\`, which "resolves" an advisory with no upward escape by silently downgrading.`,
    );
  }
  const fix = [
    ...(steps.length === 2
      ? [
          "Both edits are needed; neither alone clears every vulnerable copy.",
          "",
        ]
      : []),
    ...steps.map((step, i) => (steps.length > 1 ? `${i + 1}. ${step}` : step)),
    "",
    "| Vulnerable copy | Version |",
    "| --- | --- |",
    ...affected.map((e) => `| \`${e.path}\` | \`${e.version}\` |`),
  ].join("\n");

  return [
    buildMarker({ ...group, ghsas: covered }),
    // Counts what APPLIES, like the title and the table — `covered` is the
    // marker's monotonic history and would keep counting an advisory that has
    // since closed (Copilot).
    // ⚠️ The security-PR claim is only made when the run actually READ the
    // setting. The guard degrades to UNVERIFIED when the token cannot see it,
    // and an issue asserting what the run explicitly could not confirm is worse
    // than one that says so (Copilot).
    `Filed automatically from ${applying} open Dependabot ${applying === 1 ? "alert" : "alerts"} (#2233). ${securityPrsOff ? "Dependabot opens no security-update PRs on this repo; the" : "The"} fix is written by hand against \`${TARGET_BRANCH}\`.`,
    "",
    "| | |",
    "| --- | --- |",
    `| Package | \`${group.package}\` |`,
    `| Manifest | \`${group.manifestPath}\` |`,
    `| Vulnerable on \`${TARGET_BRANCH}\` | ${[...new Set(affected.map((e) => e.version))].map((v) => `\`${v}\``).join(", ") || "—"} |`,
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
    `> **Priority is a standing rubric override.** A routine bump scores Medium; a security bump is filed **${BOARD_PRIORITY}** so it does not sit.`,
    ">",
    `> **Where each number comes from.** The GHSA, CVE, severity, vulnerable range and summary are the advisory's own, reported by Dependabot. What was verified independently against \`${TARGET_BRANCH}\` is the **installed versions, their paths, and whether each advisory's range still matches** — GitHub computes alerts from the default branch, so an alert is filed here only after that re-check.`,
  ].join("\n");
}

/**
 * The body an issue is rewritten to once its exposure is gone.
 *
 * The marker is retained, so the sweep still recognises this issue and will not
 * file a fresh one if the same advisory comes back into range. The issue is NOT
 * closed automatically: whether the exposure went away because a PR fixed it or
 * because the dependency was dropped decides whether the board card is moved to
 * Done or deleted, and that is a judgement the sweep cannot make.
 *
 * @param {ReturnType<typeof groupAlerts>[number]} group
 * @param {{ghsas: string[], reason: string, today: string}} context
 * @returns {string}
 */
export function buildClearedBody(group, { ghsas, reason, today }) {
  return [
    buildMarker({ ...group, ghsas }),
    `**No longer applicable on \`${TARGET_BRANCH}\` as of ${today}** — ${reason}.`,
    "",
    `Nothing here needs bumping any more: \`${group.package}\` is no longer exposed to ${ghsas.length === 1 ? "the advisory" : "the advisories"} below on the branch we ship from. This body is rewritten in place rather than the issue being closed, because whether the card belongs in **Done** or should be **deleted** depends on why the exposure went away — a merged fix shipped something, a dropped dependency did not.`,
    "",
    `Previously covered: ${ghsas.map((g) => `\`${g}\``).join(", ")}.`,
    "",
    "If the same advisory comes back into range, this issue is reused rather than a new one filed.",
  ].join("\n");
}

/**
 * The marker that makes a "new advisories" comment idempotent on its own.
 *
 * @param {string[]} added
 * @returns {string}
 */
export function buildCommentMarker(added) {
  return `<!-- dependabot-alerts:added ${[...added].sort().join(",")} -->`;
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
    buildCommentMarker(added),
    // ⚠️ Posted BEFORE the body edit, so it must not assert anything about the
    // body's current state — the edit may not have happened yet, and may fail
    // (Copilot). It speaks for the comment's own marker, which is true the
    // moment this is posted.
    `${added.length} new Dependabot ${added.length === 1 ? "advisory" : "advisories"} for \`${group.package}\`, cleared by the same bump to \`${group.fixedIn}\`. This comment's own marker records ${added.length === 1 ? "it" : "them"} as announced, so a later run will not repeat this even if the issue body has yet to catch up.`,
    "",
    "| GHSA | Severity | Summary |",
    "| --- | --- | --- |",
    rows,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Impure half: everything below shells out to `gh`. Each takes its spawn
// function as a parameter, defaulted to `spawnSync`, so `main()` is testable
// with an injected fake rather than left to `workflow_dispatch` — the same
// shape `dependency-refresh.mjs` uses.
// ---------------------------------------------------------------------------

function gh(spawn, args, { token } = {}) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  const result = spawn("gh", args, { encoding: "utf8", env });
  if (result.error) throw result.error;
  return result;
}

function ghJson(spawn, args) {
  const result = gh(spawn, args);
  if (result.status !== 0) {
    throw new Error(`gh ${args[0]} failed: ${(result.stderr ?? "").trim()}`);
  }
  return JSON.parse(result.stdout || "null");
}

/**
 * Is this failed lookup the "this token may not read that" answer, rather than
 * a real API failure?
 *
 * The distinction is what keeps the security-PR guard honest: a bad token, a
 * rate limit or a transient 5xx must NOT be waved through as "unverified", or
 * the sweep exits green having silently skipped its own precondition.
 *
 * ⚠️ Status alone is not enough, which is what the first version got wrong
 * (Copilot). GitHub answers BOTH "you lack `administration: read`" and "you
 * have exhausted your quota" with **403**, and the second is a real failure —
 * so the rate-limit wording is excluded explicitly. **401** is a bad or expired
 * token, never a scope question, and is a real failure too. **404** stays
 * tolerated because GitHub hides resources a token cannot see behind one rather
 * than admitting they exist.
 *
 * @param {string} stderr stderr from a non-zero `gh api` call
 * @returns {boolean}
 */
export function isPermissionDenied(stderr) {
  if (/rate limit/i.test(stderr)) return false;
  return /HTTP (403|404)\b/.test(stderr);
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
 * for a reason unrelated to the alerts. An authorization-shaped failure is
 * therefore reported and skipped; every other failure throws, and an explicit
 * `enabled: true` throws. Give `PROJECT_TOKEN` the extra `administration: read`
 * scope and the guard becomes a real assertion; without it the sweep still does
 * its job, it just cannot see that setting.
 *
 * @returns {boolean} whether the setting was actually read
 */
function checkSecurityPrsStillDisabled(repo, spawn) {
  const result = gh(spawn, ["api", `repos/${repo}/automated-security-fixes`], {
    token: process.env.PROJECT_TOKEN,
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    if (!isPermissionDenied(stderr)) {
      throw new Error(`automated-security-fixes lookup failed: ${stderr}`);
    }
    console.log(
      `dependabot-alerts: cannot read automated-security-fixes (${stderr}) — ` +
        "the token lacks `administration: read`, so whether Dependabot security " +
        "PRs are still off is UNVERIFIED this run",
    );
    return false;
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
  return true;
}

/**
 * Every open Dependabot alert.
 *
 * ⚠️ `--slurp` is load-bearing. Without it `gh api --paginate` concatenates one
 * top-level JSON array PER PAGE, which `JSON.parse` rejects outright the moment
 * open alerts exceed the 100-per-page limit (Copilot). With it the pages arrive
 * as an array of arrays, flattened here.
 */
function openAlerts(repo, spawn) {
  const pages = ghJson(spawn, [
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/dependabot/alerts?state=open&per_page=100`,
  ]);
  return (pages ?? []).flat();
}

/**
 * A manifest's contents in the checkout, or `null` when it is absent — an alert
 * against a manifest this branch does not have is not actionable.
 */
function readManifest(manifestPath) {
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Belt and braces behind the ecosystem filter: whatever this is, it is not
    // an npm lockfile, and one unparseable manifest must not abort the sweep.
    console.log(
      `dependabot-alerts: ${manifestPath} is not JSON — skipping (not an npm lockfile)`,
    );
    return null;
  }
}

/**
 * Every open `dependabot`-labeled issue.
 *
 * Paginated rather than capped: the marker lookup is what makes this sweep
 * idempotent, so a truncated list files a duplicate for every issue it could
 * not see — at exactly the scale the `--slurp`ed alert fetch is built to handle
 * (Copilot). `/issues` also returns pull requests, which carry no marker and
 * are dropped.
 */
function openDependabotIssues(repo, spawn) {
  const pages = ghJson(spawn, [
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/issues?state=open&labels=dependabot&per_page=100`,
  ]);
  return (pages ?? [])
    .flat()
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
    }));
}

/**
 * Every GHSA already announced by a comment on an issue, unioned.
 *
 * Unioned per ADVISORY, not compared per comment. Comparing whole sets looks
 * equivalent and is not: a run that posts `[B]` and then fails before rewriting
 * the marker leaves the next run computing `[B, C]`, which matches no existing
 * comment, and `B` is announced a second time (Copilot). Individual GHSAs are
 * what a comment actually claims to have announced.
 */
function announcedAdvisories(repo, number, spawn) {
  const issue = ghJson(spawn, [
    "issue",
    "view",
    String(number),
    "--repo",
    repo,
    "--json",
    "comments",
  ]);
  const announced = new Set();
  for (const comment of issue?.comments ?? []) {
    for (const ghsa of parseCommentMarker(comment.body) ?? []) {
      announced.add(ghsa);
    }
  }
  return announced;
}

function currentMilestone(repo, spawn) {
  const result = gh(spawn, ["api", `repos/${repo}/milestones?state=open`]);
  if (result.status !== 0) {
    throw new Error(`milestone lookup failed: ${(result.stderr ?? "").trim()}`);
  }
  return pickMilestone(JSON.parse(result.stdout || "[]"));
}

/**
 * Resolve a single-select option id by NAME.
 *
 * Option ids are regenerated whenever the field's option list is edited, so
 * looking them up each run is what keeps an unrelated board edit from turning
 * into a silently mis-set field here.
 */
function optionId(fieldName, optionName, token, spawn) {
  const result = gh(
    spawn,
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
 * Failing to add the card at all is benign — the issue is already labeled and
 * milestoned, which is enough for the next `/issue-triage` sweep to board it
 * (its documented exception moves an unboarded-but-milestoned issue straight
 * into Todo). That is why an org-project PAT is an optimization here rather
 * than a prerequisite.
 *
 * ⚠️ **Failing PART WAY through is not benign**, and the two cases must not be
 * reported the same way (Copilot). Once `item-add` succeeds the issue IS
 * boarded, so no later triage sweep will look at it — a failed field edit
 * leaves a card sitting on the board with no Status or no Priority, in exactly
 * the state nothing else will fix. So a partial placement is returned to the
 * caller, which finishes every remaining group and then fails the run.
 *
 * Todo rather than Incoming: arriving through this pipeline IS the approval.
 *
 * @returns {string | null} a description of a PARTIAL placement, else `null`
 */
function addToBoard(issueUrl, spawn) {
  const token = process.env.PROJECT_TOKEN;
  if (!token) {
    console.log(
      "dependabot-alerts: PROJECT_TOKEN unset — issue left unboarded for the next triage sweep",
    );
    return null;
  }

  let itemId;
  try {
    const added = gh(
      spawn,
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
    if (added.status !== 0) throw new Error((added.stderr ?? "").trim());
    itemId = JSON.parse(added.stdout).id;
  } catch (error) {
    // Nothing was added, so the issue is simply unboarded — recoverable.
    console.log(
      `dependabot-alerts: board add failed (${error.message}) — issue is labeled and milestoned, next triage sweep will board it`,
    );
    return null;
  }

  // Each item-edit sets exactly one field, so Status and Priority are two calls.
  for (const [fieldId, fieldName, optionName] of [
    [STATUS_FIELD_ID, "Status", BOARD_STATUS],
    [PRIORITY_FIELD_ID, "Priority", BOARD_PRIORITY],
  ]) {
    try {
      const edit = gh(
        spawn,
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
          optionId(fieldName, optionName, token, spawn),
        ],
        { token },
      );
      if (edit.status !== 0) throw new Error((edit.stderr ?? "").trim());
    } catch (error) {
      return `${issueUrl} is on board #28 but its ${fieldName} was not set (${error.message}) — no triage sweep will fix this, set it by hand`;
    }
  }

  console.log(
    `dependabot-alerts: boarded ${issueUrl} at ${BOARD_STATUS}/${BOARD_PRIORITY}`,
  );
  return null;
}

/**
 * @returns {{url: string, milestone: string | null}}
 */
function createIssue(repo, group, body, spawn) {
  const milestone = currentMilestone(repo, spawn);
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
  const result = gh(spawn, args);
  if (result.status !== 0) {
    throw new Error(`gh issue create failed: ${(result.stderr ?? "").trim()}`);
  }
  const url = result.stdout.trim();
  console.log(`dependabot-alerts: filed ${url}`);
  return { url, milestone };
}

export function main(
  repo = process.env.GITHUB_REPOSITORY,
  spawn = spawnSync,
  today = new Date().toISOString().slice(0, 10),
) {
  if (!repo) throw new Error("repo not specified (GITHUB_REPOSITORY unset)");

  const securityPrsOff = checkSecurityPrsStillDisabled(repo, spawn);

  const alerts = openAlerts(repo, spawn);
  const groups = groupAlerts(alerts);

  // ⚠️ Loaded BEFORE the zero-group early return, and reconciled after the loop.
  // `openAlerts` asks for `state=open`, so an alert that is FIXED or DISMISSED
  // simply vanishes from the feed — its group is never built, the loop never
  // visits it, and the issue it produced would keep asserting a vulnerability
  // with a live Todo/High card forever (Copilot). The disappearance is the
  // signal, so it has to be read from the issues rather than from the alerts.
  const existingIssues = openDependabotIssues(repo, spawn).map((issue) => ({
    ...issue,
    marker: parseMarker(issue.body),
  }));

  const manifests = new Map();
  const boardProblems = [];
  /** Grouping keys this run actually saw in the open feed. */
  const seenKeys = new Set();
  /**
   * Every GHSA still open, taken from the RAW feed rather than from `groups`.
   *
   * ⚠️ `groupAlerts` deliberately drops an alert with no `first_patched_version`
   * — there is nothing to bump to, so nothing to file. Building this set from
   * the groups would inherit that filter, so an advisory that stays open but
   * LOSES its patched version would vanish from both the keys and this set, and
   * reconciliation would call it "fixed or dismissed" (Copilot). Same wrong
   * direction as the superseded case, reached a different way: what a still-open
   * advisory must never do is stand itself down.
   */
  const openGhsas = new Set(
    alerts
      .filter((a) => a.state === "open")
      .map((a) => a.security_advisory?.ghsa_id)
      .filter(Boolean),
  );

  for (const rawGroup of groups) {
    seenKeys.add(rawGroup.key);

    if (rawGroup.ecosystem !== SUPPORTED_ECOSYSTEM) {
      // Loud, not silent: nothing else will file this, so a human has to.
      console.log(
        `dependabot-alerts: ${rawGroup.package} (${rawGroup.ecosystem}, ${rawGroup.manifestPath}) is not an npm dependency — this sweep cannot file it, raise it by hand: ${rawGroup.ghsas.join(", ")}`,
      );
      continue;
    }

    // ⚠️ Resolved BEFORE the skips below, not after. An issue filed yesterday
    // is still open today, and if the manifest has since gone or every copy has
    // moved out of range, skipping straight past it leaves its body asserting a
    // vulnerability that no longer exists and its Todo/High card live forever
    // (Copilot). Matched on the full grouping key, `fixedIn` included: a second
    // bump of the same package is a different issue, not an update to this one.
    const existing = existingIssues.find(
      (i) =>
        i.marker?.package === rawGroup.package &&
        i.marker?.manifestPath === rawGroup.manifestPath &&
        i.marker?.fixedIn === rawGroup.fixedIn,
    );

    /** Rewrite an open issue to its cleared state, once. */
    const clear = (reason) => {
      if (!existing) return;
      const body = buildClearedBody(rawGroup, {
        ghsas: existing.marker.ghsas,
        reason,
        today,
      });
      if (existing.body === body) return;
      const edit = gh(spawn, [
        "issue",
        "edit",
        String(existing.number),
        "--repo",
        repo,
        "--body",
        body,
      ]);
      if (edit.status !== 0) {
        throw new Error(`gh issue edit failed: ${(edit.stderr ?? "").trim()}`);
      }
      console.log(`dependabot-alerts: cleared #${existing.number} — ${reason}`);
    };

    if (!manifests.has(rawGroup.manifestPath)) {
      manifests.set(rawGroup.manifestPath, readManifest(rawGroup.manifestPath));
    }
    const lock = manifests.get(rawGroup.manifestPath);
    if (lock === null) {
      console.log(
        `dependabot-alerts: ${rawGroup.manifestPath} absent on ${TARGET_BRANCH} — skipping ${rawGroup.package}`,
      );
      clear(`\`${rawGroup.manifestPath}\` is no longer part of this repo`);
      continue;
    }

    const entries = lockfileEntries(lock, rawGroup.package);
    const applicable = narrowToApplicable(rawGroup, entries);
    if (applicable === null) {
      const seen = [...new Set(entries.map((e) => e.version))];
      console.log(
        `dependabot-alerts: ${rawGroup.package}@${seen.join("/") || "(absent)"} is already out of range on ${TARGET_BRANCH} — skipping`,
      );
      clear(
        seen.length > 0
          ? `every installed copy is out of range (${seen.map((v) => `\`${v}\``).join(", ")})`
          : "the package is no longer installed at all",
      );
      continue;
    }
    // From here on `group` carries only the advisories that apply to this
    // branch, so the marker, title, severity and table cannot overstate it.
    const { group, affected } = applicable;

    const declared = isDirectDependency(lock, group.package);

    if (!existing) {
      const { url, milestone } = createIssue(
        repo,
        group,
        buildIssueBody(group, { affected, declared, securityPrsOff }),
        spawn,
      );
      // `Incoming` <=> no milestone, everything past it <=> milestoned. With no
      // open milestone to assign there is nothing to put the card past Incoming
      // WITH, so boarding it at Todo would assert an approval the invariant
      // reads off the milestone (Copilot). Leave it for triage instead.
      if (!milestone) {
        console.log(
          "dependabot-alerts: no open milestone — issue filed unmilestoned and unboarded, next triage sweep places it",
        );
        continue;
      }
      const problem = addToBoard(url, spawn);
      if (problem) boardProblems.push(problem);
      continue;
    }

    const { merged, added } = mergeGhsas(existing.marker.ghsas, group.ghsas);
    const title = buildIssueTitle(group);
    const body = buildIssueBody(group, {
      affected,
      declared,
      ghsas: merged,
      securityPrsOff,
    });

    // ⚠️ "Nothing NEW" is not the same as "nothing CHANGED" (Copilot). An issue
    // filed for A+B whose branch has since moved so only B applies has no added
    // GHSAs, yet its table, severity, affected copies and remediation are all
    // stale. So the no-op is decided by comparing the rendered issue, not by
    // counting additions — while a COMMENT stays reserved for advisories that
    // are genuinely new.
    if (
      added.length === 0 &&
      existing.title === title &&
      existing.body === body
    ) {
      console.log(
        `dependabot-alerts: #${existing.number} is up to date for ${group.package} — no-op`,
      );
      continue;
    }

    // ⚠️ Comment FIRST, then rewrite the marker. The marker is the idempotency
    // key, so editing it first and failing on the comment would make the next
    // run take the no-op branch above and skip the comment permanently
    // (Copilot). In this order the worst case is a repeat, and the comment's
    // own marker rules that out too.
    const announced = announcedAdvisories(repo, existing.number, spawn);
    const unannounced = added.filter((ghsa) => !announced.has(ghsa));
    if (unannounced.length > 0) {
      const comment = gh(spawn, [
        "issue",
        "comment",
        String(existing.number),
        "--repo",
        repo,
        "--body",
        buildNewAdvisoryComment(group, unannounced),
      ]);
      if (comment.status !== 0) {
        throw new Error(
          `gh issue comment failed: ${(comment.stderr ?? "").trim()}`,
        );
      }
    }

    const edit = gh(spawn, [
      "issue",
      "edit",
      String(existing.number),
      "--repo",
      repo,
      "--title",
      title,
      "--body",
      body,
    ]);
    if (edit.status !== 0) {
      throw new Error(`gh issue edit failed: ${(edit.stderr ?? "").trim()}`);
    }
    console.log(
      added.length > 0
        ? `dependabot-alerts: added ${added.join(", ")} to #${existing.number}`
        : `dependabot-alerts: refreshed #${existing.number} for ${group.package}`,
    );
  }

  // Any marked issue whose bump is no longer in the open feed at all: its last
  // alert was fixed or dismissed, so there is nothing left to bump.
  for (const issue of existingIssues) {
    if (!issue.marker) continue;
    const key = groupKey(
      issue.marker.package,
      issue.marker.manifestPath,
      issue.marker.fixedIn,
    );
    if (seenKeys.has(key)) continue;

    // ⚠️ A vanished KEY is not the same as a closed ADVISORY. GitHub can revise
    // an alert's `first_patched_version`, which moves it to a different key
    // while the GHSA stays open — reporting that as "fixed or dismissed" would
    // stand down a live exposure (Copilot). So the reason is decided by whether
    // the GHSAs are still in the open feed, not by the key's absence.
    const stillOpen = issue.marker.ghsas.filter((g) => openGhsas.has(g));
    const reason =
      stillOpen.length > 0
        ? `this bump was superseded — ${stillOpen.map((g) => `\`${g}\``).join(", ")} ${stillOpen.length === 1 ? "is" : "are"} still open under a different patched version, and ${stillOpen.length === 1 ? "has" : "have"} their own issue`
        : "every alert it tracked has been fixed or dismissed";

    const body = buildClearedBody(
      {
        package: issue.marker.package,
        manifestPath: issue.marker.manifestPath,
        fixedIn: issue.marker.fixedIn,
      },
      { ghsas: issue.marker.ghsas, reason, today },
    );
    if (issue.body === body) continue;
    const edit = gh(spawn, [
      "issue",
      "edit",
      String(issue.number),
      "--repo",
      repo,
      "--body",
      body,
    ]);
    if (edit.status !== 0) {
      throw new Error(`gh issue edit failed: ${(edit.stderr ?? "").trim()}`);
    }
    console.log(
      `dependabot-alerts: cleared #${issue.number} — no open alert remains for ${issue.marker.package}`,
    );
  }

  if (groups.length === 0) {
    console.log("dependabot-alerts: no open alerts");
  }

  // Every group is processed before this throws: a half-placed card is worth
  // failing the run over, but not at the cost of the issues still unfiled.
  if (boardProblems.length > 0) {
    throw new Error(
      `dependabot-alerts: incomplete board placement —\n  ${boardProblems.join("\n  ")}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
