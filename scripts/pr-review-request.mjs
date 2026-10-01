#!/usr/bin/env node
// Request a Copilot review round on a PR (#2558) — `npm run pr:review-request
// -- --pr <N>`. Step 7a of the pr-flow skill, which previously transcribed
// this as an inline GraphQL block rebuilt from scratch on every round.
//
// Only the GraphQL `requestReviews` mutation with the Copilot BOT id works:
// REST, `gh pr edit --add-reviewer`, `userIds`, and `copilot-swe-agent` all
// fail or silently drop the request. `union:true` adds to any existing
// reviewers instead of replacing them.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { OWNER, REPO, ghGraphql, requirePositiveInt } from "./lib/gh.mjs";

/**
 * The `copilot-pull-request-reviewer` bot's node id — last verified
 * 2026-10-01. If the mutation starts rejecting it, re-resolve via the PR's
 * `suggestedReviewers`/`reviewRequests` connections or the web UI's reviewer
 * picker network calls; no plain lookup-by-login API exists for bots.
 */
export const COPILOT_BOT_ID = "BOT_kgDOCnlnWA";

/** Parse argv (everything after `node script.mjs`) into a validated PR number. */
export function parseRequestArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { pr: { type: "string" } },
  });
  return { pr: requirePositiveInt(values.pr, "--pr") };
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { pr } = parseRequestArgs(argv);

  const prId = ghGraphql(
    spawn,
    `query($n:Int!){repository(owner:"${OWNER}",name:"${REPO}"){pullRequest(number:$n){id}}}`,
    { n: pr },
  ).data?.repository?.pullRequest?.id;
  if (!prId) {
    throw new Error(`PR #${pr} not found in ${OWNER}/${REPO}`);
  }

  const result = ghGraphql(
    spawn,
    "mutation($pr:ID!,$bot:[ID!]!){requestReviews(input:{pullRequestId:$pr, botIds:$bot, union:true}){pullRequest{id}}}",
    { pr: prId, bot: COPILOT_BOT_ID },
  );
  if (!result.data?.requestReviews?.pullRequest?.id) {
    throw new Error(
      `requestReviews returned no pullRequest — response: ${JSON.stringify(result)}`,
    );
  }

  console.log(`requested: Copilot review on PR #${pr}`);
  console.log(
    `next: npm run pr:review-wait -- --pr ${pr} --expected <review count to reach>`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
