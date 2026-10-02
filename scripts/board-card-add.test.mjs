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
 * verify lookups returning `after` per queried field. `issueLookup:"pr"`
 * makes every graphql lookup fail the way a PR number does.
 */
function spawnScript({
  fields = FIELDS,
  after = { Status: "Todo", Priority: "Medium" },
  preexisting = false,
  issueLookup = "issue",
  priorityEditFails = false,
  rollbackFails = false,
} = {}) {
  const calls = [];
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
      return { status: 0, stdout: "{}", stderr: "" };
    } else if (joined.includes("item-delete")) {
      if (rollbackFails) {
        return { status: 1, stdout: "", stderr: "delete boom" };
      }
      added = false;
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
                          fieldValueByName: after[field]
                            ? { name: after[field] }
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

test("an issue that already has a card is refused, before item-add", () => {
  const spawn = spawnScript({ preexisting: true });
  assert.throws(
    () =>
      main(["--issue", "7", "--status", "Todo", "--priority", "Medium"], spawn),
    /already has a card on board #28/,
  );
  assert.equal(
    spawn.calls.some((args) => args.includes("item-add")),
    false,
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

test("a failure after item-add rolls the new card back", () => {
  // A partially configured card cannot be finished by a retry (the pre-add
  // duplicate check stops it), so failing must leave the board as found.
  const spawn = spawnScript({ priorityEditFails: true });
  assert.throws(
    () =>
      main(["--issue", "7", "--status", "Todo", "--priority", "Medium"], spawn),
    /priority edit boom.*rolled back/s,
  );
  const del = spawn.calls.find((args) => args.includes("item-delete"));
  assert.ok(del.includes("PVTI_new"));
});

test("a failed rollback names the partial card and how to remove it", () => {
  const spawn = spawnScript({ priorityEditFails: true, rollbackFails: true });
  assert.throws(
    () =>
      main(["--issue", "7", "--status", "Todo", "--priority", "Medium"], spawn),
    /rolling the new card back ALSO failed.*PVTI_new.*board:delete/s,
  );
});
