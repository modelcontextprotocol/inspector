import { describe, it, expect } from "vitest";
import { getConfig } from "@testing-library/react";

/**
 * Pins Testing Library's `asyncUtilTimeout` for the `unit` project (#2323).
 *
 * That value governs every `waitFor` and `findBy*` here — 788 call sites — and
 * is the binding bound on any async assertion, being tighter than the project's
 * own per-test budget. So it is a number this repo states rather than inherits,
 * and a Testing Library upgrade that changed its default would fail here rather
 * than silently move all 788.
 *
 * ⚠️ The value is the library's own default, and that is a MEASURED decision,
 * not a shrug. #2323 proposed 5000, on the reasoning that a contended
 * happy-dom render is the worst case. Measured on the machine this team uses,
 * 5000 made the suite worse: three arms of three full unit runs each, same
 * worktree, comparable load —
 *
 *   • unmodified `v2/main`:         3/3 green
 *   • the raise to 5000:            1, 4 and 0 files timing out at 15000ms
 *   • the raise reverted:           3/3 green
 *
 * A different unrelated set failed each time and every one passed in about a
 * second in isolation, which is the shape of CPU starvation rather than of a
 * slow assertion. The mechanism: `asyncUtilTimeout` is not only a ceiling — any
 * wait that is *meant* to expire spends the whole budget on the happy path, so
 * a 5x raise is a 5x cost on exactly those tests, which saturates the worker
 * pool and starves tests that were never slow. The tests that assert absence
 * that way are the real defect and are #2335; revisit this when they are gone.
 *
 * ⚠️ This asserts the EFFECTIVE value at runtime rather than checking that
 * `setup.ts` contains a `configure()` call. An earlier revision of #2334 did
 * the latter by scanning source text, and the review found five ways to satisfy
 * the scan without configuring anything — a commented-out call, a call on
 * another object, a non-literal value, and so on. `getConfig()` is what the
 * `waitFor`s in this project actually read, so there is nothing left to spell
 * around.
 */
describe("Testing Library configuration (unit project)", () => {
  it("uses the asyncUtilTimeout this repo states, not whatever the library ships", () => {
    expect(getConfig().asyncUtilTimeout).toBe(1000);
  });
});
