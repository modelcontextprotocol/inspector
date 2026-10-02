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
  (cmd, args) => {
    if (args.join(" ").includes("field-list")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          fields: [{ id: "F_status", name: "Status" }],
        }),
        stderr: "",
      };
    }
    return {
      status: 0,
      stdout: JSON.stringify({ items, totalCount }),
      stderr: "",
    };
  };

/** A snapshot file as board:snapshot writes it — board recorded, complete. */
const snapshotFile = (items, board = 28) =>
  JSON.stringify({ board, items, totalCount: items.length });

test("diff writes lost-ids.json beside the snapshot and prints the grouping", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const snapshotPath = join(dir, "board-28-snapshot.json");
  writeFileSync(
    snapshotPath,
    snapshotFile([
      { id: "a", status: "Done" },
      { id: "b", status: "Todo" },
    ]),
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
  assert.deepEqual(JSON.parse(readFileSync(lostPath, "utf8")), {
    board: 28,
    field: "Status",
    value: "Done",
    ids: ["a"],
  });
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
    snapshotFile([
      { id: "a", status: "Done" },
      { id: "b", status: "Todo" },
    ]),
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
  writeFileSync(snapshotPath, snapshotFile([{ id: "a", status: "Done" }]));
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
  writeFileSync(snapshotPath, snapshotFile([]));
  await assert.rejects(
    main(
      ["--phase", "diff", "--snapshot", snapshotPath],
      dumpSpawn([{ id: "a", status: null }], 500),
    ),
    /INCOMPLETE/,
  );
});

test("diff refuses a truncated snapshot by its own totalCount", async () => {
  // A snapshot whose items fall short of its totalCount omits cards whose
  // lost values can never be recovered from it — reapply would then report
  // success while leaving them orphaned. The same shape check refuses a
  // file with no items array or no totalCount at all.
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const snapshotPath = join(dir, "s.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({ items: [{ id: "a", status: "Done" }], totalCount: 500 }),
  );
  await assert.rejects(
    main(["--phase", "diff", "--snapshot", snapshotPath], () =>
      assert.fail("nothing should be spawned"),
    ),
    /not a complete board snapshot \(1 items of totalCount 500\)/,
  );
  writeFileSync(snapshotPath, JSON.stringify({ items: [] }));
  await assert.rejects(
    main(["--phase", "diff", "--snapshot", snapshotPath], () =>
      assert.fail("nothing should be spawned"),
    ),
    /not a complete board snapshot/,
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
  writeFileSync(snapshotPath, snapshotFile([{ id: "a", status: "Done" }]));
  t.mock.method(console, "log", () => {});
  await main(
    ["--phase", "diff", "--snapshot", snapshotPath],
    dumpSpawn([{ id: "a", status: "Done" }]),
  );
  assert.ok(!existsSync(lostPath));
});

test("diff refuses an explicit --board that contradicts the snapshot", async () => {
  // A board-11 snapshot diffed against board 28's dump would match nothing
  // and confidently print "lost: 0 cards".
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const snapshotPath = join(dir, "s.json");
  writeFileSync(snapshotPath, snapshotFile([{ id: "a", status: "Done" }], 11));
  await assert.rejects(
    main(["--phase", "diff", "--snapshot", snapshotPath, "--board", "28"], () =>
      assert.fail("nothing should be spawned"),
    ),
    /--board 28 does not match the snapshot's board #11/,
  );
});

test("diff takes its board from the snapshot and resolves fields on it", async (t) => {
  // No --board flag: the snapshot's recorded board (11) decides which board
  // is dumped and which board the lost file names.
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const snapshotPath = join(dir, "s.json");
  writeFileSync(snapshotPath, snapshotFile([{ id: "a", status: "Done" }], 11));
  const boardsAsked = [];
  const spawn = (cmd, args) => {
    const joined = args.join(" ");
    if (joined.includes("field-list") || joined.includes("item-list")) {
      boardsAsked.push(args[2]);
    }
    if (joined.includes("field-list")) {
      return {
        status: 0,
        stdout: JSON.stringify({ fields: [{ id: "F", name: "Status" }] }),
        stderr: "",
      };
    }
    return {
      status: 0,
      stdout: JSON.stringify({
        items: [{ id: "a", status: null }],
        totalCount: 1,
      }),
      stderr: "",
    };
  };
  t.mock.method(console, "log", () => {});
  await main(["--phase", "diff", "--snapshot", snapshotPath], spawn);
  assert.deepEqual(boardsAsked, ["11", "11"]);
  assert.equal(
    JSON.parse(readFileSync(join(dir, "lost-ids.json"), "utf8")).board,
    11,
  );
});

test("diff refuses a field the board does not have", async () => {
  // A typo (--field Priorty) would read every card's value as undefined,
  // match nothing, and falsely report no lost cards.
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const snapshotPath = join(dir, "s.json");
  writeFileSync(snapshotPath, snapshotFile([{ id: "a", status: "Done" }]));
  await assert.rejects(
    main(
      ["--phase", "diff", "--snapshot", snapshotPath, "--field", "Priorty"],
      dumpSpawn([{ id: "a", status: null }]),
    ),
    /board #28 has no "Priorty" field/,
  );
  assert.ok(!existsSync(join(dir, "lost-ids.json")));
});

test("diff falls back to the flag or default for a snapshot with no board key", async (t) => {
  // A hand-taken `gh project item-list` dump predates the recorded key.
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const snapshotPath = join(dir, "s.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({ items: [{ id: "a", status: "Done" }], totalCount: 1 }),
  );
  t.mock.method(console, "log", () => {});
  await main(
    ["--phase", "diff", "--snapshot", snapshotPath],
    dumpSpawn([{ id: "a", status: null }]),
  );
  assert.equal(
    JSON.parse(readFileSync(join(dir, "lost-ids.json"), "utf8")).board,
    28,
  );
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

/** A valid lost file as --phase diff writes it. */
const lostFile = (ids, value = "Done") =>
  JSON.stringify({ board: 28, field: "Status", value, ids });

/**
 * A reapply spawn: `items` is the current board (preflight dump AND the
 * per-card reads), `options` the Status field's option list. `onEdit`
 * collects item-edit args when provided; absent, an edit is a failure.
 */
const reapplySpawn =
  (items, { options = [{ id: "opt_new", name: "Done" }], onEdit } = {}) =>
  (cmd, args) => {
    const joined = args.join(" ");
    if (joined.includes("project view")) {
      return { status: 0, stdout: JSON.stringify({ id: "PVT_x" }), stderr: "" };
    }
    if (joined.includes("field-list")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          fields: [{ id: "F_status", name: "Status", options }],
        }),
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
    if (joined.includes("api graphql")) {
      // The per-card read immediately before an edit.
      const id = args.find((arg) => arg.startsWith("id=")).slice(3);
      const item = items.find((candidate) => candidate.id === id);
      const node =
        item === undefined
          ? null
          : {
              fieldValueByName:
                item.status == null ? null : { name: item.status },
            };
      return {
        status: 0,
        stdout: JSON.stringify({ data: { node } }),
        stderr: "",
      };
    }
    if (joined.includes("item-edit")) {
      assert.ok(onEdit, `no edit may run here: ${joined}`);
      onEdit(args);
      return { status: 0, stdout: "{}", stderr: "" };
    }
    assert.fail(`unexpected gh call: ${joined}`);
  };

test("reapply edits each lost card with pacing and reports the count", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, lostFile(["a", "b"]));

  const edits = [];
  const spawn = reapplySpawn(
    [
      { id: "a", status: null },
      { id: "b", status: null },
    ],
    { onEdit: (args) => edits.push(args) },
  );
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

test("reapply refuses a lost file that is not diff's own format", async () => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  // The pre-#2559 bare-array format records no field/value, so --option-id
  // could not be verified against what the cards held — refused outright.
  writeFileSync(lostPath, JSON.stringify(["a", "b"]));
  await assert.rejects(
    main(["--phase", "reapply", "--lost", lostPath, "--option-id", "x"], () => {
      assert.fail("nothing should be spawned");
    }),
    /not a lost file written by --phase diff/,
  );
});

test("reapply refuses an explicit flag that contradicts the lost file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, lostFile(["a"]));
  await assert.rejects(
    main(
      [
        "--phase",
        "reapply",
        "--lost",
        lostPath,
        "--option-id",
        "x",
        "--board",
        "11",
      ],
      () => assert.fail("nothing should be spawned"),
    ),
    /--board 11 does not match the lost file's board #28/,
  );
  await assert.rejects(
    main(
      [
        "--phase",
        "reapply",
        "--lost",
        lostPath,
        "--option-id",
        "x",
        "--field",
        "Priority",
      ],
      () => assert.fail("nothing should be spawned"),
    ),
    /--field Priority does not match the lost file's field "Status"/,
  );
});

test("reapply refuses an option id the field does not have", async () => {
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, lostFile(["a"]));
  await assert.rejects(
    main(
      ["--phase", "reapply", "--lost", lostPath, "--option-id", "bogus"],
      reapplySpawn([{ id: "a", status: null }]),
    ),
    /"Status" has no option with id bogus \(has: "Done" \(opt_new\)\)/,
  );
});

test("reapply refuses an option whose name is not the recorded value", async () => {
  // A valid option id from the SAME field that is not the recreated option
  // would silently rewrite every lost card to the wrong value.
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, lostFile(["a"]));
  await assert.rejects(
    main(
      ["--phase", "reapply", "--lost", lostPath, "--option-id", "opt_todo"],
      reapplySpawn([{ id: "a", status: null }], {
        options: [
          { id: "opt_new", name: "Done" },
          { id: "opt_todo", name: "Todo" },
        ],
      }),
    ),
    /is "Todo" but the lost cards held "Done"/,
  );
});

test("reapply refuses a lost card that is no longer blank", async () => {
  // Someone legitimately set the card between diff and reapply — the stale
  // list must not overwrite that newer value. Caught by the preflight,
  // before any edit.
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, lostFile(["a", "b"]));
  await assert.rejects(
    main(
      ["--phase", "reapply", "--lost", lostPath, "--option-id", "opt_new"],
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
  writeFileSync(lostPath, lostFile(["a", "gone"]));
  await assert.rejects(
    main(
      ["--phase", "reapply", "--lost", lostPath, "--option-id", "opt_new"],
      reapplySpawn([{ id: "a", status: null }]),
    ),
    /gone or no longer blank.*gone/s,
  );
});

test("reapply aborts mid-loop when a card is set during the run", async (t) => {
  // The preflight passes (both cards blank at the start), then card b is set
  // while card a's edit is pacing — the per-card read must catch it and no
  // edit may land on b.
  const dir = mkdtempSync(join(tmpdir(), "board-recover-test-"));
  const lostPath = join(dir, "lost-ids.json");
  writeFileSync(lostPath, lostFile(["a", "b"]));
  const items = [
    { id: "a", status: null },
    { id: "b", status: null },
  ];
  const edits = [];
  const spawn = reapplySpawn(items, {
    onEdit: (args) => {
      edits.push(args);
      // Simulate the concurrent maintainer: after a's edit, b gets a value.
      items[1].status = "Todo";
    },
  });
  t.mock.method(console, "log", () => {});
  await assert.rejects(
    main(
      ["--phase", "reapply", "--lost", lostPath, "--option-id", "opt_new"],
      spawn,
      async () => {},
    ),
    /card b is no longer blank \("Todo"\).*went stale mid-run \(1 of 2 reapplied\)/s,
  );
  assert.equal(edits.length, 1);
  assert.ok(edits[0].includes("a"));
});
