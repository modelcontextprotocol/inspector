// Tests for scripts/pr-review-request.mjs (#2558) — argv validation and
// `main()` through an injected spawn, so no `gh` process is started. Run via
// `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COPILOT_BOT_ID,
  main,
  parseRequestArgs,
} from "./pr-review-request.mjs";

/** A spawn that answers each `gh` call from a queue of JSON payloads. */
function spawnQueue(payloads) {
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push(args);
    const payload = payloads.shift();
    assert.ok(
      payload !== undefined,
      `unexpected extra gh call: ${args.join(" ")}`,
    );
    return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
  };
  spawn.calls = calls;
  return spawn;
}

test("parseRequestArgs requires a positive --pr", () => {
  assert.deepEqual(parseRequestArgs(["--pr", "2556"]), { pr: 2556 });
  assert.throws(() => parseRequestArgs([]), /--pr/);
  assert.throws(() => parseRequestArgs(["--pr", "zero"]), /--pr/);
});

test("main resolves the PR id, requests the Copilot bot, and confirms", (t) => {
  const spawn = spawnQueue([
    { data: { repository: { pullRequest: { id: "PR_abc" } } } },
    { data: { requestReviews: { pullRequest: { id: "PR_abc" } } } },
  ]);
  const log = t.mock.method(console, "log", () => {});
  main(["--pr", "9"], spawn);

  // The mutation call carries the bot id and the resolved PR id.
  const mutation = spawn.calls[1];
  assert.ok(mutation.includes(`bot=${COPILOT_BOT_ID}`));
  assert.ok(mutation.includes("pr=PR_abc"));
  assert.match(mutation.join(" "), /requestReviews/);
  assert.match(
    log.mock.calls[0].arguments[0],
    /requested: Copilot review on PR #9/,
  );
});

test("main throws when the PR does not exist", () => {
  const spawn = spawnQueue([{ data: { repository: { pullRequest: null } } }]);
  assert.throws(() => main(["--pr", "9"], spawn), /not found/);
});

test("main throws when the mutation returns no pullRequest", (t) => {
  t.mock.method(console, "log", () => {});
  const spawn = spawnQueue([
    { data: { repository: { pullRequest: { id: "PR_abc" } } } },
    { data: { requestReviews: { pullRequest: null } } },
  ]);
  assert.throws(() => main(["--pr", "9"], spawn), /no pullRequest/);
});
