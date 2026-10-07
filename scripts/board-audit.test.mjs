// Tests for scripts/board-audit.mjs (#2558) — the own() repository filter
// (null keeps drafts — load-bearing), each invariant over a crafted fixture,
// and main()'s output/exit contract. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { auditChecks, main, own } from "./board-audit.mjs";

const SLUG = "modelcontextprotocol/inspector";

test("own keeps this repo's issues AND drafts (repository null)", () => {
  const ours = { content: { type: "Issue", number: 1, repository: SLUG } };
  const draft = { content: { type: "DraftIssue", title: "[GHSA-…]" } };
  const foreign = { content: { type: "Issue", number: 9, repository: "o/r" } };
  assert.deepEqual(own([ours, draft, foreign]), [ours, draft]);
});

const issue = (number, over = {}) => ({
  number,
  state: "OPEN",
  stateReason: null,
  labels: [{ name: "v2" }, { name: "bug" }],
  milestone: { title: "2.5.0" },
  ...over,
});
const card = (number, status, priority = "Medium") => ({
  id: `PVTI_${number}`,
  status,
  priority,
  content: { type: "Issue", number, repository: SLUG },
});

function checksByName(issues, v2, v1) {
  return new Map(
    auditChecks(issues, v2, v1).map(({ check, offenders }) => [
      check.split(" (")[0],
      offenders,
    ]),
  );
}

test("a clean board produces no offenders anywhere", () => {
  const issues = [
    issue(1),
    issue(2, { labels: [{ name: "v1" }, { name: "chore" }], milestone: null }),
  ];
  const checks = checksByName(
    issues,
    [card(1, "Todo")],
    [{ ...card(2, "Todo"), priority: undefined }],
  );
  for (const [name, offenders] of checks) {
    assert.deepEqual(offenders, [], `check "${name}" should be clean`);
  }
});

test("each invariant catches its own defect", () => {
  const ghsaDraft = {
    id: "PVTI_draft",
    status: null,
    priority: null,
    content: { type: "DraftIssue", title: "[GHSA-2345-cfgh-jmpq] - x" },
  };
  const plainDraft = {
    id: "PVTI_plain",
    status: "Todo",
    priority: "Low",
    content: { type: "DraftIssue", title: "remember to tidy up" },
  };
  const issues = [
    issue(1), // double-boarded below
    issue(2, { milestone: { title: "2.5.0" } }), // Incoming but milestoned
    issue(3, { milestone: null }), // past Incoming, no milestone
    issue(4, { labels: [{ name: "v1" }, { name: "bug" }] }), // v1 on #28
    issue(5, { labels: [{ name: "v2" }, { name: "bug" }] }), // v2 on #11
    issue(6, { labels: [{ name: "bug" }] }), // no version label
    issue(7, { labels: [{ name: "v2" }] }), // no type label
    issue(8, { priorityless: true }), // open, no Priority (via card below)
    issue(9, { state: "CLOSED", stateReason: "NOT_PLANNED" }), // closed unshipped
    issue(10), // open but Done
  ];
  const v2 = [
    card(1, "Todo"),
    card(2, "Incoming"),
    card(3, "In Progress"),
    card(4, "Todo"),
    card(6, "Todo"),
    card(7, "Todo"),
    { ...card(8, "Todo"), priority: null },
    card(9, "Todo"),
    card(10, "Done"),
    ghsaDraft,
    plainDraft,
  ];
  const v1 = [card(1, "Todo"), card(5, "Todo")];

  const checks = checksByName(issues, v2, v1);
  assert.deepEqual(checks.get("double-boarded"), ["#1"]);
  assert.deepEqual(checks.get("non-issue card"), ["remember to tidy up"]);
  assert.deepEqual(checks.get("GHSA draft missing Status or Priority"), [
    "[GHSA-2345-cfgh-jmpq] - x",
  ]);
  assert.deepEqual(checks.get("Incoming but milestoned"), ["#2"]);
  assert.deepEqual(checks.get("past Incoming but no milestone"), ["#3"]);
  assert.deepEqual(checks.get("v1-labeled issue on #28"), ["#4"]);
  // #1 (double-boarded, v2-labeled) legitimately also trips the #11 check.
  assert.deepEqual(checks.get("v2-labeled issue on #11"), ["#1", "#5"]);
  assert.deepEqual(checks.get("open issue without exactly one version label"), [
    "#6",
  ]);
  assert.deepEqual(checks.get("open issue without exactly one type label"), [
    "#7",
  ]);
  assert.deepEqual(checks.get("open #28 card with no Priority"), ["#8"]);
  assert.deepEqual(checks.get("closed-unshipped issue still carded"), ["#9"]);
  assert.deepEqual(checks.get("open issue carded Done"), ["#10"]);
});

test("a GHSA draft with no Status is not double-counted as 'no Status'", () => {
  const ghsaDraft = {
    id: "PVTI_draft",
    status: null,
    priority: null,
    content: { type: "DraftIssue", title: "[GHSA-2345-cfgh-jmpq] - x" },
  };
  const checks = checksByName([], [ghsaDraft], []);
  assert.deepEqual(checks.get("card with no Status"), []);
  assert.equal(checks.get("GHSA draft missing Status or Priority").length, 1);
});

/** A spawn answering the issue dump and both board dumps. */
function spawnScript({ issues, v2 = [], v1 = [] }) {
  return (cmd, args) => {
    const joined = args.join(" ");
    let payload;
    if (joined.includes("issue list")) {
      payload = issues;
    } else if (joined.includes("item-list")) {
      const items = args[2] === "28" ? v2 : v1;
      payload = { items, totalCount: items.length };
    } else {
      assert.fail(`unexpected gh call: ${joined}`);
    }
    return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
  };
}

test("main prints one line per check and exits non-zero when dirty", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const before = process.exitCode;
  main([], spawnScript({ issues: [issue(1)], v2: [], v1: [] }));
  // 13 checks, one line each; #1 is open+milestoned but unboarded is NOT an
  // audit concern (that is the sweep's), so the only hits are none → clean?
  // No: issue 1 is not carded anywhere, so every per-card check is clean and
  // the per-issue label checks pass — the audit is clean and exits 0.
  assert.equal(lines.length, 13);
  assert.equal(process.exitCode, before);

  lines.length = 0;
  main([], spawnScript({ issues: [issue(1)], v2: [card(1, "Done")], v1: [] }));
  assert.ok(lines.some((line) => line.startsWith("1\topen issue carded Done")));
  assert.equal(process.exitCode, 1);
  process.exitCode = before;
});
