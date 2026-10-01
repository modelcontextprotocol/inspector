#!/usr/bin/env node
// Delete an issue's board card (#2558) — `npm run board:delete -- --issue <N>
// [--board 28] [--reason duplicate|not-planned]`. The delete recipe board-ops
// previously transcribed inline, including the issue-side ITEM_ID lookup it
// depended on.
//
// "Done means the work shipped": an issue closed as duplicate / won't fix /
// not planned / obsolete shipped nothing, so its card is DELETED, not parked
// in Done. Deleting the card touches the board only — the issue keeps its
// labels and comments and stays searchable forever.
//
// `--reason` also closes the issue with the matching machine-readable state
// reason. `duplicate` cannot be set through `gh issue close --reason` (it
// accepts only completed / not planned), so the close goes through the API —
// the same PATCH the skill documented.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { OWNER, REPO_SLUG, gh, requirePositiveInt } from "./lib/gh.mjs";
import {
  DEFAULT_BOARD,
  findCard,
  projectId as resolveProjectId,
} from "./lib/board.mjs";

const CLOSE_REASONS = { duplicate: "duplicate", "not-planned": "not_planned" };

export function parseDeleteArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      issue: { type: "string" },
      board: { type: "string" },
      reason: { type: "string" },
    },
  });
  if (values.reason !== undefined && !(values.reason in CLOSE_REASONS)) {
    throw new Error(
      `--reason must be one of: ${Object.keys(CLOSE_REASONS).join(", ")}`,
    );
  }
  return {
    issue: requirePositiveInt(values.issue, "--issue"),
    board:
      values.board === undefined
        ? DEFAULT_BOARD
        : requirePositiveInt(values.board, "--board"),
    reason: values.reason,
  };
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { issue, board, reason } = parseDeleteArgs(argv);

  const project = resolveProjectId(spawn, board);
  const card = findCard(spawn, issue, project);
  if (!card?.id) {
    // Without --reason the absent card is the whole job failing. With it,
    // carry on to the close: a prior run may have deleted the card and then
    // failed the PATCH transiently, and stopping here would make that
    // partial failure unretryable.
    if (!reason) {
      throw new Error(
        `#${issue} has no card on board #${board} — nothing deleted`,
      );
    }
    console.log(
      `no card: #${issue} on board #${board} (already deleted?) — closing anyway`,
    );
  } else {
    const del = gh(spawn, [
      "project",
      "item-delete",
      String(board),
      "--owner",
      OWNER,
      "--id",
      card.id,
      "--format",
      "json",
    ]);
    if (del.status !== 0) {
      throw new Error(`item-delete failed: ${(del.stderr ?? "").trim()}`);
    }

    // Verify by looking the card up again — never report an unconfirmed delete.
    if (findCard(spawn, issue, project)?.id) {
      throw new Error(
        `#${issue} still has a card on board #${board} after delete`,
      );
    }
    console.log(`deleted: card for #${issue} on board #${board}`);
  }

  if (reason) {
    const close = gh(spawn, [
      "api",
      `repos/${REPO_SLUG}/issues/${issue}`,
      "-X",
      "PATCH",
      "-f",
      "state=closed",
      "-f",
      `state_reason=${CLOSE_REASONS[reason]}`,
    ]);
    if (close.status !== 0) {
      throw new Error(`close failed: ${(close.stderr ?? "").trim()}`);
    }
    console.log(`closed: #${issue} (${CLOSE_REASONS[reason]})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
