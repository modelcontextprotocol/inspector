// Tests for scripts/pr-link-issue.mjs (#2558) — argv validation and the
// link-then-verify orchestration: `linked:` prints only when the PR's
// closingIssuesReferences actually lists the issue. Run via
// `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { main, parseLinkArgs } from "./pr-link-issue.mjs";

test("parseLinkArgs requires both numbers", () => {
  assert.deepEqual(parseLinkArgs(["--pr", "2559", "--issue", "2558"]), {
    pr: 2559,
    issue: 2558,
  });
  assert.throws(() => parseLinkArgs(["--pr", "2559"]), /--issue/);
  assert.throws(() => parseLinkArgs(["--issue", "0", "--pr", "1"]), /--issue/);
});

/** A spawn answering: issue-id query, pr view, mutation, verify query. */
function spawnScript({ linked = [2558], issueId = "I_issue" } = {}) {
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push(args);
    const joined = args.join(" ");
    let payload;
    if (joined.includes("issue(number:$n){id}")) {
      payload = {
        data: { repository: { issue: issueId ? { id: issueId } : null } },
      };
    } else if (joined.includes("pr view")) {
      payload = { id: "PR_id" };
    } else if (joined.includes("addCloseIssueReferences")) {
      payload = {
        data: { addCloseIssueReferences: { clientMutationId: null } },
      };
    } else if (joined.includes("closingIssuesReferences")) {
      payload = {
        data: {
          repository: {
            pullRequest: {
              closingIssuesReferences: {
                nodes: linked.map((number) => ({ number })),
              },
            },
          },
        },
      };
    } else {
      assert.fail(`unexpected gh call: ${joined}`);
    }
    return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
  };
  spawn.calls = calls;
  return spawn;
}

test("main links and prints only after verifying the reference", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript();
  main(["--pr", "2559", "--issue", "2558"], spawn);
  assert.deepEqual(lines, ["linked: PR #2559 closes #2558"]);
  // The mutation got both node ids.
  const mutation = spawn.calls.find((args) =>
    args.some((arg) => arg.includes("addCloseIssueReferences")),
  );
  assert.ok(mutation.some((arg) => arg === "i=I_issue"));
  assert.ok(mutation.some((arg) => arg === "p=PR_id"));
});

test("main throws when the issue cannot be resolved", () => {
  assert.throws(
    () =>
      main(["--pr", "2559", "--issue", "9999"], spawnScript({ issueId: null })),
    /could not resolve issue #9999/,
  );
});

test("main refuses to report an unconfirmed link", () => {
  assert.throws(
    () =>
      main(["--pr", "2559", "--issue", "2558"], spawnScript({ linked: [17] })),
    /reads \[17\]/,
  );
});
