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
// recovery's to touch. The lost set is written to lost-ids.json BESIDE the
// snapshot only when every lost card held the SAME snapshot value, since
// reapply assigns one option id to all of them; a mixed grouping is printed
// and refused. The file records the board, field and held value alongside the
// ids, so `reapply` can verify that --option-id is actually the recreated
// option for that value — any other valid option id on the field is refused
// rather than silently rewriting every lost card to the wrong value. Reapply
// also re-reads each card's field immediately before editing it (a whole-board
// preflight cannot hold across a paced loop) and aborts on any card that is
// gone or no longer blank, paced to stay under the API's abuse limits.

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { requirePositiveInt } from "./lib/gh.mjs";
import {
  assertOutsideRepo,
  boardFields,
  editItemField,
  itemFieldValue,
  itemListComplete,
  projectId as resolveProjectId,
  requireSupportedBoard,
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
      field: { type: "string" },
      board: { type: "string" },
    },
  });
  const board =
    values.board === undefined
      ? undefined
      : requireSupportedBoard(requirePositiveInt(values.board, "--board"));
  if (values.phase === "diff") {
    if (!values.snapshot) {
      throw new Error("--phase diff needs --snapshot <path>");
    }
    // board stays undefined when not given: diff takes it from the snapshot
    // (board:snapshot records it), and an explicit flag may only CONFIRM what
    // the snapshot records — a mismatch is refused in main.
    return {
      phase: "diff",
      snapshot: values.snapshot,
      field: values.field ?? "Status",
      board,
    };
  }
  if (values.phase === "reapply") {
    if (!values.lost || !values["option-id"]) {
      throw new Error(
        "--phase reapply needs --lost <path> and --option-id <id>",
      );
    }
    // board and field stay undefined when not given: reapply takes both from
    // the lost file (written by diff), and an explicit flag may only CONFIRM
    // what the file records — a mismatch is refused in main.
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
    // lost-ids.json is derived BESIDE the snapshot, so a --snapshot inside
    // the worktree would write private board item ids one `git add -A` from
    // a PR — the same refusal board:snapshot applies to its --dir.
    const lostDir = dirname(parsed.snapshot);
    assertOutsideRepo(lostDir, process.cwd());
    // A previous diff's lost-ids.json must not survive this run: a diff that
    // fails or ends with nothing recoverable would otherwise leave stale ids
    // for reapply to consume. Remove it before anything can fail.
    const lostPath = join(lostDir, "lost-ids.json");
    rmSync(lostPath, { force: true });
    const snapshot = JSON.parse(readFileSync(parsed.snapshot, "utf8"));
    // A truncated snapshot cannot be diffed against: the cards it omits
    // would be excluded from the lost set and reapply would then report
    // success while leaving them orphaned. The snapshot carries its own
    // totalCount (board:snapshot writes the verified dump whole), so refuse
    // one whose items fall short of it — or one missing either key.
    if (
      !Array.isArray(snapshot.items) ||
      typeof snapshot.totalCount !== "number" ||
      snapshot.items.length !== snapshot.totalCount
    ) {
      throw new Error(
        `${parsed.snapshot} is not a complete board snapshot ` +
          `(${snapshot.items?.length ?? "?"} items of totalCount ` +
          `${snapshot.totalCount ?? "?"}) — retake it with board:snapshot`,
      );
    }
    // The snapshot proves which board it belongs to (board:snapshot records
    // it): diffing a board-11 snapshot against board 28's dump would match
    // nothing and confidently print "lost: 0 cards". An explicit --board may
    // only confirm it; a snapshot predating the recorded key (hand-taken
    // with gh directly) cannot prove its board, so there the flag is
    // REQUIRED rather than defaulted — the silent wrong-board diff is the
    // exact failure this check exists for.
    let board;
    if (snapshot.board !== undefined) {
      if (!Number.isInteger(snapshot.board)) {
        throw new Error(
          `${parsed.snapshot} records a non-numeric board (${snapshot.board})`,
        );
      }
      requireSupportedBoard(snapshot.board, `${parsed.snapshot}'s board`);
      if (parsed.board !== undefined && parsed.board !== snapshot.board) {
        throw new Error(
          `--board ${parsed.board} does not match the snapshot's board #${snapshot.board}`,
        );
      }
      board = snapshot.board;
    } else {
      if (parsed.board === undefined) {
        throw new Error(
          `${parsed.snapshot} records no board — pass --board naming the board it was taken from`,
        );
      }
      board = parsed.board;
    }
    // The field must exist on the board — a typo (--field Priorty) would
    // otherwise read every card's value as undefined, match nothing, and
    // falsely report no lost cards.
    if (
      !boardFields(spawn, board).some(
        (candidate) => candidate.name === parsed.field,
      )
    ) {
      throw new Error(`board #${board} has no "${parsed.field}" field`);
    }
    // itemListComplete refuses a truncated dump, so lost-ids.json is written
    // only from a complete picture of the broken board.
    const broken = itemListComplete(spawn, board);
    const groups = lostGrouping(snapshot.items, broken.items, parsed.field);
    for (const { value, count } of groups) {
      console.log(`was ${value}: ${count}`);
    }
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
    // The artifact records what the lost cards HELD, not just their ids, so
    // reapply can refuse an --option-id that is valid on the field but is not
    // the recreated option for this value.
    const payload = {
      board,
      field: parsed.field,
      value: groups[0].value,
      ids: lostIds,
    };
    // Same protections as the snapshot itself: the ids are private board
    // data, so owner-only, and exclusive so a file planted between the
    // removal above and this write is refused rather than followed.
    writeFileSync(lostPath, JSON.stringify(payload, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    console.log(
      `lost: ${lostIds.length} cards (all "${groups[0].value}") → ${lostPath}`,
    );
    return;
  }

  const recorded = JSON.parse(readFileSync(parsed.lost, "utf8"));
  if (
    recorded === null ||
    typeof recorded !== "object" ||
    Array.isArray(recorded) ||
    !Number.isInteger(recorded.board) ||
    typeof recorded.field !== "string" ||
    typeof recorded.value !== "string" ||
    !Array.isArray(recorded.ids) ||
    recorded.ids.length === 0 ||
    recorded.ids.some((id) => typeof id !== "string")
  ) {
    throw new Error(
      `${parsed.lost} is not a lost file written by --phase diff ` +
        `({ board, field, value, ids })`,
    );
  }
  // The file is authoritative for board and field; an explicit flag may only
  // confirm it. A silent override would let reapply run against a different
  // board or field than the one diff actually measured.
  if (parsed.board !== undefined && parsed.board !== recorded.board) {
    throw new Error(
      `--board ${parsed.board} does not match the lost file's board #${recorded.board}`,
    );
  }
  if (parsed.field !== undefined && parsed.field !== recorded.field) {
    throw new Error(
      `--field ${parsed.field} does not match the lost file's field "${recorded.field}"`,
    );
  }
  const lostIds = recorded.ids;
  const project = resolveProjectId(spawn, recorded.board);
  const field = boardFields(spawn, recorded.board).find(
    (candidate) => candidate.name === recorded.field,
  );
  if (!field) {
    throw new Error(
      `board #${recorded.board} has no "${recorded.field}" field`,
    );
  }
  // --option-id must be the RECREATED option for the value the lost cards
  // held — any other valid option id on the field would succeed and silently
  // rewrite every lost card to the wrong value.
  const option = (field.options ?? []).find(
    (candidate) => candidate.id === parsed.optionId,
  );
  if (!option) {
    const known = (field.options ?? [])
      .map((o) => `"${o.name}" (${o.id})`)
      .join(", ");
    throw new Error(
      `"${recorded.field}" has no option with id ${parsed.optionId} (has: ${known})`,
    );
  }
  if (option.name !== recorded.value) {
    throw new Error(
      `--option-id ${parsed.optionId} is "${option.name}" but the lost cards ` +
        `held "${recorded.value}" — pass the recreated "${recorded.value}" option's id`,
    );
  }
  // Fail fast, before the FIRST edit, when the list is already stale — someone
  // may have legitimately set one of these cards while the option was being
  // recreated, or deleted one. This makes a stale-at-start run all-or-nothing;
  // the per-card read in the loop below is what holds at mutation time.
  const current = itemListComplete(spawn, recorded.board);
  const byId = new Map(current.items.map((item) => [item.id, item]));
  const key = fieldKey(recorded.field);
  const stale = lostIds.filter(
    (id) => !byId.has(id) || byId.get(id)[key] != null,
  );
  if (stale.length > 0) {
    throw new Error(
      `${stale.length} of ${lostIds.length} lost cards are gone or no longer ` +
        `blank (${stale.slice(0, 5).join(", ")}${stale.length > 5 ? ", …" : ""}) ` +
        `— the lost list is stale; re-run --phase diff and retry`,
    );
  }
  let applied = 0;
  for (const id of lostIds) {
    // Re-read THIS card immediately before its edit: with hundreds of cards
    // and 400 ms pacing, the preflight above goes stale mid-loop, and a card
    // someone set during the run must not be overwritten.
    const now = itemFieldValue(spawn, id, recorded.field);
    if (!now.exists || now.value !== null) {
      throw new Error(
        `card ${id} is ${now.exists ? `no longer blank ("${now.value}")` : "gone"} — ` +
          `the lost list went stale mid-run (${applied} of ${lostIds.length} ` +
          `reapplied); re-run --phase diff and retry with the remainder`,
      );
    }
    editItemField(spawn, project, id, field.id, parsed.optionId);
    applied += 1;
    await sleep(EDIT_PACING_MS);
  }
  console.log(`reapplied: ${lostIds.length} cards → option ${parsed.optionId}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
