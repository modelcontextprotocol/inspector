// Tests for scripts/board-draft-find.mjs (#2558) — GHSA id validation, the
// bracketed-prefix title match, and the complete-listing dependency. Run via
// `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { draftsFor, main, parseFindDraftArgs } from "./board-draft-find.mjs";

const GHSA = "GHSA-2345-cfgh-jmpq";

test("parseFindDraftArgs requires a full GHSA id", () => {
  assert.deepEqual(parseFindDraftArgs(["--ghsa", GHSA]), {
    ghsa: GHSA,
    board: 28,
  });
  assert.throws(
    () => parseFindDraftArgs(["--ghsa", "GHSA-123"]),
    /full GHSA id/,
  );
  assert.throws(() => parseFindDraftArgs([]), /full GHSA id/);
});

const ITEMS = [
  { id: "PVTI_issue", content: { type: "Issue", number: 7 } },
  {
    id: "PVTI_draft",
    content: { type: "DraftIssue", title: `[${GHSA}] - proxy SSRF` },
  },
  {
    id: "PVTI_other",
    content: { type: "DraftIssue", title: "[GHSA-aaaa-bbbb-cccc] - other" },
  },
];

test("draftsFor matches the bracketed id prefix on drafts only", () => {
  assert.deepEqual(
    draftsFor(ITEMS, GHSA).map((item) => item.id),
    ["PVTI_draft"],
  );
  assert.deepEqual(draftsFor(ITEMS, "GHSA-9999-9999-9999"), []);
});

const spawnScript = (items) => () => ({
  status: 0,
  stdout: JSON.stringify({ items, totalCount: items.length }),
  stderr: "",
});

test("main prints ITEM=<id> <title> for each match", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  main(["--ghsa", GHSA], spawnScript(ITEMS));
  assert.deepEqual(lines, [`ITEM=PVTI_draft [${GHSA}] - proxy SSRF`]);
});

test("main throws when no draft card matches", () => {
  assert.throws(
    () => main(["--ghsa", GHSA], spawnScript([ITEMS[0]])),
    new RegExp(`no draft card titled \\[${GHSA}\\]`),
  );
});

test("main refuses a truncated listing rather than reporting absence", () => {
  const spawn = () => ({
    status: 0,
    stdout: JSON.stringify({ items: ITEMS, totalCount: 500 }),
    stderr: "",
  });
  assert.throws(() => main(["--ghsa", GHSA], spawn), /INCOMPLETE/);
});
