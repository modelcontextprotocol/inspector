// Tests for scripts/advisory-fork.mjs (#2558) — the read-first ordering (the
// POST creates a fork as a side effect and needs delete_repo scope to undo)
// and the explicit --create gate. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { main, parseForkArgs } from "./advisory-fork.mjs";

const GHSA = "GHSA-2345-cfgh-jmpq";

test("parseForkArgs requires a full GHSA id and defaults create off", () => {
  assert.deepEqual(parseForkArgs(["--ghsa", GHSA]), {
    ghsa: GHSA,
    create: false,
  });
  assert.equal(parseForkArgs(["--ghsa", GHSA, "--create"]).create, true);
  assert.throws(() => parseForkArgs(["--ghsa", "nope"]), /full GHSA id/);
});

function spawnScript({ fork = null } = {}) {
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push(args);
    const joined = args.join(" ");
    let payload;
    if (joined.includes("POST")) {
      payload = { full_name: "modelcontextprotocol/inspector-ghsa-fork" };
    } else if (joined.includes("security-advisories")) {
      payload = { private_fork: fork };
    } else {
      assert.fail(`unexpected gh call: ${joined}`);
    }
    return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
  };
  spawn.calls = calls;
  return spawn;
}

test("an existing fork is printed and the POST never runs", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript({ fork: { full_name: "mcp/fork-x" } });
  main(["--ghsa", GHSA, "--create"], spawn);
  assert.deepEqual(lines, ["fork: mcp/fork-x (existing)"]);
  assert.equal(
    spawn.calls.some((args) => args.includes("POST")),
    false,
  );
});

test("without --create a missing fork is reported, not created", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = spawnScript();
  main(["--ghsa", GHSA], spawn);
  assert.match(lines[0], /fork: none — re-run with --create/);
  assert.equal(
    spawn.calls.some((args) => args.includes("POST")),
    false,
  );
});

test("with --create a missing fork is created and printed", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  main(["--ghsa", GHSA, "--create"], spawnScript());
  assert.deepEqual(lines, [
    "fork: modelcontextprotocol/inspector-ghsa-fork (created)",
  ]);
});
