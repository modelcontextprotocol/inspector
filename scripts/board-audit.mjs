#!/usr/bin/env node
// Audit both project boards against their invariants (#2558) — `npm run
// board:audit`. The audit pass of the issue-triage skill, which previously
// transcribed this as a ~70-line mktemp + jq block that had to be reproduced
// verbatim every run. The invariants themselves are AGENTS.md rules
// ("Issue-driven Work Style") and the issue-triage skill's audit table; this
// script is their mechanical form.
//
// Every dump is trusted only when complete: both board listings go through
// `itemListComplete`, and the issue dump is refused at its own --limit, so a
// silent truncation reads as an error instead of as a clean audit (#2451).
//
// Output is one line per check — `<count>\t<check>\t<first few offenders>` —
// and the exit code is non-zero when any check has offenders, so "the board
// is clean" is scriptable.

import { spawnSync } from "node:child_process";
import { REPO_SLUG, ghJson } from "./lib/gh.mjs";
import { itemListComplete } from "./lib/board.mjs";

const ISSUE_LIMIT = 2000;
const V2_BOARD = 28;
const V1_BOARD = 11;
const TYPE_LABELS = [
  "bug",
  "enhancement",
  "documentation",
  "chore",
  "question",
];
const SHOW = 10;

/** Keep this repo's items — and drafts, whose repository is null. */
export function own(items) {
  return items.filter(
    (item) =>
      item?.content?.repository == null ||
      item.content.repository === REPO_SLUG,
  );
}

const isIssue = (item) => item?.content?.type === "Issue";
const isGhsaDraft = (item) =>
  item?.content?.type === "DraftIssue" &&
  (item.content.title ?? "").startsWith("[GHSA-");
const num = (item) => `#${item.content.number}`;

/**
 * Run every invariant over complete dumps. `issues` is the all-state issue
 * dump; `v2`/`v1` are each board's own() items. Returns
 * [{ check, offenders }] with offenders as display strings.
 */
export function auditChecks(issues, v2, v1) {
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const issueOf = (item) => byNumber.get(item.content.number);
  const open = (item) => issueOf(item)?.state === "OPEN";
  const closed = (item) => issueOf(item)?.state === "CLOSED";
  const labels = (item) =>
    (issueOf(item)?.labels ?? []).map((label) => label.name);
  const milestone = (item) => issueOf(item)?.milestone != null;

  const v2Issues = v2.filter(isIssue);
  const v1Issues = v1.filter(isIssue);
  const v2Numbers = new Set(v2Issues.map((item) => item.content.number));

  const openIssues = issues.filter((issue) => issue.state === "OPEN");
  const labelCount = (issue, names) =>
    (issue.labels ?? []).filter((label) => names.includes(label.name)).length;

  return [
    {
      check: "double-boarded (a card on both #28 and #11)",
      offenders: v1Issues
        .filter((item) => v2Numbers.has(item.content.number))
        .map(num),
    },
    {
      check: "non-issue card (only [GHSA-…] drafts on #28 are allowed)",
      offenders: [
        ...v2.filter((item) => !isIssue(item) && !isGhsaDraft(item)),
        ...v1.filter((item) => !isIssue(item)),
      ].map((item) => item.content?.title ?? item.id),
    },
    {
      check: "GHSA draft missing Status or Priority (#28)",
      offenders: v2
        .filter(isGhsaDraft)
        .filter((item) => item.status == null || item.priority == null)
        .map((item) => item.content.title),
    },
    {
      check: "card with no Status",
      offenders: [...v2, ...v1]
        .filter((item) => item.status == null && !isGhsaDraft(item))
        .map((item) =>
          isIssue(item) ? num(item) : (item.content?.title ?? item.id),
        ),
    },
    {
      check: "Incoming but milestoned (#28)",
      offenders: v2Issues
        .filter((item) => item.status === "Incoming" && milestone(item))
        .map(num),
    },
    {
      check: "past Incoming but no milestone (open, #28)",
      offenders: v2Issues
        .filter(
          (item) =>
            item.status != null &&
            item.status !== "Incoming" &&
            item.status !== "Done" &&
            open(item) &&
            !milestone(item),
        )
        .map(num),
    },
    {
      check: "v1-labeled issue on #28 (open)",
      offenders: v2Issues
        .filter((item) => open(item) && labels(item).includes("v1"))
        .map(num),
    },
    {
      check: "v2-labeled issue on #11 (open)",
      offenders: v1Issues
        .filter((item) => open(item) && labels(item).includes("v2"))
        .map(num),
    },
    {
      check: "open issue without exactly one version label (v1/v2)",
      offenders: openIssues
        .filter((issue) => labelCount(issue, ["v1", "v2"]) !== 1)
        .map((issue) => `#${issue.number}`),
    },
    {
      check: `open issue without exactly one type label (${TYPE_LABELS.join("/")})`,
      offenders: openIssues
        .filter((issue) => labelCount(issue, TYPE_LABELS) !== 1)
        .map((issue) => `#${issue.number}`),
    },
    {
      check: "open #28 card with no Priority",
      offenders: v2Issues
        .filter((item) => open(item) && item.priority == null)
        .map(num),
    },
    {
      check: "closed-unshipped issue still carded (delete the card)",
      offenders: [...v2Issues, ...v1Issues]
        .filter(
          (item) => closed(item) && issueOf(item)?.stateReason !== "COMPLETED",
        )
        .map(num),
    },
    {
      check: "open issue carded Done",
      offenders: [...v2Issues, ...v1Issues]
        .filter((item) => open(item) && item.status === "Done")
        .map(num),
    },
  ];
}

export function main(_argv = process.argv.slice(2), spawn = spawnSync) {
  const issues = ghJson(spawn, [
    "issue",
    "list",
    "--repo",
    REPO_SLUG,
    "--state",
    "all",
    "--limit",
    String(ISSUE_LIMIT),
    "--json",
    "number,state,stateReason,labels,milestone",
  ]);
  if (issues.length >= ISSUE_LIMIT) {
    throw new Error(
      `issue listing hit --limit ${ISSUE_LIMIT} — raise it and re-run`,
    );
  }

  const v2 = own(itemListComplete(spawn, V2_BOARD).items);
  const v1 = own(itemListComplete(spawn, V1_BOARD).items);

  let dirty = false;
  for (const { check, offenders } of auditChecks(issues, v2, v1)) {
    const shown = offenders.slice(0, SHOW).join(" ");
    console.log(`${offenders.length}\t${check}${shown ? `\t${shown}` : ""}`);
    if (offenders.length > 0) {
      dirty = true;
    }
  }
  if (dirty) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
