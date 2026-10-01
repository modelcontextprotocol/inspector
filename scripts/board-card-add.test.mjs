// Tests for scripts/board-card-add.mjs (#2558) — argv validation, resolving
// every option BEFORE the first write, and the add-then-verify orchestration
// for Status and the optional Priority. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { main, parseAddArgs } from "./board-card-add.mjs";

test("parseAddArgs validates and defaults", () => {
  assert.deepEqual(parseAddArgs(["--issue", "7", "--status", "Todo"]), {
    issue: 7,
    status: "Todo",
    priority: undefined,
    board: 28,
  });
  assert.equal(
    parseAddArgs(["--issue", "7", "--status", "Todo", "--priority", "High"])
      .priority,
    "High",
  );
  assert.throws(() => parseAddArgs(["--issue", "7"]), /--status/);
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
 * A spawn for main()'s flow: view, field-list, item-add, item-edits, then
 * verify lookups returning `after` per queried field.
 */
function spawnScript({
  fields = FIELDS,
  after = { Status: "Todo", Priority: "Medium" },
} = {}) {
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push(args);
    const joined = args.join(" ");
    let payload;
    if (joined.includes("project view")) {
      payload = { id: "PVT_x" };
    } else if (joined.includes("field-list")) {
      payload = { fields };
    } else if (joined.includes("item-add")) {
      payload = { id: "PVTI_new" };
    } else if (joined.includes("item-edit")) {
      return { status: 0, stdout: "{}", stderr: "" };
    } else if (joined.includes("graphql")) {
      const field = /fieldValueByName\(name:"(\w+)"\)/.exec(joined)[1];
      payload = {
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [
                  {
                    id: "PVTI_new",
                    project: { id: "PVT_x" },
                    fieldValueByName: after[field]
                      ? { name: after[field] }
                      : null,
                  },
                ],
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

test("main sets only Status when no --priority is given", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript();
  main(["--issue", "7", "--status", "Todo"], spawn);
  assert.deepEqual(lines, ["card: Todo (board #28)"]);
  assert.equal(
    spawn.calls.filter((args) => args.includes("item-edit")).length,
    1,
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
    () => main(["--issue", "7", "--status", "Todo"], spawn),
    /reads "Incoming"/,
  );
});
