// Tests for scripts/board-card-add.mjs (#2558) — argv validation, resolving
// every option BEFORE the first write, and the add-then-verify orchestration
// for Status and the optional Priority. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { main, parseAddArgs } from "./board-card-add.mjs";

test("parseAddArgs validates and defaults", () => {
  assert.deepEqual(
    parseAddArgs(["--issue", "7", "--status", "Todo", "--priority", "High"]),
    {
      issue: 7,
      status: "Todo",
      priority: "High",
      board: 28,
    },
  );
  // Board #11 has no Priority field, so only there may --priority be absent.
  assert.equal(
    parseAddArgs(["--issue", "7", "--status", "Todo", "--board", "11"])
      .priority,
    undefined,
  );
  assert.throws(() => parseAddArgs(["--issue", "7"]), /--status/);
  // Every v2 board item has a Priority — an add without one is refused.
  assert.throws(
    () => parseAddArgs(["--issue", "7", "--status", "Todo"]),
    /--priority is required on board #28/,
  );
});

const FIELDS = [
  {
    id: "F_status",
    name: "Status",
    options: [{ id: "opt_todo", name: "Todo" }],
  },
  {
    id: "F_priority",
    name: "Priority",
    options: [{ id: "opt_med", name: "Medium" }],
  },
];

/**
 * A spawn for main()'s flow: view, field-list, the pre-add issue lookup
 * (empty until item-add unless `preexisting`), item-add, item-edits, then
 * verify lookups. A graphql read of a field returns `before[field]` until an
 * item-edit touches that field, and `after[field]` from then on — which is
 * how a test shows a preexisting partial card being finished in place.
 * `issueLookup:"pr"` makes every graphql lookup fail the way a PR number
 * does.
 */
function spawnScript({
  fields = FIELDS,
  after = { Status: "Todo", Priority: "Medium" },
  before,
  preexisting = false,
  issueLookup = "issue",
  priorityEditFails = false,
} = {}) {
  const calls = [];
  const edited = new Set();
  let added = false;
  const spawn = (cmd, args) => {
    calls.push(args);
    const joined = args.join(" ");
    let payload;
    if (joined.includes("project view")) {
      payload = { id: "PVT_x" };
    } else if (joined.includes("field-list")) {
      payload = { fields };
    } else if (joined.includes("item-add")) {
      added = true;
      payload = { id: "PVTI_new" };
    } else if (joined.includes("item-edit")) {
      if (priorityEditFails && joined.includes("opt_med")) {
        return { status: 1, stdout: "", stderr: "priority edit boom" };
      }
      if (joined.includes("F_status")) edited.add("Status");
      if (joined.includes("F_priority")) edited.add("Priority");
      return { status: 0, stdout: "{}", stderr: "" };
    } else if (joined.includes("graphql")) {
      if (issueLookup === "pr") {
        return {
          status: 1,
          stdout: "",
          stderr: "Could not resolve to an Issue with the number of 7.",
        };
      }
      const field = /fieldValueByName\(name:"(\w+)"\)/.exec(joined)[1];
      const values = before && !edited.has(field) ? before : after;
      payload = {
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes:
                  added || preexisting
                    ? [
                        {
                          id: "PVTI_new",
                          project: { id: "PVT_x" },
                          fieldValueByName: values[field]
                            ? { name: values[field] }
                            : null,
                        },
                      ]
                    : [],
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

test("main adds, sets both fields, verifies, and prints the card line", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript();
  main(["--issue", "7", "--status", "Todo", "--priority", "Medium"], spawn);
  assert.deepEqual(lines, ["card: Todo / Medium (board #28)"]);
  const edits = spawn.calls.filter((args) => args.includes("item-edit"));
  assert.equal(edits.length, 2);
  assert.ok(edits[0].includes("opt_todo"));
  assert.ok(edits[1].includes("opt_med"));
});

test("main sets only Status on board #11, which has no Priority", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript({ after: { Status: "Todo" } });
  main(["--issue", "7", "--status", "Todo", "--board", "11"], spawn);
  assert.deepEqual(lines, ["card: Todo (board #11)"]);
  assert.equal(
    spawn.calls.filter((args) => args.includes("item-edit")).length,
    1,
  );
});

test("a PR number fails the pre-add issue lookup, before item-add", () => {
  // Issue and PR numbers share one namespace and item-add accepts a PR URL —
  // the issue(number:) lookup must refuse it before the first write.
  const spawn = spawnScript({ issueLookup: "pr" });
  assert.throws(
    () =>
      main(["--issue", "7", "--status", "Todo", "--priority", "Medium"], spawn),
    /Could not resolve to an Issue/,
  );
  assert.equal(
    spawn.calls.some((args) => args.includes("item-add")),
    false,
  );
});

test("a card holding a contradicting value is refused, before any write", () => {
  // The real duplicate-add mistake: the issue is already moving through the
  // board. Overwriting its Status would destroy board state someone set.
  const spawn = spawnScript({
    preexisting: true,
    before: { Status: "In Progress", Priority: "Medium" },
  });
  assert.throws(
    () =>
      main(["--issue", "7", "--status", "Todo", "--priority", "Medium"], spawn),
    /already has a card on board #28 reading Status "In Progress"/,
  );
  assert.equal(
    spawn.calls.some(
      (args) => args.includes("item-add") || args.includes("item-edit"),
    ),
    false,
  );
});

test("a matching preexisting card is reconfigured idempotently, no item-add", (t) => {
  // item-add is idempotent upstream, so the command is too: a re-run after
  // success (or a concurrent add that won the race) confirms and reports.
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript({ preexisting: true });
  main(["--issue", "7", "--status", "Todo", "--priority", "Medium"], spawn);
  assert.deepEqual(lines, ["card: Todo / Medium (board #28)"]);
  assert.equal(
    spawn.calls.some((args) => args.includes("item-add")),
    false,
  );
});

test("a partially configured card is finished in place by a re-run", (t) => {
  // The recovery path rollback used to foreclose: a failed Priority edit
  // left Status set and Priority unset; the re-run completes it.
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript({
    preexisting: true,
    before: { Status: "Todo" },
  });
  main(["--issue", "7", "--status", "Todo", "--priority", "Medium"], spawn);
  assert.deepEqual(lines, ["card: Todo / Medium (board #28)"]);
  assert.equal(
    spawn.calls.some((args) => args.includes("item-add")),
    false,
  );
  assert.equal(
    spawn.calls.filter((args) => args.includes("item-edit")).length,
    2,
  );
});

test("a bad option name fails BEFORE item-add, leaving nothing half-made", () => {
  const spawn = spawnScript({ fields: [FIELDS[0]] });
  assert.throws(
    () =>
      main(["--issue", "7", "--status", "Todo", "--priority", "High"], spawn),
    /no "Priority"/,
  );
  assert.equal(
    spawn.calls.some((args) => args.includes("item-add")),
    false,
  );
});

test("main refuses to report an unconfirmed add", () => {
  const spawn = spawnScript({ after: { Status: "Incoming" } });
  assert.throws(
    () =>
      main(["--issue", "7", "--status", "Todo", "--priority", "Medium"], spawn),
    /reads "Incoming"/,
  );
});

test("a failure after item-add leaves the card and names the re-run", () => {
  // NEVER a rollback delete: item-add is idempotent, so this invocation
  // cannot prove it created the card — deleting could destroy a concurrent
  // operation's card. The error says how to finish instead.
  const spawn = spawnScript({ priorityEditFails: true });
  assert.throws(
    () =>
      main(["--issue", "7", "--status", "Todo", "--priority", "Medium"], spawn),
    /priority edit boom.*PVTI_new.*may be partially configured.*re-run/s,
  );
  assert.equal(
    spawn.calls.some((args) => args.includes("item-delete")),
    false,
  );
});
