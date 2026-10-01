#!/usr/bin/env node
// Fetch a Copilot review round's content (#2558) — `npm run pr:review-fetch
// -- --pr <N> [--review <REVIEW_ID>]`. Step 8 of the pr-flow skill, which
// previously transcribed this as a paginated fetch + jq block rebuilt every
// round.
//
// Without `--review` it resolves the LATEST Copilot review by `submitted_at`.
// Comments are fetched by REVIEW id — the unpaginated /reviews listing hides
// later rounds behind your own replies — and paginated completely, because a
// round you only half fetch is a round you only half answer.
//
// The review BODY is printed in full: the headline sentence and the
// "Suppressed comments" block live there, and a zero-comment round can still
// name a real bug in either (pr-flow 7c's definition of "clean" reads all
// three channels).

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { REPO_SLUG, ghPaginatedList, requirePositiveInt } from "./lib/gh.mjs";

/** The latest Copilot-posted review in a flattened listing, or undefined. */
export function latestCopilotReview(reviews) {
  return reviews
    .filter((review) =>
      (review?.user?.login ?? "").startsWith("copilot-pull-request-reviewer"),
    )
    .sort((a, b) =>
      String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? "")),
    )
    .at(-1);
}

/** One review comment, shaped for replying into its thread by id. */
export function formatComment(comment) {
  const line = comment.line ?? comment.original_line ?? "?";
  return `COMMENT=${comment.id} ${comment.path}:${line}\n${comment.body}`;
}

export function parseFetchArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { pr: { type: "string" }, review: { type: "string" } },
  });
  return {
    pr: requirePositiveInt(values.pr, "--pr"),
    review:
      values.review === undefined
        ? undefined
        : requirePositiveInt(values.review, "--review"),
  };
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { pr, review } = parseFetchArgs(argv);

  let reviewId = review;
  let header = "";
  if (reviewId === undefined) {
    const latest = latestCopilotReview(
      ghPaginatedList(spawn, `repos/${REPO_SLUG}/pulls/${pr}/reviews`),
    );
    if (!latest) {
      throw new Error(`PR #${pr} has no Copilot review`);
    }
    reviewId = latest.id;
    header = `REVIEW=${latest.id} SUBMITTED=${latest.submitted_at}\n${latest.body}`;
  } else {
    header = `REVIEW=${reviewId}`;
  }

  const comments = ghPaginatedList(
    spawn,
    `repos/${REPO_SLUG}/pulls/${pr}/reviews/${reviewId}/comments`,
  );

  console.log(header);
  console.log(`\n--- ${comments.length} inline comment(s) ---`);
  for (const comment of comments) {
    console.log(`\n${formatComment(comment)}`);
  }
  console.log(
    `\nreply per thread: gh api repos/${REPO_SLUG}/pulls/${pr}/comments/<COMMENT>/replies -f body='…'`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
