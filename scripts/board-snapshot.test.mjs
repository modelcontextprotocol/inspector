// Tests for scripts/board-snapshot.mjs (#2558) — the two refusals: nothing
// is written from a truncated dump, and nothing is ever written inside the
// repo (the boards are private; a snapshot in the worktree is one
// `git add -A` from a PR). Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseSnapshotArgs } from "./board-snapshot.mjs";
import { assertOutsideRepo } from "./lib/board.mjs";
test("parseSnapshotArgs defaults the board and passes --dir through", () => {
  assert.deepEqual(parseSnapshotArgs([]), { board: 28, dir: undefined });
  assert.deepEqual(parseSnapshotArgs(["--board", "11", "--dir", "/tmp/x"]), {
    board: 11,
    dir: "/tmp/x",
  });
});

test("assertOutsideRepo refuses the repo root and anything under it", () => {
  assert.throws(() => assertOutsideRepo("/repo", "/repo"), /private/);
  assert.throws(() => assertOutsideRepo("/repo/sub", "/repo"), /private/);
  // A sibling whose name shares the prefix is fine.
  assertOutsideRepo("/repo-sibling", "/repo");
  assertOutsideRepo("/elsewhere", "/repo");
});

test("assertOutsideRepo resolves symlinks — a link into the repo is refused", () => {
  const outside = mkdtempSync(join(tmpdir(), "board-snapshot-test-"));
  const repo = join(outside, "repo");
  const linkToRepo = join(outside, "to-repo");
  mkdirSync(repo);
  symlinkSync(repo, linkToRepo);
  assert.throws(() => assertOutsideRepo(linkToRepo, repo), /private/);
  // And the repo root reached through its own symlink still anchors the check.
  assert.throws(
    () => assertOutsideRepo(join(repo, "sub"), linkToRepo),
    /private/,
  );
});

const ITEMS = [{ id: "PVTI_a", status: "Todo" }];
const spawnScript = (totalCount) => () => ({
  status: 0,
  stdout: JSON.stringify({ items: ITEMS, totalCount }),
  stderr: "",
});

test("main writes the verified dump and prints its path", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "board-snapshot-test-"));
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  main(["--dir", dir], spawnScript(1));
  const path = join(dir, "board-28-snapshot.json");
  assert.deepEqual(lines, [`snapshot: ${path} (1 items)`]);
  const written = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(written.items, ITEMS);
  // The board is recorded in the snapshot so board-recover's diff can prove
  // the snapshot belongs to the board it diffs against.
  assert.equal(written.board, 28);
  // The dump is private: owner-only, and an existing file is never reused.
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.throws(() => main(["--dir", dir], spawnScript(1)), /EEXIST/);
});

test("main writes nothing from a truncated dump", () => {
  const dir = mkdtempSync(join(tmpdir(), "board-snapshot-test-"));
  assert.throws(() => main(["--dir", dir], spawnScript(500)), /INCOMPLETE/);
  assert.deepEqual(readdirSync(dir), []);
});

test("main refuses a --dir inside the working directory", () => {
  const inside = join(process.cwd(), "pr-screenshots");
  assert.throws(() => main(["--dir", inside], spawnScript(1)), /private/);
  assert.equal(existsSync(join(inside, "board-28-snapshot.json")), false);
});
