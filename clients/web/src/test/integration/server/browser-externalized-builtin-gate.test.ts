import { describe, it, expect } from "vitest";
import {
  BROWSER_EXTERNALIZED_BUILTIN_PHRASE,
  isBrowserExternalizedBuiltinLog,
  browserExternalizedBuiltinError,
  createBrowserExternalizedBuiltinGate,
} from "../../../../server/browser-externalized-builtin-gate.js";

// Run `fn`, expect it to throw an Error, and return the thrown message —
// typed, so assertions on the message don't reach through an `any` catch var.
function messageFromThrow(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof Error) return err.message;
    throw err;
  }
  throw new Error("expected the call to throw, but it did not");
}

// A real message captured from vite@8.0.0's build log (see the gate module).
const REAL_MESSAGE =
  'Module "node:fs" has been externalized for browser compatibility, ' +
  'imported by "/app/src/main.tsx". See https://vite.dev/guide/troubleshooting.html' +
  "#module-externalized-for-browser-compatibility for more details.";

describe("isBrowserExternalizedBuiltinLog", () => {
  it("matches the real browser-externalization build message", () => {
    expect(isBrowserExternalizedBuiltinLog(REAL_MESSAGE)).toBe(true);
    // Sanity: the captured message actually contains the phrase we key off.
    expect(REAL_MESSAGE).toContain(BROWSER_EXTERNALIZED_BUILTIN_PHRASE);
  });

  it("does not match an unrelated build warning", () => {
    expect(
      isBrowserExternalizedBuiltinLog(
        "Some chunks are larger than 500 kB after minification.",
      ),
    ).toBe(false);
  });

  it("does not match an absent message", () => {
    expect(isBrowserExternalizedBuiltinLog(undefined)).toBe(false);
  });
});

describe("browserExternalizedBuiltinError", () => {
  it("builds an actionable #1769 error embedding every original warning", () => {
    const second = REAL_MESSAGE.replace("node:fs", "node:path");
    const err = browserExternalizedBuiltinError([REAL_MESSAGE, second]);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("#1769");
    expect(err.message).toContain("externalized to an empty stub");
    // Every offending warning is listed so all leaks are visible in one pass.
    expect(err.message).toContain(REAL_MESSAGE);
    expect(err.message).toContain(second);
  });
});

describe("createBrowserExternalizedBuiltinGate", () => {
  it("does not throw when no externalization was recorded", () => {
    const gate = createBrowserExternalizedBuiltinGate();
    expect(() => gate.assertClean()).not.toThrow();
  });

  it("throws #1769 in assertClean when a matching log was recorded", () => {
    const gate = createBrowserExternalizedBuiltinGate();
    gate.recordLog(REAL_MESSAGE);
    expect(() => gate.assertClean()).toThrow(/#1769/);
    // The recorded message is surfaced in the failure.
    expect(() => gate.assertClean()).toThrow(REAL_MESSAGE);
  });

  it("ignores non-matching and absent logs", () => {
    const gate = createBrowserExternalizedBuiltinGate();
    gate.recordLog("unrelated warning");
    gate.recordLog(undefined);
    expect(() => gate.assertClean()).not.toThrow();
  });

  it("reports every distinct offender when several are recorded", () => {
    const gate = createBrowserExternalizedBuiltinGate();
    const other = REAL_MESSAGE.replace("node:fs", "node:path");
    gate.recordLog(other);
    gate.recordLog(REAL_MESSAGE);
    // Both leaks surface in one failure rather than one-per-rebuild.
    const message = messageFromThrow(() => gate.assertClean());
    expect(message).toContain(other);
    expect(message).toContain(REAL_MESSAGE);
  });

  it("dedupes a repeated offender message", () => {
    const gate = createBrowserExternalizedBuiltinGate();
    gate.recordLog(REAL_MESSAGE);
    gate.recordLog(REAL_MESSAGE);
    // Listed once, not twice.
    const message = messageFromThrow(() => gate.assertClean());
    const occurrences = message.split(REAL_MESSAGE).length - 1;
    expect(occurrences).toBe(1);
  });

  it("reset() clears a recorded warning so a rebuild starts clean", () => {
    const gate = createBrowserExternalizedBuiltinGate();
    gate.recordLog(REAL_MESSAGE);
    gate.reset();
    // Post-reset the gate is clean...
    expect(() => gate.assertClean()).not.toThrow();
    // ...and can record + fail again on the next build.
    gate.recordLog(REAL_MESSAGE);
    expect(() => gate.assertClean()).toThrow(/#1769/);
  });

  it("keeps state per instance", () => {
    const dirty = createBrowserExternalizedBuiltinGate();
    dirty.recordLog(REAL_MESSAGE);
    const clean = createBrowserExternalizedBuiltinGate();
    expect(() => clean.assertClean()).not.toThrow();
    expect(() => dirty.assertClean()).toThrow(/#1769/);
  });
});
