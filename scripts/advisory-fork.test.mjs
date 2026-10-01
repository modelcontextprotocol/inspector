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

function spawnScript({ fork = null, postPayload, afterFork } = {}) {
  const calls = [];
  let posted = false;
  const spawn = (cmd, args) => {
    calls.push(args);
    const joined = args.join(" ");
    let payload;
    if (joined.includes("POST")) {
      posted = true;
      payload = postPayload ?? {
        full_name: "modelcontextprotocol/inspector-ghsa-fork",
      };
    } else if (joined.includes("security-advisories")) {
      payload = { private_fork: posted ? (afterFork ?? fork) : fork };
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

test("a POST answering with the advisory shape still reports the fork", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  main(
    ["--ghsa", GHSA, "--create"],
    spawnScript({
      postPayload: { private_fork: { full_name: "mcp/nested-fork" } },
    }),
  );
  assert.deepEqual(lines, ["fork: mcp/nested-fork (created)"]);
});

test("a nameless POST response re-reads the advisory, and never fails a fork that was made", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  // Re-read finds the name:
  main(
    ["--ghsa", GHSA, "--create"],
    spawnScript({
      postPayload: {},
      afterFork: { full_name: "mcp/async-fork" },
    }),
  );
  // Re-read still pending — reported as created, not as a failure, since the
  // POST succeeded and the fork now exists:
  main(
    ["--ghsa", GHSA, "--create"],
    spawnScript({ postPayload: {}, afterFork: null }),
  );
  assert.deepEqual(lines, [
    "fork: mcp/async-fork (created)",
    "fork: created, name pending — re-run without --create to confirm",
  ]);
});
