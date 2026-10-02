// Tests for scripts/board-card-status.mjs (#2558) — name-based id resolution,
// issue-side card lookup, and `main()`'s edit-then-verify orchestration
// through an injected spawn. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardOnProject,
  fieldOption,
  main,
  parseStatusArgs,
} from "./board-card-status.mjs";

const FIELDS = [
  {
    id: "F_status",
    name: "Status",
    options: [
      { id: "opt_todo", name: "Todo" },
      { id: "opt_rev", name: "In Review" },
    ],
  },
];

test("fieldOption resolves field and option ids by name", () => {
  assert.deepEqual(fieldOption(FIELDS, "Status", "In Review"), {
    fieldId: "F_status",
    optionId: "opt_rev",
  });
  assert.throws(() => fieldOption(FIELDS, "Priority", "High"), /no "Priority"/);
  // The error names the options that DO exist, so a renamed column is obvious.
  assert.throws(
    () => fieldOption(FIELDS, "Status", "Review"),
    /Todo, In Review/,
  );
});

const cardResponse = (statusName, projectId = "PVT_x") => ({
  data: {
    repository: {
      issue: {
        projectItems: {
          nodes: [
            { id: "PVTI_other", project: { id: "PVT_other" } },
            {
              id: "PVTI_ours",
              project: { id: projectId },
              fieldValueByName: statusName ? { name: statusName } : null,
            },
          ],
        },
      },
    },
  },
});

test("cardOnProject selects by project node id and throws on a bad shape", () => {
  assert.equal(cardOnProject(cardResponse("Todo"), "PVT_x").id, "PVTI_ours");
  assert.equal(cardOnProject(cardResponse("Todo"), "PVT_absent"), undefined);
  assert.throws(() => cardOnProject({ data: {} }, "PVT_x"), /unexpected/);
});

test("parseStatusArgs validates and defaults the board to 28", () => {
  assert.deepEqual(parseStatusArgs(["--issue", "7", "--status", "Todo"]), {
    issue: 7,
    status: "Todo",
    board: 28,
  });
  assert.equal(
    parseStatusArgs(["--issue", "7", "--status", "Todo", "--board", "11"])
      .board,
    11,
  );
  assert.throws(() => parseStatusArgs(["--issue", "7"]), /--status/);
});

/**
 * A spawn answering main()'s five calls in order: project view, field-list,
 * card lookup, item-edit, verify lookup. `after` is the Status the verify
 * read returns.
 */
function spawnScript({
  after = "In Review",
  card = true,
  editStatus = 0,
} = {}) {
  const calls = [];
  let lookups = 0;
  const spawn = (cmd, args) => {
    calls.push(args);
    const joined = args.join(" ");
    let payload;
    if (joined.includes("project view")) {
      payload = { id: "PVT_x" };
    } else if (joined.includes("field-list")) {
      payload = { fields: FIELDS };
    } else if (joined.includes("graphql")) {
      lookups += 1;
      payload = card
        ? cardResponse(lookups === 1 ? "Todo" : after)
        : { data: { repository: { issue: { projectItems: { nodes: [] } } } } };
    } else if (joined.includes("item-edit")) {
      return { status: editStatus, stdout: "{}", stderr: "edit refused" };
    } else {
      assert.fail(`unexpected gh call: ${joined}`);
    }
    return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
  };
  spawn.calls = calls;
  return spawn;
}

test("main edits the card and prints card: <Status> only after verifying", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript();
  main(["--issue", "7", "--status", "In Review"], spawn);
  assert.deepEqual(lines, ["card: In Review"]);

  const edit = spawn.calls.find((args) => args.includes("item-edit"));
  assert.ok(edit.includes("PVTI_ours"));
  assert.ok(edit.includes("F_status"));
  assert.ok(edit.includes("opt_rev"));
});

test("main throws when the issue has no card on the board", () => {
  const spawn = spawnScript({ card: false });
  assert.throws(
    () => main(["--issue", "7", "--status", "In Review"], spawn),
    /no card on board #28/,
  );
});

test("main throws when item-edit fails", () => {
  const spawn = spawnScript({ editStatus: 1 });
  assert.throws(
    () => main(["--issue", "7", "--status", "In Review"], spawn),
    /edit refused/,
  );
});

test("main refuses to report an unconfirmed move", () => {
  const spawn = spawnScript({ after: "Todo" });
  assert.throws(
    () => main(["--issue", "7", "--status", "In Review"], spawn),
    /reads "Todo"/,
  );
});
