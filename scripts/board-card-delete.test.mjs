// Tests for scripts/board-card-delete.mjs (#2558) — argv validation, the
// delete-then-verify orchestration, and the optional API close with the
// machine-readable reason `gh issue close` cannot set. Run via
// `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { main, parseDeleteArgs } from "./board-card-delete.mjs";

test("parseDeleteArgs validates the reason vocabulary", () => {
  assert.deepEqual(parseDeleteArgs(["--issue", "7"]), {
    issue: 7,
    board: 28,
    reason: undefined,
  });
  assert.equal(
    parseDeleteArgs(["--issue", "7", "--reason", "duplicate"]).reason,
    "duplicate",
  );
  assert.throws(
    () => parseDeleteArgs(["--issue", "7", "--reason", "wontfix"]),
    /duplicate, not-planned/,
  );
});

/** A spawn whose card lookup returns a card until the delete, then none. */
function spawnScript({ card = true, stillThere = false } = {}) {
  const calls = [];
  let deleted = false;
  const spawn = (cmd, args) => {
    calls.push(args);
    const joined = args.join(" ");
    let payload;
    if (joined.includes("project view")) {
      payload = { id: "PVT_x" };
    } else if (joined.includes("graphql")) {
      const present = card && (!deleted || stillThere);
      payload = {
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: present
                  ? [{ id: "PVTI_x", project: { id: "PVT_x" } }]
                  : [],
              },
            },
          },
        },
      };
    } else if (joined.includes("item-delete")) {
      deleted = true;
      return { status: 0, stdout: "{}", stderr: "" };
    } else if (joined.includes("PATCH")) {
      return { status: 0, stdout: "{}", stderr: "" };
    } else {
      assert.fail(`unexpected gh call: ${joined}`);
    }
    return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
  };
  spawn.calls = calls;
  return spawn;
}

test("main deletes, verifies the card is gone, and prints", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript();
  main(["--issue", "7"], spawn);
  assert.deepEqual(lines, ["deleted: card for #7 on board #28"]);
  assert.equal(
    spawn.calls.some((args) => args.includes("PATCH")),
    false,
  );
});

test("main closes with the API reason when --reason is given", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript();
  main(["--issue", "7", "--reason", "duplicate"], spawn);
  assert.deepEqual(lines, [
    "deleted: card for #7 on board #28",
    "closed: #7 (duplicate)",
  ]);
  const patch = spawn.calls.find((args) => args.includes("PATCH"));
  assert.ok(patch.includes("state_reason=duplicate"));
});

test("main throws when there is no card to delete", () => {
  assert.throws(
    () => main(["--issue", "7"], spawnScript({ card: false })),
    /no card on board #28/,
  );
});

test("main refuses to report an unconfirmed delete", () => {
  assert.throws(
    () => main(["--issue", "7"], spawnScript({ stillThere: true })),
    /still has a card/,
  );
});
