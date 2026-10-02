// Tests for scripts/pr-review-fetch.mjs (#2558) — round resolution,
// formatting, and `main()` through an injected spawn. Run via
// `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatComment,
  latestCopilotReview,
  main,
  parseFetchArgs,
} from "./pr-review-fetch.mjs";

const COPILOT = "copilot-pull-request-reviewer[bot]";
const review = (id, login, submitted) => ({
  id,
  user: { login },
  submitted_at: submitted,
  body: `body of ${id}`,
});

test("latestCopilotReview picks the newest Copilot review by submitted_at", () => {
  const latest = latestCopilotReview([
    review(1, COPILOT, "2026-01-02T00:00:00Z"),
    review(2, "alice", "2026-01-05T00:00:00Z"),
    review(3, COPILOT, "2026-01-03T00:00:00Z"),
  ]);
  assert.equal(latest.id, 3);
  assert.equal(
    latestCopilotReview([review(2, "alice", "2026-01-05")]),
    undefined,
  );
});

test("latestCopilotReview matches the bot login exactly, not by prefix", () => {
  // A public-PR user whose login merely starts with the bot's name must not
  // be read as "the Copilot round".
  const latest = latestCopilotReview([
    review(1, COPILOT, "2026-01-01T00:00:00Z"),
    review(2, "copilot-pull-request-reviewer", "2026-01-02T00:00:00Z"),
    review(3, "copilot-pull-request-reviewer-fake", "2026-01-03T00:00:00Z"),
  ]);
  assert.equal(latest.id, 1);
});

test("formatComment names the thread id and falls back to original_line", () => {
  assert.equal(
    formatComment({ id: 7, path: "a.ts", line: 12, body: "b" }),
    "COMMENT=7 a.ts:12\nb",
  );
  assert.match(
    formatComment({ id: 7, path: "a.ts", original_line: 4, body: "b" }),
    /a\.ts:4/,
  );
  assert.match(formatComment({ id: 7, path: "a.ts", body: "b" }), /a\.ts:\?/);
});

test("parseFetchArgs validates --pr and optional --review", () => {
  assert.deepEqual(parseFetchArgs(["--pr", "3"]), { pr: 3, review: undefined });
  assert.equal(parseFetchArgs(["--pr", "3", "--review", "9"]).review, 9);
  assert.throws(() => parseFetchArgs([]), /--pr/);
});

function spawnFor({ reviews, comments }) {
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push(args);
    const path = args.at(-1);
    const payload = path.endsWith("/reviews") ? reviews : comments;
    assert.ok(payload, `unexpected gh call: ${args.join(" ")}`);
    return { status: 0, stdout: JSON.stringify([payload]), stderr: "" };
  };
  spawn.calls = calls;
  return spawn;
}

test("main resolves the latest round and prints header + every comment", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnFor({
    reviews: [review(5, COPILOT, "2026-01-01T00:00:00Z")],
    comments: [
      { id: 11, path: "x.ts", line: 2, body: "first" },
      { id: 12, path: "y.ts", line: 8, body: "second" },
    ],
  });
  main(["--pr", "4"], spawn);
  const out = lines.join("\n");
  assert.match(out, /REVIEW=5 SUBMITTED=2026-01-01T00:00:00Z/);
  assert.match(out, /body of 5/);
  assert.match(out, /2 inline comment/);
  assert.match(out, /COMMENT=11 x\.ts:2/);
  assert.match(out, /COMMENT=12 y\.ts:8/);
  // Comments were fetched by REVIEW id, not from the reviews listing.
  assert.ok(spawn.calls[1].at(-1).includes("/reviews/5/comments"));
});

test("main with --review prints the named review's full header and body", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnFor({
    reviews: [
      review(77, COPILOT, "2026-01-01T00:00:00Z"),
      review(99, COPILOT, "2026-01-02T00:00:00Z"),
    ],
    comments: [],
  });
  main(["--pr", "4", "--review", "77"], spawn);
  assert.ok(spawn.calls[1].at(-1).includes("/reviews/77/comments"));
  const out = lines.join("\n");
  assert.match(out, /REVIEW=77 SUBMITTED=2026-01-01T00:00:00Z/);
  assert.match(out, /body of 77/);
});

test("main with --review throws when the review does not exist", () => {
  const spawn = spawnFor({
    reviews: [review(99, COPILOT, "2026-01-02T00:00:00Z")],
  });
  assert.throws(
    () => main(["--pr", "4", "--review", "77"], spawn),
    /no review 77/,
  );
});

test("main throws when the PR has no Copilot review", () => {
  const spawn = spawnFor({ reviews: [review(2, "alice", "2026-01-01")] });
  assert.throws(() => main(["--pr", "4"], spawn), /no Copilot review/);
});
