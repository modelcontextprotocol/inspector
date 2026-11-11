// Tests for `main-module.mjs` (#2748). The platform is injected, so the
// Windows case — the one the old `file://${argv[1]}` guard got wrong — runs on
// the POSIX machines too, not only on the Windows CI job.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./main-module.mjs";

test("matches a POSIX entry path", () => {
  assert.equal(
    isMainModule(
      "file:///home/dev/inspector/scripts/board-card-add.mjs",
      "/home/dev/inspector/scripts/board-card-add.mjs",
      "linux",
    ),
    true,
  );
});

test("matches a Windows entry path the raw file:// comparison misses", () => {
  const url = "file:///C:/work/inspector/scripts/board-card-add.mjs";
  const argv1 = "C:\\work\\inspector\\scripts\\board-card-add.mjs";
  // The guard this replaces — pinned as wrong so the regression is visible.
  assert.notEqual(url, `file://${argv1}`);
  assert.equal(isMainModule(url, argv1, "win32"), true);
});

test("matches a path containing a space, which the URL percent-encodes", () => {
  assert.equal(
    isMainModule(
      "file:///Users/First%20Last/inspector/scripts/dco-check.mjs",
      "/Users/First Last/inspector/scripts/dco-check.mjs",
      "darwin",
    ),
    true,
  );
  assert.equal(
    isMainModule(
      "file:///C:/Users/First%20Last/inspector/scripts/dco-check.mjs",
      "C:\\Users\\First Last\\inspector\\scripts\\dco-check.mjs",
      "win32",
    ),
    true,
  );
});

test("does not match when another script is the entry point", () => {
  assert.equal(
    isMainModule(
      "file:///home/dev/inspector/scripts/board-card-add.mjs",
      "/home/dev/inspector/scripts/board-card-status.mjs",
      "linux",
    ),
    false,
  );
});

test("does not match with no argv[1] (node -e, the REPL)", () => {
  const url = "file:///home/dev/inspector/scripts/board-card-add.mjs";
  assert.equal(isMainModule(url, undefined, "linux"), false);
  assert.equal(isMainModule(url, "", "linux"), false);
});

test("defaults to the running platform and process.argv[1]", () => {
  // The real OS's own path for this file round-trips — on the Windows CI job
  // that is a backslash path, so this is the live check of the win32 branch.
  assert.equal(
    isMainModule(import.meta.url, fileURLToPath(import.meta.url)),
    true,
  );
  // Whatever the entry point is, it is not a file that does not exist.
  assert.equal(isMainModule("file:///nonexistent/never-the-entry.mjs"), false);
});
