#!/usr/bin/env node
// Add an issue's card to a board and set its fields (#2558) — `npm run
// board:add -- --issue <N> --status Todo [--priority Medium] [--board 28]`.
// The add-card recipe board-ops previously transcribed inline (and
// issue-create step 4 points at).
//
// Same properties as `board-card-status.mjs`: every id resolved by name at
// run time, and the Status VERIFIED by reading it back — `card: …` prints
// only on a confirmed match. Priority is set only when given; board #11 has
// no Priority field, and asking for one there fails loudly by name
// resolution rather than with an opaque id error.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { OWNER, REPO, ghJson, requirePositiveInt } from "./lib/gh.mjs";
import {
  DEFAULT_BOARD,
  boardFields,
  editItemField,
  fieldOption,
  findCard,
  projectId as resolveProjectId,
} from "./lib/board.mjs";

export function parseAddArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      issue: { type: "string" },
      status: { type: "string" },
      priority: { type: "string" },
      board: { type: "string" },
    },
  });
  if (!values.status) {
    throw new Error("--status is required (e.g. --status Todo)");
  }
  return {
    issue: requirePositiveInt(values.issue, "--issue"),
    status: values.status,
    priority: values.priority,
    board:
      values.board === undefined
        ? DEFAULT_BOARD
        : requirePositiveInt(values.board, "--board"),
  };
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { issue, status, priority, board } = parseAddArgs(argv);

  const project = resolveProjectId(spawn, board);
  const fields = boardFields(spawn, board);
  // Resolve EVERY option before the first write, so a bad name cannot leave
  // a half-configured card behind.
  const statusIds = fieldOption(fields, "Status", status);
  const priorityIds =
    priority === undefined
      ? undefined
      : fieldOption(fields, "Priority", priority);

  const itemId = ghJson(spawn, [
    "project",
    "item-add",
    String(board),
    "--owner",
    OWNER,
    "--url",
    `https://github.com/${OWNER}/${REPO}/issues/${issue}`,
    "--format",
    "json",
  ]).id;
  if (!itemId) {
    throw new Error(`item-add returned no id for #${issue}`);
  }

  editItemField(spawn, project, itemId, statusIds.fieldId, statusIds.optionId);
  if (priorityIds) {
    editItemField(
      spawn,
      project,
      itemId,
      priorityIds.fieldId,
      priorityIds.optionId,
    );
  }

  // Verify by reading each set field back — never report an unconfirmed add.
  const after = findCard(spawn, issue, project);
  const now = after?.fieldValueByName?.name ?? "(none)";
  if (now !== status) {
    throw new Error(`card reads "${now}" after the add, not "${status}"`);
  }
  if (priority !== undefined) {
    const priorityNow =
      findCard(spawn, issue, project, "Priority")?.fieldValueByName?.name ??
      "(none)";
    if (priorityNow !== priority) {
      throw new Error(
        `card Priority reads "${priorityNow}" after the add, not "${priority}"`,
      );
    }
  }
  console.log(
    `card: ${now}${priority === undefined ? "" : ` / ${priority}`} (board #${board})`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
