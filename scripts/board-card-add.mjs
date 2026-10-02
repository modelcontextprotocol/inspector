#!/usr/bin/env node
// Add an issue's card to a board and set its fields (#2558) — `npm run
// board:add -- --issue <N> --status Todo [--priority Medium] [--board 28]`.
// The add-card recipe board-ops previously transcribed inline (and
// issue-create step 4 points at).
//
// Same properties as `board-card-status.mjs`: every id resolved by name at
// run time, and the Status VERIFIED by reading it back — `card: …` prints
// only on a confirmed match. On board #28 `--priority` is REQUIRED — every
// v2 board item has a Priority (AGENTS.md), so an add without one would mint
// a card `board:audit` immediately flags. Board #11 has no Priority field,
// so there the flag is refused by name resolution instead.
//
// The issue is also resolved as an ISSUE before the first write: issue and
// PR numbers share one namespace, `/issues/<PR number>` redirects to the PR,
// and `item-add` accepts it — which would board a PR (forbidden) and fail
// only at the later verify, leaving the bad card behind.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { OWNER, REPO, gh, ghJson, requirePositiveInt } from "./lib/gh.mjs";
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
  const board =
    values.board === undefined
      ? DEFAULT_BOARD
      : requirePositiveInt(values.board, "--board");
  if (board === DEFAULT_BOARD && values.priority === undefined) {
    throw new Error(
      "--priority is required on board #28 — every v2 board item has a Priority (derive it with the issue-triage rubric); only board #11, which has no Priority field, omits it",
    );
  }
  return {
    issue: requirePositiveInt(values.issue, "--issue"),
    status: values.status,
    priority: values.priority,
    board,
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

  // Resolve the number as an ISSUE before the first write — findCard queries
  // repository.issue(number:), so a PR number (same namespace, and item-add
  // would accept its URL) fails here instead of boarding a forbidden PR card.
  // The same lookup refuses a duplicate: the issue already has a card.
  if (findCard(spawn, issue, project)?.id) {
    throw new Error(
      `#${issue} already has a card on board #${board} — not adding a duplicate`,
    );
  }

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

  // Any failure past item-add rolls the new card back: a partially
  // configured card cannot be finished by a retry — the pre-add duplicate
  // check would stop it — so failing must leave the board as it was found.
  try {
    editItemField(
      spawn,
      project,
      itemId,
      statusIds.fieldId,
      statusIds.optionId,
    );
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
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const del = gh(spawn, [
      "project",
      "item-delete",
      String(board),
      "--owner",
      OWNER,
      "--id",
      itemId,
      "--format",
      "json",
    ]);
    if (del.status !== 0) {
      throw new Error(
        `${message}; rolling the new card back ALSO failed (${(del.stderr ?? "").trim()}) — card ${itemId} on board #${board} is partially configured, delete it with board:delete before retrying`,
        { cause },
      );
    }
    throw new Error(
      `${message} — the new card was rolled back; re-run after fixing the cause`,
      { cause },
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
