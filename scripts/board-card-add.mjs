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
// The command is IDEMPOTENT rather than rolling back on failure. `item-add`
// is itself idempotent — two invocations (or a concurrent add) can both
// receive the same item id — so this script can never prove it created the
// card it holds an id for, and deleting on failure could destroy a card a
// concurrent operation owns. Instead: an existing card whose requested
// fields are unset or already match is (re)configured in place — which is
// also what lets a re-run finish a card a failed edit left partial — and an
// existing card holding a CONTRADICTING value is refused before any write.
//
// The issue is also resolved as an ISSUE before the first write: issue and
// PR numbers share one namespace, `/issues/<PR number>` redirects to the PR,
// and `item-add` accepts it — which would board a PR (forbidden) and fail
// only at the later verify, leaving the bad card behind.

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
  requireSupportedBoard,
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
  const board = requireSupportedBoard(
    values.board === undefined
      ? DEFAULT_BOARD
      : requirePositiveInt(values.board, "--board"),
  );
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

/**
 * Look the issue's card up and refuse when a requested field holds a
 * DIFFERENT value — the real duplicate-add mistake (a wrong issue number, an
 * issue already moving through the board), where proceeding would overwrite
 * board state someone else set. Returns the card's item id when it exists
 * with unset/matching fields (safe to configure in place), else undefined.
 */
function assertNoConflicts(spawn, issue, project, board, status, priority) {
  const existing = findCard(spawn, issue, project);
  if (!existing?.id) {
    return undefined;
  }
  const conflicts = [];
  const statusNow = existing.fieldValueByName?.name;
  if (statusNow != null && statusNow !== status) {
    conflicts.push(`Status "${statusNow}"`);
  }
  if (priority !== undefined) {
    const priorityNow = findCard(spawn, issue, project, "Priority")
      ?.fieldValueByName?.name;
    if (priorityNow != null && priorityNow !== priority) {
      conflicts.push(`Priority "${priorityNow}"`);
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `#${issue} already has a card on board #${board} reading ${conflicts.join(" and ")} — not adding a duplicate or overwriting a configured card; move it with board:status`,
    );
  }
  return existing.id;
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
  // An existing card with unset/matching fields is configured in place: that
  // is a re-run finishing this command's own earlier failure, or a harmless
  // repeat, and treating it as an error would make every failure after
  // item-add unrecoverable (see the header — rollback deletion is unsound).
  let itemId = assertNoConflicts(
    spawn,
    issue,
    project,
    board,
    status,
    priority,
  );
  if (itemId === undefined) {
    const addedId = ghJson(spawn, [
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
    if (!addedId) {
      throw new Error(`item-add returned no id for #${issue}`);
    }
    // item-add is idempotent, so the empty pre-check does not prove this id
    // names a NEW, unconfigured card — a concurrent invocation may have
    // added AND configured it between the check and the add. Re-read it and
    // re-apply the same conflict checks before the first field write; the
    // added id is used only if the card is not yet visible to the lookup.
    itemId =
      assertNoConflicts(spawn, issue, project, board, status, priority) ??
      addedId;
  }

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
    // NO rollback deletion: item-add is idempotent, so this invocation may
    // hold the id of a card a concurrent operation created or has since
    // configured — deleting it would destroy their work. The card is left
    // in place and a re-run finishes it (or refuses, naming the conflict).
    throw new Error(
      `${message} — card ${itemId} on board #${board} may be partially configured; re-run this command to finish it, or remove it with board:delete`,
      { cause },
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
