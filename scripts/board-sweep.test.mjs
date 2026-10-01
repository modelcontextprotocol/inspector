// Tests for scripts/board-sweep.mjs (#2558) — the union across BOTH boards
// (diffing against #28 alone double-boards a correctly-carded v1 issue), the
// Todo/Incoming destination split, and the truncation refusals. Run via
// `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boardedNumbers, main, unboarded } from "./board-sweep.mjs";

const SLUG = "modelcontextprotocol/inspector";

test("boardedNumbers keeps only this repo's real issues", () => {
  assert.deepEqual(
    boardedNumbers([
      { content: { type: "Issue", number: 1, repository: SLUG } },
      { content: { type: "Issue", number: 2, repository: "other/repo" } },
      { content: { type: "DraftIssue", title: "[GHSA-…]" } },
    ]),
    [1],
  );
});

test("unboarded splits destinations by milestone", () => {
  assert.deepEqual(
    unboarded(
      [
        { number: 1, milestone: { title: "2.5.0" } },
        { number: 2, milestone: null },
        { number: 3, milestone: null },
      ],
      [3],
    ),
    [
      { number: 1, destination: "Todo (has milestone 2.5.0)" },
      { number: 2, destination: "Incoming" },
    ],
  );
});

/** A spawn answering the issue list and both board dumps. */
function spawnScript({ open, boards }) {
  return (cmd, args) => {
    const joined = args.join(" ");
    let payload;
    if (joined.includes("issue list")) {
      payload = open;
    } else if (joined.includes("item-list")) {
      const board = args[2];
      const items = boards[board] ?? [];
      payload = { items, totalCount: items.length };
    } else {
      assert.fail(`unexpected gh call: ${joined}`);
    }
    return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
  };
}

const carded = (number) => ({
  content: { type: "Issue", number, repository: SLUG },
});

test("main unions both boards and reports only truly unboarded issues", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const before = process.exitCode;
  main(
    [],
    spawnScript({
      open: [
        { number: 1, milestone: null }, // carded on #28
        { number: 2, milestone: null }, // carded on #11 — NOT unboarded
        { number: 3, milestone: { title: "2.5.0" } }, // unboarded
      ],
      boards: { 28: [carded(1)], 11: [carded(2)] },
    }),
  );
  assert.deepEqual(lines, ["#3\t→ Todo (has milestone 2.5.0)", "unboarded: 1"]);
  assert.equal(process.exitCode, 1);
  process.exitCode = before;
});

test("main exits clean when every open issue is carded", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const before = process.exitCode;
  main(
    [],
    spawnScript({
      open: [{ number: 1, milestone: null }],
      boards: { 28: [carded(1)], 11: [] },
    }),
  );
  assert.deepEqual(lines, ["unboarded: 0"]);
  assert.equal(process.exitCode, before);
});

test("main refuses an issue listing at its own limit", () => {
  const open = Array.from({ length: 2000 }, (_, i) => ({
    number: i + 1,
    milestone: null,
  }));
  assert.throws(
    () => main([], spawnScript({ open, boards: {} })),
    /hit --limit 2000/,
  );
});
