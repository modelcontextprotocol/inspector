import { strict as assert } from "node:assert";
import test from "node:test";

import {
  DEFAULTS,
  normalizeMs,
  outputTail,
  runRenderSmoke,
} from "./render-smoke.mjs";

const MARKER = "MCP Servers";

/** A stub terminal app, driven as a real child process rather than a spy. */
function stub(body) {
  return { command: process.execPath, args: ["-e", body] };
}

// `process.exitCode`, never `process.exit()`. Writing to a *pipe* is
// asynchronous, and `process.exit()` tears the process down without draining —
// so `console.log(MARKER); process.exit(1)` can lose the marker outright. That
// is not hypothetical: probing the drain race for this PR, a 4MB write followed
// by `process.exit()` arrived at the parent with the marker missing entirely.
// A stub that intermittently never paints would fail the very assertion meant
// to pin the paint-then-die path, and would fail it as "exited before
// rendering" — the neighbouring branch. Setting `exitCode` and letting the loop
// drain still exits immediately after the write; nothing holds it open.
const paintThenExit = (code) =>
  stub(`console.log(${JSON.stringify(MARKER)}); process.exitCode = ${code};`);
const paintThenLive = stub(
  `console.log(${JSON.stringify(MARKER)}); setInterval(() => {}, 1000);`,
);

const opts = {
  marker: MARKER,
  timeoutMs: 5000,
  surviveMs: 400,
  exitGraceMs: 500,
  drainMs: 200,
  warn: () => {},
};

// The regression this module exists for. The old harness resolved OK on the
// marker and never looked again, so this exact stub — paint, then die — passed.
test("fails when the child paints the marker and then exits non-zero", async () => {
  const r = await runRenderSmoke({ ...opts, ...paintThenExit(1) });
  assert.equal(r.code, 1, `expected failure, got: ${r.message}`);
  assert.match(r.message, /code 1/);
  assert.match(r.message, /it painted one frame, it did not run/);
  // The diagnostic must not read as a crash *before* first paint — that was a
  // different defect, and conflating them sends the reader to the wrong place.
  assert.doesNotMatch(r.message, /before rendering/);
});

// `exit` races the child's last `data` event, so this stub can be observed
// either way round on the same machine. Both orders must produce the same
// verdict AND the same wording — a message phrased off observation order would
// flip run to run, which is how a stable failure gets written off as flake.
// Repeated because one pass proves nothing about a race.
test("the verdict does not depend on whether exit beats the final output", async () => {
  for (let i = 0; i < 12; i++) {
    const r = await runRenderSmoke({ ...opts, ...paintThenExit(1) });
    assert.equal(r.code, 1, `run ${i}: expected failure, got: ${r.message}`);
    assert.match(r.message, /it painted one frame, it did not run/, `run ${i}`);
    assert.doesNotMatch(r.message, /before rendering/, `run ${i}`);
  }
});

// Exiting 0 right after painting is the same failure: the app did not run. It
// is called out separately because `script(1)` under busybox reports 0 for a
// crashed child, so the verdict cannot rest on the exit code.
test("fails when the child paints the marker and then exits zero", async () => {
  const r = await runRenderSmoke({ ...opts, ...paintThenExit(0) });
  assert.equal(r.code, 1, `expected failure, got: ${r.message}`);
  assert.match(r.message, /it painted one frame, it did not run/);
});

test("passes when the child paints the marker and keeps running", async () => {
  const r = await runRenderSmoke({ ...opts, ...paintThenLive });
  assert.equal(r.code, 0, `expected pass, got: ${r.message}`);
  assert.match(r.message, /still running 400ms later/);
});

// The first-paint deadline and the survival window overlap: `done` is
// first-caller-wins, so an armed render timer firing during the survival window
// settles the run as "did not render" — while quoting an output tail that
// visibly contains the marker. A slow-but-fine TUI would fail, intermittently,
// with a diagnostic pointing at the wrong thing entirely.
test("a paint landing just under the deadline is not failed by the render timer", async () => {
  // The two clocks start at different moments: the child's `setTimeout` runs
  // from its own first JS tick, while `renderTimer` is armed in the parent at
  // spawn. A delay written as a plain `setTimeout(paint, N)` therefore lands at
  // `N + startup`, so the deadline has to carry a startup allowance — and the
  // case fails, as "did not render", whenever the machine is loaded enough to
  // exceed it. It failed three `local:gate` runs in a row that way while
  // passing every time standalone (#2177), and widening the allowance only
  // moved the threshold (#2180).
  //
  // So the paint is anchored to the PARENT's clock instead: the child is told
  // the wall-clock instant to paint at, and sleeps for whatever is left of it
  // when it gets there. Startup is then *absorbed* by the sleep rather than
  // added to it, and the paint lands at ~`PAINT_AT` measured from spawn no
  // matter how slow the boot was.
  const spawnedAt = Date.now();
  const PAINT_AT = 300;
  const timeoutMs = 600;
  const surviveMs = 900;

  const r = await runRenderSmoke({
    ...opts,
    ...stub(
      `const at = ${spawnedAt + PAINT_AT};` +
        `setTimeout(() => { console.log(${JSON.stringify(MARKER)}); ` +
        `setInterval(() => {}, 1000); }, Math.max(0, at - Date.now()));`,
    ),
    // The shape being reproduced is an overlap, and only an overlap:
    //
    //   actual paint  <  timeoutMs  <  actual paint + surviveMs
    //
    // i.e. the render deadline expires while the survival window is still
    // open. `done` is first-caller-wins, so an armed render timer firing in
    // that gap settles the run as "did not render <marker>" while quoting an
    // output tail that visibly contains the marker.
    //
    // `timeoutMs < surviveMs` is what makes the right-hand side hold for ANY
    // paint time, including 0 — so a boot slow enough to swallow the anchor
    // still reproduces the overlap rather than degrading into a different
    // case. The only startup assumption left is that boot finishes before the
    // deadline at all, and 600ms is an order of magnitude over the 46-59ms
    // measured here idle.
    //
    // Do not tighten these to make the test faster, and do not reorder them so
    // that `surviveMs <= timeoutMs`: the overlap is the point.
    timeoutMs,
    surviveMs,
  });
  assert.equal(r.code, 0, `expected pass, got: ${r.message}`);
  assert.doesNotMatch(r.message, /did not render/);

  // Passing is not on its own evidence that the overlap was reproduced — a
  // paint late enough to land past `timeoutMs` fails, but one landing so early
  // that the deadline falls outside the survival window would pass while
  // testing nothing. Read the paint time back out of the verdict and assert
  // the shape actually held, so the case cannot go vacuous.
  const paintedAt = Number(/ at (\d+)ms/.exec(r.message)?.[1]);
  assert.ok(
    Number.isFinite(paintedAt),
    `no first-paint time in verdict: ${r.message}`,
  );
  assert.ok(
    paintedAt < timeoutMs && timeoutMs < paintedAt + surviveMs,
    `deadline did not fall inside the survival window: painted at ${paintedAt}ms, ` +
      `timeoutMs ${timeoutMs}, surviveMs ${surviveMs}`,
  );
});

test("fails when the child exits before painting", async () => {
  const r = await runRenderSmoke({
    ...opts,
    // `exitCode`, not `exit()` — see `paintThenExit`. A forced exit can
    // truncate the stderr write, making the `boom` assertion below flaky.
    ...stub(`console.error("boom"); process.exitCode = 3;`),
  });
  assert.equal(r.code, 1);
  assert.match(r.message, /before rendering/);
  assert.match(r.message, /code 3/);
  // The tail is quoted after the drain, so the crash reason survives.
  assert.match(r.message, /boom/);
});

test("fails when the child never paints, and kills it", async () => {
  let spawned;
  const r = await runRenderSmoke({
    ...opts,
    ...stub(`setInterval(() => {}, 1000);`),
    timeoutMs: 300,
    onSpawn: (c) => (spawned = c),
  });
  assert.equal(r.code, 1);
  assert.match(r.message, /did not render/);
  // The #2000 ownership rule: the child is published before the wait, so the
  // timeout path leaves a stoppable handle rather than an orphan.
  assert.ok(spawned, "onSpawn was never called");
  assert.notEqual(
    spawned.exitCode === null && spawned.signalCode === null,
    true,
  );
});

test("reports a spawn failure rather than throwing it uncaught", async () => {
  const r = await runRenderSmoke({
    ...opts,
    command: "/definitely/not/a/binary-2147",
    args: [],
  });
  assert.equal(r.code, 1);
  assert.match(r.message, /failed to spawn/);
});

test("scans stderr as well as stdout for the marker", async () => {
  // An Ink app writing to stderr is missed entirely by a stdout-only scan,
  // which then times out with an empty diagnostic.
  const r = await runRenderSmoke({
    ...opts,
    ...stub(
      `console.error(${JSON.stringify(MARKER)}); setInterval(() => {}, 1000);`,
    ),
  });
  assert.equal(r.code, 0, `expected pass, got: ${r.message}`);
});

// `Number("")` is 0 and `Number("typo")` is NaN, and `??` catches neither
// because both are non-nullish. `setTimeout` fires immediately on either, so an
// un-normalized `surviveMs` resolves the survival check before the child could
// possibly have died — restoring the exact first-paint false green, on a run
// that still prints OK. This is the guard on the guard.
test("normalizeMs rejects the values a bad env var actually produces", () => {
  assert.equal(normalizeMs(Number(""), 2000), 2000);
  assert.equal(normalizeMs(Number("typo"), 2000), 2000);
  assert.equal(normalizeMs(undefined, 2000), 2000);
  assert.equal(normalizeMs(-1, 2000), 2000);
  assert.equal(normalizeMs(Infinity, 2000), 2000);
  assert.equal(normalizeMs("3000", 2000), 2000, "a string is not a duration");
  // 0 is a typo, never "skip the check" — there is no caller who wants that.
  assert.equal(normalizeMs(0, 2000), 2000);
  // A real value passes through untouched.
  assert.equal(normalizeMs(1234, 2000), 1234);
});

test("a zero survival window falls back rather than passing instantly", async () => {
  // End to end through the real state machine: with surviveMs honored as 0 the
  // paint-then-exit stub would settle OK before the child's exit was seen.
  const r = await runRenderSmoke({
    ...opts,
    ...paintThenExit(1),
    surviveMs: Number(""),
  });
  assert.equal(r.code, 1, `expected failure, got: ${r.message}`);
  // The window named in the message is the normalized one, not the 0 passed in.
  assert.match(
    r.message,
    new RegExp(`${DEFAULTS.surviveMs}ms survival window`),
  );
  assert.doesNotMatch(r.message, /\b0ms survival window/);
});

// `forbidOutput` is `smoke:tui`'s guard for the acceptance criterion that the
// raw-mode error must not appear in a passing run. It lives here rather than at
// the call site precisely so it can be driven both ways: the real PTY happy
// path only ever exercises the pattern NOT matching, so a regression that broke
// this check would stay green forever.
test("forbidOutput fails a run that would otherwise have passed", async () => {
  const r = await runRenderSmoke({
    ...opts,
    ...stub(
      `console.log(${JSON.stringify(MARKER)}); ` +
        `console.error("Raw mode is not supported on the current process.stdin"); ` +
        `setInterval(() => {}, 1000);`,
    ),
    forbidOutput: {
      pattern: /Raw mode is not supported/,
      reason: "survived but logged the raw-mode error",
    },
  });
  assert.equal(r.code, 1, `expected failure, got: ${r.message}`);
  assert.match(r.message, /survived but logged the raw-mode error/);
  // The offending output is quoted, so the reader sees the evidence.
  assert.match(r.message, /Raw mode is not supported/);
});

test("forbidOutput leaves a passing run alone when it does not match", async () => {
  const r = await runRenderSmoke({
    ...opts,
    ...paintThenLive,
    forbidOutput: {
      pattern: /Raw mode is not supported/,
      reason: "should not be reached",
    },
  });
  assert.equal(r.code, 0, `expected pass, got: ${r.message}`);
  assert.doesNotMatch(r.message, /should not be reached/);
});

// A crash reason is more useful than "and it also printed X", which is usually
// a symptom of the same crash rather than a separate finding.
test("forbidOutput does not overwrite an existing failure's diagnostic", async () => {
  const r = await runRenderSmoke({
    ...opts,
    ...stub(
      `console.error("Raw mode is not supported"); process.exitCode = 1;`,
    ),
    forbidOutput: {
      pattern: /Raw mode is not supported/,
      reason: "should not replace the crash reason",
    },
  });
  assert.equal(r.code, 1);
  assert.match(r.message, /before rendering/);
  assert.doesNotMatch(r.message, /should not replace the crash reason/);
});

test("outputTail drops a leading partial line but keeps short output whole", () => {
  assert.equal(outputTail("short", 800), "short");
  // Over the limit: the slice can land mid-escape-sequence, so it starts after
  // the first newline instead of leading with a fragment.
  const long = "x".repeat(50) + "\nkeep me";
  assert.equal(outputTail(long, 20), "keep me");
  // No newline in the tail at all: nothing to trim to, so return it as sliced.
  assert.equal(outputTail("y".repeat(50), 10), "y".repeat(10));
});
