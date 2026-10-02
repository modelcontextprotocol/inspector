#!/usr/bin/env node
// Wait for a Copilot review round to resolve (#2558) — `npm run
// pr:review-wait -- --pr <N> --expected <K>`. Step 7b of the pr-flow skill,
// which previously transcribed this as a ~30-line bash loop rebuilt from
// scratch on every round.
//
// A round ends one of two ways: Copilot POSTS a review, or its pending
// request DISAPPEARS without one (the session failed, or occasionally it has
// nothing to say). Waiting only for the review hangs forever on the second
// case, so this watches both, plus a hard deadline. The outcome is the last
// stdout line, exactly one of:
//
//   ROUND=posted               — the Copilot review count reached --expected
//   ROUND=ended-without-review — the pending request cleared with no review
//   ROUND=timed-out            — the deadline passed with the request pending
//
// `--expected` is the review COUNT to reach, not a delta: earlier rounds'
// reviews are still on the PR, so round two waits for a count of 2. All three
// outcomes exit 0 — they are answers, and the caller's decision table (pr-flow
// 7c) owns what each means. A gh/API/parse failure instead THROWS and exits
// non-zero: an error swallowed into a zero count would make a background wait
// retry blind forever, which is the exact failure the skill's inline loop
// spent half its lines defending against.
//
// Intended to run in the background (`npm run pr:review-wait … &` or an async
// shell) — per AGENTS.md "Waiting on long-running work", remote state the
// harness cannot observe is polled inside ONE backgrounded process, never one
// check per turn. On ROUND=posted, give the inline comments a further ~60s
// before fetching; they lag the review body (pr-flow step 8).

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  OWNER,
  REPO,
  REPO_SLUG,
  COPILOT_REVIEWER_LOGIN,
  ghGraphql,
  ghPaginatedList,
  requirePositiveInt,
} from "./lib/gh.mjs";

/** Remote-API polling floor per AGENTS.md "Waiting on long-running work". */
export const POLL_INTERVAL_MS = 30_000;
/** Rounds normally land in 2–10 minutes; 25 is the skill's historical cap. */
export const DEFAULT_TIMEOUT_MINUTES = 25;

/** Count the Copilot-posted reviews in a full (flattened) review listing. */
export function copilotReviewCount(reviews) {
  return reviews.filter(
    (review) => review?.user?.login === COPILOT_REVIEWER_LOGIN,
  ).length;
}

/** Count pending Copilot review requests in the GraphQL response. */
export function pendingCopilotRequests(response) {
  const nodes = response?.data?.repository?.pullRequest?.reviewRequests?.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error(
      `unexpected reviewRequests response shape: ${JSON.stringify(response)}`,
    );
  }
  return nodes.filter((node) =>
    /copilot/i.test(node?.requestedReviewer?.login ?? ""),
  ).length;
}

/**
 * Poll until the round resolves; returns the ROUND outcome string. Deps are
 * injectable for tests: `spawn` (gh), `sleep(ms)`, `now()` in ms.
 */
export async function waitForRound({ pr, expected, timeoutMinutes }, deps) {
  const { spawn, sleep, now } = deps;
  const deadline = now() + timeoutMinutes * 60_000;

  const count = () =>
    copilotReviewCount(
      ghPaginatedList(spawn, `repos/${REPO_SLUG}/pulls/${pr}/reviews`),
    );
  const pending = () =>
    pendingCopilotRequests(
      ghGraphql(
        spawn,
        `query($n:Int!){repository(owner:"${OWNER}",name:"${REPO}"){pullRequest(number:$n){reviewRequests(first:20){nodes{requestedReviewer{... on Bot{login} ... on User{login}}}}}}}`,
        { n: pr },
      ),
    );

  for (;;) {
    if (count() >= expected) {
      return "posted";
    }
    if (pending() === 0) {
      // The request can clear a beat before its review becomes visible.
      await sleep(POLL_INTERVAL_MS);
      return count() >= expected ? "posted" : "ended-without-review";
    }
    if (now() >= deadline) {
      return "timed-out";
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function parseWaitArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      pr: { type: "string" },
      expected: { type: "string" },
      "timeout-minutes": { type: "string" },
    },
  });
  return {
    pr: requirePositiveInt(values.pr, "--pr"),
    expected: requirePositiveInt(values.expected, "--expected"),
    timeoutMinutes:
      values["timeout-minutes"] === undefined
        ? DEFAULT_TIMEOUT_MINUTES
        : requirePositiveInt(values["timeout-minutes"], "--timeout-minutes"),
  };
}

export async function main(
  argv = process.argv.slice(2),
  deps = {
    spawn: spawnSync,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  },
) {
  const outcome = await waitForRound(parseWaitArgs(argv), deps);
  console.log(`ROUND=${outcome}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
