#!/usr/bin/env node
// Sweep for unboarded open issues (#2558) — `npm run board:sweep`. Pass 1 of
// the issue-triage skill, which previously transcribed this as a mktemp +
// dual-dump + jq-union block.
//
// Diffs the open issues against BOTH boards — diffing against #28 alone
// reports a v1 issue correctly carded on #11 as unboarded, which is how a
// past sweep double-boarded one (#1929). Both dumps are trusted only when
// complete (`itemListComplete`), because a silently truncated listing makes a
// carded issue read as unboarded and get double-carded. Prints each unboarded
// issue with its destination (milestoned already → Todo, else → Incoming) and
// exits non-zero when any exist, so "the sweep is clean" is checkable.

import { spawnSync } from "node:child_process";
import { REPO_SLUG, ghJson } from "./lib/gh.mjs";
import { itemListComplete } from "./lib/board.mjs";

export const BOARDS = [28, 11];
const ISSUE_LIMIT = 2000;

/** Issue numbers carded on a board, filtered to this repo's real issues. */
export function boardedNumbers(items) {
  return items
    .filter(
      (item) =>
        item?.content?.type === "Issue" &&
        item.content.repository === REPO_SLUG,
    )
    .map((item) => item.content.number);
}

/** The unboarded open issues, each with the destination column it should get. */
export function unboarded(openIssues, boarded) {
  const carded = new Set(boarded);
  return openIssues
    .filter((issue) => !carded.has(issue.number))
    .map((issue) => ({
      number: issue.number,
      destination: issue.milestone
        ? `Todo (has milestone ${issue.milestone.title})`
        : "Incoming",
    }));
}

export function main(_argv = process.argv.slice(2), spawn = spawnSync) {
  const open = ghJson(spawn, [
    "issue",
    "list",
    "--repo",
    REPO_SLUG,
    "--state",
    "open",
    "--limit",
    String(ISSUE_LIMIT),
    "--json",
    "number,milestone",
  ]);
  // `gh issue list` reports no total, so a listing AT the limit is treated as
  // possibly truncated — the same refusal the board dumps get.
  if (open.length >= ISSUE_LIMIT) {
    throw new Error(
      `open-issue listing hit --limit ${ISSUE_LIMIT} — raise it and re-run`,
    );
  }

  const boarded = BOARDS.flatMap((board) =>
    boardedNumbers(itemListComplete(spawn, board).items),
  );

  const missing = unboarded(open, boarded);
  for (const issue of missing) {
    console.log(`#${issue.number}\t→ ${issue.destination}`);
  }
  console.log(`unboarded: ${missing.length}`);
  if (missing.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
