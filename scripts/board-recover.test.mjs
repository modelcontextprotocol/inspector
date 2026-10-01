// Tests for scripts/board-recover.mjs (#2558) — the diff phase's
// complete-dump refusal and snapshot grouping (the safety check that the
// orphaned set is exactly the cards that held the deleted option), and the
// reapply phase's paced re-application. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lostGrouping, main, parseRecoverArgs } from "./board-recover.mjs";

test("parseRecoverArgs demands each phase's own inputs", () => {
  assert.equal(
    parseRecoverArgs(["--phase", "diff", "--snapshot", "/tmp/s.json"]).phase,
    "diff",
  );
  assert.throws(() => parseRecoverArgs(["--phase", "diff"]), /--snapshot/);
  assert.throws(
    () => parseRecoverArgs(["--phase", "reapply", "--lost", "x"]),
    /--option-id/,
  );
  assert.throws(
    () => parseRecoverArgs(["--phase", "undo"]),
    /"diff" or "reapply"/,
  );
});

test("lostGrouping groups what the lost cards held in the snapshot", () => {
  const snapshot = [
    { id: "a", status: "Done" },
    { id: "b", status: "Done" },
    { id: "c", status: null },
    { id: "d", status: "Todo" }, // not lost — untouched
  ];
  assert.deepEqual(lostGrouping(snapshot, ["a", "b", "c"], "Status"), [
    { value: "Done", count: 2 },
    { value: "(none)", count: 1 },
  ]);
});

const dumpSpawn =
  (items, totalCount = items.length) =>
  () => ({
    status: 0,
    stdout: JSON.stringify({ items, totalCount }),
    stderr: "",
  });

test("diff writes lost-ids.json beside the snapshot and prints the grouping", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const snapshotPath = join(dir, "board-28-snapshot.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      items: [
        { id: "a", status: "Done" },
        { id: "b", status: "Todo" },
      ],
    }),
  );
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  await main(
    ["--phase", "diff", "--snapshot", snapshotPath],
    dumpSpawn([
      { id: "a", status: null }, // orphaned
      { id: "b", status: "Todo" },
    ]),
  );
  const lostPath = join(dir, "lost-ids.json");
  assert.deepEqual(JSON.parse(readFileSync(lostPath, "utf8")), ["a"]);
  assert.deepEqual(lines, ["was Done: 1", `lost: 1 cards → ${lostPath}`]);
});

test("diff refuses a truncated broken-board dump", async () => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const snapshotPath = join(dir, "s.json");
  writeFileSync(snapshotPath, JSON.stringify({ items: [] }));
  await assert.rejects(
    main(
      ["--phase", "diff", "--snapshot", snapshotPath],
      dumpSpawn([{ id: "a", status: null }], 500),
    ),
    /INCOMPLETE/,
  );
});

test("reapply edits each lost card with pacing and reports the count", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, JSON.stringify(["a", "b"]));

  const edits = [];
  const spawn = (cmd, args) => {
    const joined = args.join(" ");
    if (joined.includes("project view")) {
      return { status: 0, stdout: JSON.stringify({ id: "PVT_x" }), stderr: "" };
    }
    if (joined.includes("field-list")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          fields: [{ id: "F_status", name: "Status" }],
        }),
        stderr: "",
      };
    }
    if (joined.includes("item-edit")) {
      edits.push(args);
      return { status: 0, stdout: "{}", stderr: "" };
    }
    assert.fail(`unexpected gh call: ${joined}`);
  };
  const sleeps = [];
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  await main(
    ["--phase", "reapply", "--lost", lostPath, "--option-id", "opt_new"],
    spawn,
    async (ms) => sleeps.push(ms),
  );
  assert.equal(edits.length, 2);
  assert.ok(edits.every((args) => args.includes("opt_new")));
  assert.deepEqual(sleeps, [400, 400]);
  assert.deepEqual(lines, ["reapplied: 2 cards → option opt_new"]);
});

test("reapply refuses a lost file that is not a list of ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, JSON.stringify({ not: "a list" }));
  await assert.rejects(
    main(["--phase", "reapply", "--lost", lostPath, "--option-id", "x"], () => {
      assert.fail("nothing should be spawned");
    }),
    /not a list of item ids/,
  );
});
