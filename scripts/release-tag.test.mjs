// Tests for scripts/release-tag.mjs (#2558) — both the version and the SHA
// come from origin/main after an explicit fetch (never a local HEAD), the
// default run is a dry run, --push tags that exact SHA, and the tag is the
// bare x.y.z (no v prefix). Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { main, parseTagArgs, versionFrom } from "./release-tag.mjs";

test("parseTagArgs defaults to a dry run", () => {
  assert.deepEqual(parseTagArgs([]), { push: false });
  assert.deepEqual(parseTagArgs(["--push"]), { push: true });
});

test("versionFrom validates the shape", () => {
  assert.equal(versionFrom('{"version":"2.4.1"}'), "2.4.1");
  assert.throws(() => versionFrom('{"version":"2.4"}'), /not x\.y\.z/);
  assert.throws(() => versionFrom("{}"), /not x\.y\.z/);
});

const SHA = "abc123def456";

function gitSpawn() {
  const calls = [];
  const spawn = (cmd, args) => {
    assert.equal(cmd, "git");
    calls.push(args);
    const joined = args.join(" ");
    let stdout = "";
    if (joined === "show origin/main:package.json") {
      stdout = '{"version":"2.4.1"}';
    } else if (joined === "rev-parse origin/main") {
      stdout = `${SHA}\n`;
    }
    return { status: 0, stdout, stderr: "" };
  };
  spawn.calls = calls;
  return spawn;
}

test("the default run fetches, prints what it would tag, and tags nothing", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = gitSpawn();
  main([], spawn);
  assert.deepEqual(lines, [
    `would tag: 2.4.1 → ${SHA} (origin/main) — re-run with --push`,
  ]);
  assert.deepEqual(spawn.calls[0], ["fetch", "origin", "main"]);
  assert.equal(
    spawn.calls.some((args) => args[0] === "tag" || args[0] === "push"),
    false,
  );
});

test("--push tags origin/main's SHA — never a local HEAD — and pushes it", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const spawn = gitSpawn();
  main(["--push"], spawn);
  assert.deepEqual(lines, [`tagged: 2.4.1 → ${SHA}`]);
  assert.deepEqual(
    spawn.calls.find((args) => args[0] === "tag"),
    ["tag", "2.4.1", SHA],
  );
  assert.deepEqual(
    spawn.calls.find((args) => args[0] === "push"),
    ["push", "origin", "2.4.1"],
  );
});

test("a failing git call throws with its stderr", () => {
  assert.throws(
    () => main([], () => ({ status: 128, stdout: "", stderr: "no remote" })),
    /git fetch origin main failed: no remote/,
  );
});
