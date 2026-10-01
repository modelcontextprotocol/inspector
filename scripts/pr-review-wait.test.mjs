// Tests for scripts/pr-review-wait.mjs (#2558) — the pure counters and the
// polling orchestration in `waitForRound()`, driven through injected
// spawn/sleep/now so nothing real is polled and no time passes. Run via
// `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POLL_INTERVAL_MS,
  copilotReviewCount,
  main,
  parseWaitArgs,
  pendingCopilotRequests,
  waitForRound,
} from "./pr-review-wait.mjs";

const review = (login) => ({ user: { login } });
const COPILOT = "copilot-pull-request-reviewer[bot]";

test("copilotReviewCount counts only Copilot reviews", () => {
  assert.equal(
    copilotReviewCount([review(COPILOT), review("alice"), review(COPILOT), {}]),
    2,
  );
});

test("pendingCopilotRequests matches copilot case-insensitively, throws on bad shape", () => {
  const resp = (nodes) => ({
    data: { repository: { pullRequest: { reviewRequests: { nodes } } } },
  });
  assert.equal(
    pendingCopilotRequests(
      resp([
        { requestedReviewer: { login: "Copilot" } },
        { requestedReviewer: { login: "alice" } },
        { requestedReviewer: null },
      ]),
    ),
    1,
  );
  assert.throws(() => pendingCopilotRequests({ data: {} }), /unexpected/);
});

/**
 * Drives waitForRound with scripted per-poll state. `states` is consumed one
 * entry per reviews-or-pending fetch pair: each entry holds the review logins
 * and the pending reviewer logins the API "returns" at that point in time.
 */
function fakeDeps(timeline) {
  let slept = 0;
  const sleeps = [];
  const spawn = (cmd, args) => {
    const state = timeline[0];
    assert.ok(state, `gh call after timeline exhausted: ${args.join(" ")}`);
    if (args.includes("--paginate")) {
      return {
        status: 0,
        stdout: JSON.stringify([state.reviews.map(review)]),
        stderr: "",
      };
    }
    return {
      status: 0,
      stdout: JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewRequests: {
                nodes: state.pending.map((login) => ({
                  requestedReviewer: { login },
                })),
              },
            },
          },
        },
      }),
      stderr: "",
    };
  };
  const sleep = (ms) => {
    sleeps.push(ms);
    slept += ms;
    timeline.shift(); // time advances: next poll sees the next state
    return Promise.resolve();
  };
  const now = () => slept;
  return { spawn, sleep, now, sleeps };
}

const args = { pr: 1, expected: 2, timeoutMinutes: 25 };

test("posted immediately when the count is already reached", async () => {
  const deps = fakeDeps([{ reviews: [COPILOT, COPILOT], pending: [] }]);
  assert.equal(await waitForRound(args, deps), "posted");
  assert.deepEqual(deps.sleeps, []);
});

test("request cleared: recounts once after a grace sleep — posted", async () => {
  const deps = fakeDeps([
    { reviews: [COPILOT], pending: [] },
    { reviews: [COPILOT, COPILOT], pending: [] },
  ]);
  assert.equal(await waitForRound(args, deps), "posted");
  assert.deepEqual(deps.sleeps, [POLL_INTERVAL_MS]);
});

test("request cleared and no review arrives — ended-without-review", async () => {
  const deps = fakeDeps([
    { reviews: [COPILOT], pending: [] },
    { reviews: [COPILOT], pending: [] },
  ]);
  assert.equal(await waitForRound(args, deps), "ended-without-review");
});

test("still pending: polls until the review lands — posted", async () => {
  const deps = fakeDeps([
    { reviews: [COPILOT], pending: ["Copilot"] },
    { reviews: [COPILOT], pending: ["Copilot"] },
    { reviews: [COPILOT, COPILOT], pending: [] },
  ]);
  assert.equal(await waitForRound(args, deps), "posted");
  assert.deepEqual(deps.sleeps, [POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
});

test("deadline passes while the request is still pending — timed-out", async () => {
  const deps = fakeDeps([{ reviews: [COPILOT], pending: ["Copilot"] }]);
  assert.equal(
    await waitForRound({ ...args, timeoutMinutes: 0 }, deps),
    "timed-out",
  );
});

test("a gh failure throws instead of reading as a zero count", async () => {
  const spawn = () => ({ status: 1, stdout: "", stderr: "rate limited" });
  await assert.rejects(
    waitForRound(args, { spawn, sleep: () => {}, now: () => 0 }),
    /rate limited/,
  );
});

test("parseWaitArgs validates and defaults the timeout", () => {
  assert.deepEqual(parseWaitArgs(["--pr", "5", "--expected", "2"]), {
    pr: 5,
    expected: 2,
    timeoutMinutes: 25,
  });
  assert.equal(
    parseWaitArgs(["--pr", "5", "--expected", "1", "--timeout-minutes", "3"])
      .timeoutMinutes,
    3,
  );
  assert.throws(() => parseWaitArgs(["--pr", "5"]), /--expected/);
});

test("main prints the ROUND contract line", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const deps = fakeDeps([
    { reviews: [COPILOT], pending: [] },
    { reviews: [COPILOT], pending: [] },
  ]);
  await main(["--pr", "1", "--expected", "1"], deps);
  assert.equal(log.mock.calls[0].arguments[0], "ROUND=posted");
});
