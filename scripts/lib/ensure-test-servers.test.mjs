/**
 * Unit tests for the shared test-server build helper (#2111).
 *
 * Every consumer's happy path builds successfully, so from a smoke's point of
 * view each failure branch below is dead code — and the *invariant* the helper
 * exists for (that it builds even when the output is already there) is one no
 * consumer can assert about itself, because a smoke that drove a stale fixture
 * would report a product failure rather than a staleness one. That is exactly
 * the defect this replaced: an `existsSync` early return that made the check
 * silently measure the previous build.
 *
 * `run` and `exists` are injectable precisely so this can be driven without
 * spawning tsc.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import {
  TEST_SERVER_ENTRIES,
  buildFailureMessage,
  ensureTestServers,
  resetTestServerBuildCache,
  testServerEntryPath,
} from "./ensure-test-servers.mjs";

const ROOT = "/repo";

/** A helper invocation with the spawn and the fs stubbed out. */
function callEnsure({
  repoRoot = ROOT,
  requires = ["stdio"],
  status = 0,
  present = () => true,
  calls = [],
  logs = [],
} = {}) {
  return ensureTestServers({
    repoRoot,
    label: "test",
    requires,
    log: (m) => logs.push(m),
    run: (root) => {
      calls.push(root);
      return status;
    },
    exists: present,
  });
}

beforeEach(() => resetTestServerBuildCache());

describe("testServerEntryPath", () => {
  it("resolves each known entry under test-servers/build", () => {
    for (const [name, file] of Object.entries(TEST_SERVER_ENTRIES)) {
      assert.equal(
        testServerEntryPath(ROOT, name),
        join(ROOT, "test-servers", "build", file),
      );
    }
  });

  it("throws on an unknown entry rather than resolving a bogus path", () => {
    assert.throws(
      () => testServerEntryPath(ROOT, "nope"),
      /unknown test-server entry "nope"/,
    );
  });
});

describe("ensureTestServers", () => {
  it("builds even when every required entry is already on disk", () => {
    // The whole point of #2111: presence is not freshness.
    const calls = [];
    callEnsure({ present: () => true, calls });
    assert.deepEqual(calls, [ROOT]);
  });

  it("returns the required entry paths, in the order requested", () => {
    const paths = callEnsure({ requires: ["http", "stdio"] });
    assert.deepEqual(paths, [
      testServerEntryPath(ROOT, "http"),
      testServerEntryPath(ROOT, "stdio"),
    ]);
  });

  it("builds once per process per repo root", () => {
    // pack-and-verify asks twice; one tsc pass emits both entries.
    const calls = [];
    callEnsure({ requires: ["stdio"], calls });
    const paths = callEnsure({ requires: ["composable"], calls });
    assert.deepEqual(calls, [ROOT]);
    // The second call still resolves its own entries.
    assert.deepEqual(paths, [testServerEntryPath(ROOT, "composable")]);
  });

  it("still asserts existence on a cache hit that names a new entry", () => {
    // The build is cached; the assertion is not. A second caller asking for an
    // entry the first didn't must not be handed a path tsc never emitted.
    const absent = testServerEntryPath(ROOT, "composable");
    const present = (p) => p !== absent;
    callEnsure({ requires: ["stdio"], present });
    assert.throws(
      () => callEnsure({ requires: ["composable"], present }),
      (e) => e.message.includes(absent),
    );
  });

  it("builds again for a different repo root", () => {
    const calls = [];
    callEnsure({ calls });
    callEnsure({ repoRoot: "/other", calls });
    assert.deepEqual(calls, [ROOT, "/other"]);
  });

  it("logs through the caller's logger, unprefixed", () => {
    // pack-and-verify passes its own `step`, which adds "pack:verify — ".
    const logs = [];
    callEnsure({ logs });
    assert.deepEqual(logs, ["building test-servers..."]);
  });

  it("throws naming the missing entry when tsc emits nothing", () => {
    const missing = testServerEntryPath(ROOT, "composable");
    assert.throws(
      () =>
        callEnsure({
          requires: ["composable"],
          present: (p) => p !== missing,
        }),
      (e) =>
        e.message.includes(missing) &&
        e.message.includes("npm run test-servers:build"),
    );
  });

  it("throws on a non-zero tsc exit even when the entries exist", () => {
    // A stale build left over from a previous run must not pass a failed tsc.
    assert.throws(() => callEnsure({ status: 1 }), /tsc exited non-zero/);
  });

  it("does not mark a failed build as done", () => {
    const calls = [];
    assert.throws(() => callEnsure({ status: 1, calls }));
    assert.throws(() => callEnsure({ status: 1, calls }));
    assert.deepEqual(calls, [ROOT, ROOT]);
  });
});

describe("buildFailureMessage", () => {
  it("always points at the command that reproduces it", () => {
    assert.match(buildFailureMessage([]), /npm run test-servers:build/);
  });

  it("lists every missing entry", () => {
    const message = buildFailureMessage(["/a.js", "/b.js"]);
    assert.match(message, /missing \/a\.js, \/b\.js/);
  });
});
