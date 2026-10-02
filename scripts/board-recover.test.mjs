// Tests for scripts/board-recover.mjs (#2558) — the diff phase's
// complete-dump refusal and snapshot grouping (the safety check that the
// orphaned set is exactly the cards that held the deleted option), and the
// reapply phase's paced re-application. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

test("lostGrouping keeps only cards that lost a snapshot value", () => {
  const snapshot = [
    { id: "a", status: "Done" },
    { id: "b", status: "Done" },
    { id: "c", status: null }, // blank before the deletion — not lost
    { id: "d", status: "Todo" }, // untouched
  ];
  const broken = [
    { id: "a", status: null },
    { id: "b", status: null },
    { id: "c", status: null },
    { id: "d", status: "Todo" },
    { id: "e", status: null }, // added after the snapshot — not lost
  ];
  assert.deepEqual(lostGrouping(snapshot, broken, "Status"), [
    { value: "Done", count: 2, ids: ["a", "b"] },
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
  // Same protections as the snapshot: private ids, owner-only, exclusive.
  assert.equal(statSync(lostPath).mode & 0o777, 0o600);
  assert.deepEqual(lines, [
    "was Done: 1",
    `lost: 1 cards (all "Done") → ${lostPath}`,
  ]);
});

test("diff refuses to write lost-ids.json when lost cards held mixed values", async (t) => {
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
  const errors = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  t.mock.method(console, "error", (line) => errors.push(line));
  const previousExitCode = process.exitCode;
  try {
    await main(
      ["--phase", "diff", "--snapshot", snapshotPath],
      dumpSpawn([
        { id: "a", status: null },
        { id: "b", status: null },
      ]),
    );
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
  assert.ok(!existsSync(join(dir, "lost-ids.json")));
  assert.deepEqual(lines, ["was Done: 1", "was Todo: 1"]);
  assert.match(errors.join("\n"), /2 different values/);
});

test("diff reports nothing to recover when no card lost a value", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const snapshotPath = join(dir, "board-28-snapshot.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({ items: [{ id: "a", status: "Done" }] }),
  );
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  await main(
    ["--phase", "diff", "--snapshot", snapshotPath],
    dumpSpawn([{ id: "a", status: "Done" }]),
  );
  assert.ok(!existsSync(join(dir, "lost-ids.json")));
  assert.deepEqual(lines, ["lost: 0 cards — nothing to recover"]);
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

test("diff removes a stale lost-ids.json before doing anything", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const snapshotPath = join(dir, "board-28-snapshot.json");
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, JSON.stringify(["stale"]));

  // A failing diff (unreadable snapshot) must not preserve the stale file…
  await assert.rejects(
    main(["--phase", "diff", "--snapshot", snapshotPath], () =>
      assert.fail("nothing should be spawned"),
    ),
  );
  assert.ok(!existsSync(lostPath));

  // …and neither does a diff that finds nothing to recover.
  writeFileSync(lostPath, JSON.stringify(["stale"]));
  writeFileSync(
    snapshotPath,
    JSON.stringify({ items: [{ id: "a", status: "Done" }] }),
  );
  t.mock.method(console, "log", () => {});
  await main(
    ["--phase", "diff", "--snapshot", snapshotPath],
    dumpSpawn([{ id: "a", status: "Done" }]),
  );
  assert.ok(!existsSync(lostPath));
});

test("diff refuses a snapshot path inside the repo", async () => {
  // lost-ids.json is derived beside the snapshot — written in the worktree
  // it is private board data one `git add -A` from a PR.
  await assert.rejects(
    main(
      [
        "--phase",
        "diff",
        "--snapshot",
        join(process.cwd(), "board-28-snapshot.json"),
      ],
      () => assert.fail("nothing should be spawned"),
    ),
    /private/,
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
    if (joined.includes("item-list")) {
      // The pre-mutation re-read: both cards still exist and are still blank.
      return {
        status: 0,
        stdout: JSON.stringify({
          items: [
            { id: "a", status: null },
            { id: "b", status: null },
          ],
          totalCount: 2,
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

/** A reapply spawn whose re-read reports the given current items. */
const reapplySpawn = (items) => (cmd, args) => {
  const joined = args.join(" ");
  if (joined.includes("project view")) {
    return { status: 0, stdout: JSON.stringify({ id: "PVT_x" }), stderr: "" };
  }
  if (joined.includes("field-list")) {
    return {
      status: 0,
      stdout: JSON.stringify({ fields: [{ id: "F_status", name: "Status" }] }),
      stderr: "",
    };
  }
  if (joined.includes("item-list")) {
    return {
      status: 0,
      stdout: JSON.stringify({ items, totalCount: items.length }),
      stderr: "",
    };
  }
  assert.fail(`no edit may run on a stale lost list: ${joined}`);
};

test("reapply refuses a lost card that is no longer blank", async () => {
  // Someone legitimately set the card between diff and reapply — the stale
  // list must not overwrite that newer value.
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, JSON.stringify(["a", "b"]));
  await assert.rejects(
    main(
      ["--phase", "reapply", "--lost", lostPath, "--option-id", "x"],
      reapplySpawn([
        { id: "a", status: null },
        { id: "b", status: "In Progress" },
      ]),
    ),
    /no longer blank.*stale.*re-run --phase diff/s,
  );
});

test("reapply refuses a lost card that no longer exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, JSON.stringify(["a", "gone"]));
  await assert.rejects(
    main(
      ["--phase", "reapply", "--lost", lostPath, "--option-id", "x"],
      reapplySpawn([{ id: "a", status: null }]),
    ),
    /gone or no longer blank.*gone/s,
  );
});
