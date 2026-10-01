#!/usr/bin/env node
// Recover from a deleted single-select board option (#2558) — the two
// mechanical phases of board-ops' recovery recipe. Step 2 of that recipe —
// recreating the option while echoing every surviving option's id — is
// deliberately NOT scripted: it edits the field schema, the very operation
// the option-deletion hazard is about, and stays a human act in the web UI.
//
//   npm run board:recover -- --phase diff --snapshot <path> [--field Status]
//   npm run board:recover -- --phase reapply --lost <path> --option-id <id>
//
// `diff` dumps the broken board (complete or refused) and compares it against
// the snapshot: a card is LOST only when it is null now AND held a value in
// the snapshot — a card already blank in the snapshot, or added since, is not
// recovery's to touch. The lost ids are written to lost-ids.json BESIDE the
// snapshot only when every lost card held the SAME snapshot value, since
// reapply assigns one option id to all of them; a mixed grouping is printed
// and refused. `reapply` re-applies the NEW option id (the deleted one never
// comes back) to each lost card, paced to stay under the API's abuse limits.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { requirePositiveInt } from "./lib/gh.mjs";
import {
  DEFAULT_BOARD,
  boardFields,
  editItemField,
  itemListComplete,
  projectId as resolveProjectId,
} from "./lib/board.mjs";

const EDIT_PACING_MS = 400;

export function parseRecoverArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      phase: { type: "string" },
      snapshot: { type: "string" },
      lost: { type: "string" },
      "option-id": { type: "string" },
      field: { type: "string", default: "Status" },
      board: { type: "string" },
    },
  });
  const board =
    values.board === undefined
      ? DEFAULT_BOARD
      : requirePositiveInt(values.board, "--board");
  if (values.phase === "diff") {
    if (!values.snapshot) {
      throw new Error("--phase diff needs --snapshot <path>");
    }
    return {
      phase: "diff",
      snapshot: values.snapshot,
      field: values.field,
      board,
    };
  }
  if (values.phase === "reapply") {
    if (!values.lost || !values["option-id"]) {
      throw new Error(
        "--phase reapply needs --lost <path> and --option-id <id>",
      );
    }
    return {
      phase: "reapply",
      lost: values.lost,
      optionId: values["option-id"],
      field: values.field,
      board,
    };
  }
  throw new Error('--phase must be "diff" or "reapply"');
}

/** item-list exposes each single-select field under its lowercased name. */
const fieldKey = (field) => field.toLowerCase();

/**
 * Cards null in the broken dump that held a value in the snapshot, grouped by
 * that value: [{ value, count, ids }]. A card null in both dumps was blank
 * before the deletion, and a card absent from the snapshot was added after it
 * — neither is recovery's to overwrite, so both are excluded.
 */
export function lostGrouping(snapshotItems, brokenItems, field) {
  const key = fieldKey(field);
  const held = new Map();
  for (const item of snapshotItems) {
    if (item[key] != null) {
      held.set(item.id, item[key]);
    }
  }
  const groups = new Map();
  for (const item of brokenItems) {
    if (item[key] != null || !held.has(item.id)) {
      continue;
    }
    const value = held.get(item.id);
    const group = groups.get(value) ?? { value, count: 0, ids: [] };
    group.count += 1;
    group.ids.push(item.id);
    groups.set(value, group);
  }
  return [...groups.values()];
}

export async function main(
  argv = process.argv.slice(2),
  spawn = spawnSync,
  sleep = delay,
) {
  const parsed = parseRecoverArgs(argv);

  if (parsed.phase === "diff") {
    const snapshot = JSON.parse(readFileSync(parsed.snapshot, "utf8"));
    if (!Array.isArray(snapshot.items)) {
      throw new Error(`${parsed.snapshot} has no items array — not a snapshot`);
    }
    // itemListComplete refuses a truncated dump, so lost-ids.json is written
    // only from a complete picture of the broken board.
    const broken = itemListComplete(spawn, parsed.board);
    const groups = lostGrouping(snapshot.items, broken.items, parsed.field);
    for (const { value, count } of groups) {
      console.log(`was ${value}: ${count}`);
    }
    const lostPath = join(dirname(parsed.snapshot), "lost-ids.json");
    if (groups.length === 0) {
      console.log("lost: 0 cards — nothing to recover");
      return;
    }
    // Reapply assigns ONE option id to every lost card, so the lost set is
    // only actionable when it held a single value. A mixed grouping means
    // something besides the option deletion blanked cards — refuse it.
    if (groups.length > 1) {
      process.exitCode = 1;
      console.error(
        `lost cards held ${groups.length} different values — one option id ` +
          `cannot restore them all; not writing ${lostPath}`,
      );
      return;
    }
    const lostIds = groups[0].ids;
    writeFileSync(lostPath, JSON.stringify(lostIds, null, 2));
    console.log(
      `lost: ${lostIds.length} cards (all "${groups[0].value}") → ${lostPath}`,
    );
    return;
  }

  const lostIds = JSON.parse(readFileSync(parsed.lost, "utf8"));
  if (!Array.isArray(lostIds) || lostIds.some((id) => typeof id !== "string")) {
    throw new Error(`${parsed.lost} is not a list of item ids`);
  }
  const project = resolveProjectId(spawn, parsed.board);
  const field = boardFields(spawn, parsed.board).find(
    (candidate) => candidate.name === parsed.field,
  );
  if (!field) {
    throw new Error(`board #${parsed.board} has no "${parsed.field}" field`);
  }
  for (const id of lostIds) {
    editItemField(spawn, project, id, field.id, parsed.optionId);
    await sleep(EDIT_PACING_MS);
  }
  console.log(`reapplied: ${lostIds.length} cards → option ${parsed.optionId}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
