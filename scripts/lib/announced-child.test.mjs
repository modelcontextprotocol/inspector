/**
 * Tests for the spawn/readiness ownership helper (#2000).
 *
 * The invariant under test is the one a smoke script can never check itself:
 * a child that stays alive *through* the readiness timeout must still be
 * reachable by the caller's teardown. `smoke:web:app`'s happy path always gets
 * the announcement, so a regression here would be silent in `npm run local:gate` and
 * would surface only as a stray process holding a port on a later run.
 *
 * Every case drives a real `node -e` child rather than a spy, so the assertion
 * is about a real process being killable, not about a mock's call log.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { startAnnouncedChild } from "./announced-child.mjs";

/** Wait for a real child to exit (or resolve immediately if it already has). */
function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve) => child.once("close", resolve));
}

/**
 * Build an `onSpawn` that registers teardown the moment the child exists, so it
 * is killed on every path out of the test — a failed assertion included.
 *
 * This is the helper's own ownership rule applied to the suite: killing only on
 * the success path would leak a 60-second child into the runner precisely when
 * the regression being guarded has come back, which is the one run where a leak
 * matters most. Killing an already-exited child is a no-op, so the early-exit
 * cases pay nothing for it.
 */
function killOnTeardown(t, capture = () => {}) {
  return (child) => {
    capture(child);
    t.after(async () => {
      child.kill("SIGKILL");
      await waitForExit(child);
    });
  };
}

test("hands the child to onSpawn before waiting, and returns the match", async (t) => {
  let seen = null;
  const { child, match } = await startAnnouncedChild({
    command: process.execPath,
    args: ["-e", 'console.error("listening at http://127.0.0.1:9999")'],
    pattern: /listening at (http:\/\/\S+)/i,
    onSpawn: killOnTeardown(t, (c) => (seen = c)),
    what: "probe",
    timeoutMs: 10_000,
    pollMs: 25,
  });
  assert.equal(seen, child, "onSpawn got the child that was returned");
  assert.equal(match[1], "http://127.0.0.1:9999");
});

test("scans stdout as well as stderr", async (t) => {
  const { match } = await startAnnouncedChild({
    command: process.execPath,
    args: ["-e", 'console.log("ready on 4242")'],
    pattern: /ready on (\d+)/,
    onSpawn: killOnTeardown(t),
    what: "probe",
    timeoutMs: 10_000,
    pollMs: 25,
  });
  assert.equal(match[1], "4242");
});

test("sees an announcement that lands inside the final polling interval", async (t) => {
  // The off-by-one this guards: a fixed attempt count checks the output and
  // then sleeps, so nothing ever observes the last interval — an announcement
  // at 29.9s of a 30s budget reads as a timeout.
  //
  // Setting pollMs === timeoutMs makes that deterministic rather than a race:
  // the attempt-counted loop gets exactly one check, at t≈0 before the child
  // has even finished starting, and then throws. The deadline loop re-reads
  // after the wait, so *any* announcement before the deadline is seen. The
  // child announces immediately, ~2s inside the window on either side, so a
  // loaded runner cannot flip the outcome. (Verified: this fails against the
  // attempt-counted loop and passes against the deadline loop.)
  const { match } = await startAnnouncedChild({
    command: process.execPath,
    args: ["-e", 'console.error("listening at http://127.0.0.1:8080")'],
    pattern: /listening at (http:\/\/\S+)/i,
    onSpawn: killOnTeardown(t),
    what: "probe",
    timeoutMs: 2000,
    pollMs: 2000,
  });
  assert.equal(match[1], "http://127.0.0.1:8080");
});

test("a non-announcing child is still reachable and killable after the timeout", async (t) => {
  // The regression: a child that is alive but never announces. The throw must
  // not be the only thing that happens — the caller must already hold the
  // handle, or `process.exit(1)` leaves this running.
  let published = null;
  await assert.rejects(
    startAnnouncedChild({
      // Sleeps well past the budget and prints nothing matching.
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      pattern: /never going to match/,
      onSpawn: killOnTeardown(t, (c) => (published = c)),
      what: "probe",
      timeoutMs: 300,
      pollMs: 25,
    }),
    /probe did not start within/,
  );

  assert.ok(published, "the child was published before the readiness wait");
  assert.equal(
    published.exitCode,
    null,
    "and it is still alive, as in the bug",
  );

  published.kill("SIGKILL");
  await waitForExit(published);
  assert.ok(
    published.exitCode !== null || published.signalCode !== null,
    "teardown could actually stop it",
  );
});

test("reports a child that exits before announcing, with its output", async (t) => {
  let published = null;
  await assert.rejects(
    startAnnouncedChild({
      command: process.execPath,
      args: ["-e", 'console.error("boom: bad config"); process.exit(3)'],
      pattern: /never going to match/,
      onSpawn: killOnTeardown(t, (c) => (published = c)),
      what: "probe",
      timeoutMs: 10_000,
      pollMs: 25,
    }),
    (err) =>
      /probe exited early/.test(err.message) &&
      /boom: bad config/.test(err.message),
  );
  assert.ok(published, "published even on the early-exit path");
});

test("reports a spawn failure rather than throwing it uncaught", async (t) => {
  await assert.rejects(
    startAnnouncedChild({
      command: "definitely-not-an-executable-2000",
      args: [],
      pattern: /never/,
      onSpawn: killOnTeardown(t),
      what: "probe",
      timeoutMs: 10_000,
      pollMs: 25,
    }),
    /could not spawn the probe:/,
  );
});
