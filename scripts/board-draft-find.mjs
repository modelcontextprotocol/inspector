#!/usr/bin/env node
// Find a GHSA advisory draft card by title (#2558) — `npm run
// board:find-draft -- --ghsa GHSA-xxxx-yyyy-zzzz [--board 28]`. The
// title-lookup block board-ops previously transcribed inline.
//
// A draft card has no repository and no issue number, so the issue-side
// lookup the other board scripts use cannot find one — it is matched by the
// bracketed GHSA id prefix in its title, never by words from the summary (a
// summary is free text and two advisories can share one). The listing is
// trusted only when complete (`itemListComplete`), so a truncated dump reads
// as an error rather than as "no draft card".

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { DEFAULT_BOARD, itemListComplete } from "./lib/board.mjs";
import { requirePositiveInt } from "./lib/gh.mjs";

const GHSA_PATTERN =
  /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;

export function parseFindDraftArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { ghsa: { type: "string" }, board: { type: "string" } },
  });
  if (!values.ghsa || !GHSA_PATTERN.test(values.ghsa)) {
    throw new Error(
      `--ghsa must be a full GHSA id (GHSA-xxxx-yyyy-zzzz), got ${values.ghsa ?? "nothing"}`,
    );
  }
  return {
    ghsa: values.ghsa,
    board:
      values.board === undefined
        ? DEFAULT_BOARD
        : requirePositiveInt(values.board, "--board"),
  };
}

/** Draft items whose title carries the bracketed GHSA id prefix. */
export function draftsFor(items, ghsa) {
  return items.filter(
    (item) =>
      item?.content?.type === "DraftIssue" &&
      (item.content.title ?? "").startsWith(`[${ghsa}]`),
  );
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { ghsa, board } = parseFindDraftArgs(argv);

  const { items } = itemListComplete(spawn, board);
  const drafts = draftsFor(items, ghsa);
  if (drafts.length === 0) {
    throw new Error(`no draft card titled [${ghsa}] on #${board}`);
  }
  for (const draft of drafts) {
    console.log(`ITEM=${draft.id} ${draft.content.title}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
