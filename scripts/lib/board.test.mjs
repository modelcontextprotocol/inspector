// Tests for scripts/lib/board.mjs (#2558) — the shared board plumbing: id
// resolution by name, the issue-side card lookup, and the complete-listing
// guard (#2451's silent-truncation class). Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardFields,
  cardQuery,
  editItemField,
  findCard,
  itemListComplete,
  projectId,
} from "./board.mjs";

const ok = (payload) => ({
  status: 0,
  stdout: JSON.stringify(payload),
  stderr: "",
});

test("projectId resolves by board number and throws on a missing id", () => {
  assert.equal(
    projectId((cmd, args) => {
      assert.equal(cmd, "gh");
      assert.ok(args.includes("view") && args.includes("11"));
      return ok({ id: "PVT_v1" });
    }, 11),
    "PVT_v1",
  );
  assert.throws(() => projectId(() => ok({}), 28), /could not resolve/);
});

test("boardFields returns the fields list, defaulting to empty", () => {
  assert.deepEqual(
    boardFields(() => ok({ fields: [{ name: "Status" }] }), 28),
    [{ name: "Status" }],
  );
  assert.deepEqual(
    boardFields(() => ok({}), 28),
    [],
  );
});

test("cardQuery parameterizes the field read back", () => {
  assert.match(cardQuery("Priority"), /fieldValueByName\(name:"Priority"\)/);
});

test("findCard selects the card by project node id", () => {
  const spawn = () =>
    ok({
      data: {
        repository: {
          issue: {
            projectItems: {
              nodes: [
                { id: "PVTI_a", project: { id: "PVT_other" } },
                {
                  id: "PVTI_b",
                  project: { id: "PVT_ours" },
                  fieldValueByName: { name: "Todo" },
                },
              ],
            },
          },
        },
      },
    });
  assert.equal(findCard(spawn, 7, "PVT_ours").id, "PVTI_b");
  assert.equal(findCard(spawn, 7, "PVT_absent"), undefined);
});

test("itemListComplete returns a complete dump and throws on truncation", () => {
  const items = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(
    itemListComplete(() => ok({ items, totalCount: 2 }), 28).items,
    items,
  );
  // Truncated: more items exist than the dump holds.
  assert.throws(
    () => itemListComplete(() => ok({ items, totalCount: 500 }), 28),
    /INCOMPLETE.*2 of 500/,
  );
  // Malformed: a failed call's output has neither key.
  assert.throws(() => itemListComplete(() => ok({}), 28), /INCOMPLETE/);
});

test("editItemField throws on a non-zero exit with the stderr", () => {
  assert.throws(
    () =>
      editItemField(
        () => ({ status: 1, stdout: "", stderr: "nope" }),
        "PVT_x",
        "PVTI_x",
        "F_x",
        "opt_x",
      ),
    /item-edit failed: nope/,
  );
  editItemField(() => ok({}), "PVT_x", "PVTI_x", "F_x", "opt_x");
});
