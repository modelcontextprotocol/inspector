#!/usr/bin/env node
// Snapshot a board before touching a field's options (#2558) — `npm run
// board:snapshot [-- --board 28] [--dir <path>]`. The snapshot block
// board-ops previously transcribed inline — one command that is the
// difference between a five-minute restore and reconstructing ~200 statuses
// by inference.
//
// Two refusals carried over from the inline block, both load-bearing:
//
//  - A truncated snapshot cannot restore the cards it dropped, so the dump is
//    trusted only when complete (`itemListComplete`) and nothing is written
//    otherwise.
//  - The boards are private, so a snapshot is a full dump of item ids and
//    every card's Status and Priority. Written inside the working tree it is
//    one `git add -A` away from being published in a PR, so the default is a
//    fresh temp dir and a `--dir` under the current working directory is
//    refused.

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_BOARD, itemListComplete } from "./lib/board.mjs";
import { requirePositiveInt } from "./lib/gh.mjs";

export function parseSnapshotArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { board: { type: "string" }, dir: { type: "string" } },
  });
  return {
    board:
      values.board === undefined
        ? DEFAULT_BOARD
        : requirePositiveInt(values.board, "--board"),
    dir: values.dir,
  };
}

/**
 * The canonical form of a path: symlinks resolved. A path that does not
 * exist yet canonicalizes its deepest existing ancestor and re-joins the
 * rest, so a planned subdirectory still anchors to the real tree.
 * `resolve()` alone would let a symlinked `--dir` (e.g. /tmp/to-repo → the
 * worktree) place the private dump inside the repo.
 */
export function canonical(path, realpath = realpathSync) {
  const full = resolve(path);
  try {
    return realpath(full);
  } catch {
    const parent = dirname(full);
    if (parent === full) {
      return full;
    }
    return join(canonical(parent, realpath), basename(full));
  }
}

/** Throw when `dir` is inside `cwd` — a snapshot never lands in the worktree. */
export function assertOutsideRepo(dir, cwd, realpath = realpathSync) {
  const target = canonical(dir, realpath);
  const root = canonical(cwd, realpath);
  if (target === root || target.startsWith(root + sep)) {
    throw new Error(
      `refusing to write a board snapshot inside the repo (${target}) — ` +
        `the boards are private; use a directory outside ${root}`,
    );
  }
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { board, dir } = parseSnapshotArgs(argv);

  const target = dir ?? mkdtempSync(join(tmpdir(), "board-"));
  assertOutsideRepo(target, process.cwd());

  // itemListComplete throws on a truncated dump, so nothing partial is written.
  const dump = itemListComplete(spawn, board);
  const path = join(target, `board-${board}-snapshot.json`);
  // The dump is private: 0600 so a shared --dir (e.g. /tmp) never leaves it
  // world-readable, and "wx" so an existing file (or a symlink planted at the
  // path) is refused rather than followed or overwritten.
  writeFileSync(path, JSON.stringify(dump, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(`snapshot: ${path} (${dump.totalCount} items)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
