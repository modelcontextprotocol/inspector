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
import {
  OWNER,
  REPO,
  gh,
  ghGraphql,
  ghJson,
  requirePositiveInt,
} from "./lib/gh.mjs";

export const DEFAULT_BOARD = 28;

/** Resolve a single-select field's id and one option's id, both by name. */
export function fieldOption(fields, fieldName, optionName) {
  const field = fields.find((candidate) => candidate.name === fieldName);
  if (!field) {
    throw new Error(`board has no "${fieldName}" field`);
  }
  const option = (field.options ?? []).find(
    (candidate) => candidate.name === optionName,
  );
  if (!option) {
    const known = (field.options ?? []).map((o) => o.name).join(", ");
    throw new Error(
      `"${fieldName}" has no option "${optionName}" (has: ${known})`,
    );
  }
  return { fieldId: field.id, optionId: option.id };
}

/** The issue's card on the given project, from a `projectItems` response. */
export function cardOnProject(response, projectId) {
  const nodes = response?.data?.repository?.issue?.projectItems?.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error(
      `unexpected projectItems response shape: ${JSON.stringify(response)}`,
    );
  }
  return nodes.find((node) => node?.project?.id === projectId);
}

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
    board:
      values.board === undefined
        ? DEFAULT_BOARD
        : requirePositiveInt(values.board, "--board"),
  };
}

const CARD_QUERY = `query($n:Int!){repository(owner:"${OWNER}",name:"${REPO}"){issue(number:$n){projectItems(first:100){nodes{id project{id} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}`;

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { issue, status, board } = parseStatusArgs(argv);
  const boardArg = String(board);

  const projectId = ghJson(spawn, [
    "project",
    "view",
    boardArg,
    "--owner",
    OWNER,
    "--format",
    "json",
  ]).id;
  if (!projectId) {
    throw new Error(`could not resolve project id for board #${board}`);
  }

  const { fieldId, optionId } = fieldOption(
    ghJson(spawn, [
      "project",
      "field-list",
      boardArg,
      "--owner",
      OWNER,
      "--format",
      "json",
    ]).fields ?? [],
    "Status",
    status,
  );

  const card = cardOnProject(
    ghGraphql(spawn, CARD_QUERY, { n: issue }),
    projectId,
  );
  if (!card?.id) {
    throw new Error(
      `#${issue} has no card on board #${board} — board it first (/issue-create step 4)`,
    );
  }

  const edit = gh(spawn, [
    "project",
    "item-edit",
    "--project-id",
    projectId,
    "--id",
    card.id,
    "--field-id",
    fieldId,
    "--single-select-option-id",
    optionId,
    "--format",
    "json",
  ]);
  if (edit.status !== 0) {
    throw new Error(`item-edit failed: ${(edit.stderr ?? "").trim()}`);
  }

  // Verify by reading the Status back — never report an unconfirmed move.
  const after = cardOnProject(
    ghGraphql(spawn, CARD_QUERY, { n: issue }),
    projectId,
  );
  const now = after?.fieldValueByName?.name ?? "(none)";
  if (now !== status) {
    throw new Error(`card reads "${now}" after the edit, not "${status}"`);
  }
  console.log(`card: ${now}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
