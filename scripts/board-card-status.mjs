#!/usr/bin/env node
// Move an issue's board card to a Status (#2558) — `npm run board:status --
// --issue <N> --status "In Review" [--board 28]`. The card-move block the
// pr-flow skill (steps 1 and 6) and board-ops previously transcribed inline —
// the most fragile of the four, because a half-pasted block silently no-ops.
//
// Three properties carried over from the inline block, all load-bearing:
//
//  - Every id is resolved BY NAME at run time. Single-select option ids are
//    regenerated whenever a field's option list is edited (board-ops' hazard),
//    so no option id is hardcoded here and a recreated option still resolves.
//  - The card is found FROM THE ISSUE (`projectItems`), selected by the
//    board's node id — never from `gh project item-list`, whose `--limit`
//    truncates silently past the board's size.
//  - The move is VERIFIED by reading the Status back; `card: <Status>` on
//    stdout is printed only on a confirmed match, so "the step is done only
//    when it prints `card: …`" is enforced by the exit code too.
//
// `--board 11` works unchanged for a v1 issue — same column names, every id
// resolved by name against that board.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { requirePositiveInt } from "./lib/gh.mjs";
import {
  DEFAULT_BOARD,
  boardFields,
  cardOnProject,
  editItemField,
  fieldOption,
  findCard,
  projectId as resolveProjectId,
  requireSupportedBoard,
} from "./lib/board.mjs";

export { DEFAULT_BOARD, cardOnProject, fieldOption };

export function parseStatusArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      issue: { type: "string" },
      status: { type: "string" },
      board: { type: "string" },
    },
  });
  if (!values.status) {
    throw new Error("--status is required (e.g. --status 'In Review')");
  }
  return {
    issue: requirePositiveInt(values.issue, "--issue"),
    status: values.status,
    board: requireSupportedBoard(
      values.board === undefined
        ? DEFAULT_BOARD
        : requirePositiveInt(values.board, "--board"),
    ),
  };
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { issue, status, board } = parseStatusArgs(argv);

  const project = resolveProjectId(spawn, board);
  const { fieldId, optionId } = fieldOption(
    boardFields(spawn, board),
    "Status",
    status,
  );

  const card = findCard(spawn, issue, project);
  if (!card?.id) {
    throw new Error(
      `#${issue} has no card on board #${board} — board it first (/issue-create step 4)`,
    );
  }

  editItemField(spawn, project, card.id, fieldId, optionId);

  // Verify by reading the Status back — never report an unconfirmed move.
  const after = findCard(spawn, issue, project);
  const now = after?.fieldValueByName?.name ?? "(none)";
  if (now !== status) {
    throw new Error(`card reads "${now}" after the edit, not "${status}"`);
  }
  console.log(`card: ${now}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
