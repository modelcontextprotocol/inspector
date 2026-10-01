// Tests for scripts/lib/gh.mjs (#2558) — the shared `gh` invocation helpers
// under the maintainer-workflow scripts. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gh,
  ghJson,
  ghGraphql,
  ghPaginatedList,
  requirePositiveInt,
} from "./gh.mjs";

function spawnReturning(result) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return result;
  };
  spawn.calls = calls;
  return spawn;
}

test("gh passes args through and returns the raw result", () => {
  const spawn = spawnReturning({ status: 0, stdout: "x", stderr: "" });
  const result = gh(spawn, ["api", "whatever"]);
  assert.equal(result.stdout, "x");
  assert.deepEqual(spawn.calls[0].args, ["api", "whatever"]);
  assert.equal(spawn.calls[0].cmd, "gh");
});

test("gh throws on a spawn-level error (gh not installed)", () => {
  const spawn = spawnReturning({ error: new Error("ENOENT") });
  assert.throws(() => gh(spawn, ["api"]), /ENOENT/);
});

test("ghJson parses stdout and throws on non-zero exit with stderr", () => {
  const ok = spawnReturning({ status: 0, stdout: '{"a":1}', stderr: "" });
  assert.deepEqual(ghJson(ok, ["api", "x"]), { a: 1 });

  const bad = spawnReturning({ status: 1, stdout: "", stderr: "auth broke" });
  assert.throws(() => ghJson(bad, ["api", "x"]), /auth broke/);
});

test("ghPaginatedList slurps and flattens pages", () => {
  const spawn = spawnReturning({
    status: 0,
    stdout: "[[1,2],[3]]",
    stderr: "",
  });
  assert.deepEqual(ghPaginatedList(spawn, "repos/o/r/things"), [1, 2, 3]);
  assert.deepEqual(spawn.calls[0].args, [
    "api",
    "--paginate",
    "--slurp",
    "repos/o/r/things",
  ]);
});

test("ghPaginatedList rejects a non-list response", () => {
  const notList = spawnReturning({ status: 0, stdout: '{"x":1}', stderr: "" });
  assert.throws(() => ghPaginatedList(notList, "p"), /non-list/);
  const mixedPages = spawnReturning({
    status: 0,
    stdout: "[[1],2]",
    stderr: "",
  });
  assert.throws(() => ghPaginatedList(mixedPages, "p"), /non-list/);
});

test("ghGraphql passes numbers with -F and strings with -f", () => {
  const spawn = spawnReturning({ status: 0, stdout: "{}", stderr: "" });
  ghGraphql(spawn, "query($n:Int!){x}", { n: 7, s: "abc" });
  assert.deepEqual(spawn.calls[0].args, [
    "api",
    "graphql",
    "-F",
    "n=7",
    "-f",
    "s=abc",
    "-f",
    "query=query($n:Int!){x}",
  ]);
});

test("requirePositiveInt accepts positives and rejects everything else", () => {
  assert.equal(requirePositiveInt("42", "--pr"), 42);
  for (const bad of [undefined, "0", "-1", "1.5", "abc", "", "07"]) {
    assert.throws(() => requirePositiveInt(bad, "--pr"), /--pr/);
  }
});
