import { describe, it, expect } from "vitest";
import {
  BROWSER_EXTERNALIZED_BUILTIN_PHRASE,
  isBrowserExternalizedBuiltinLog,
  browserExternalizedBuiltinError,
  createBrowserExternalizedBuiltinGate,
} from "../../../../server/browser-externalized-builtin-gate.js";

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
  it("builds an actionable #1769 error embedding the original warning", () => {
    const err = browserExternalizedBuiltinError(REAL_MESSAGE);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("#1769");
    expect(err.message).toContain("externalized to an empty stub");
    // The original Vite warning is preserved so the offending module is visible.
    expect(err.message).toContain(REAL_MESSAGE);
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

  it("retains the first matching message when several are recorded", () => {
    const gate = createBrowserExternalizedBuiltinGate();
    const first = REAL_MESSAGE.replace("node:fs", "node:path");
    gate.recordLog(first);
    gate.recordLog(REAL_MESSAGE);
    // The first offender is the one reported (the `=== undefined` guard).
    expect(() => gate.assertClean()).toThrow(first);
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
