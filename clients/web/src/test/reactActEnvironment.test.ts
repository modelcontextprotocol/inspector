import { describe, it, expect } from "vitest";

/**
 * Pins React's act-environment flag for the `unit` project (#2507).
 *
 * React warns "The current testing environment is not configured to support
 * act(...)" on every direct `act` call unless `IS_REACT_ACT_ENVIRONMENT` is
 * true. Testing Library sets it only from a global `beforeAll`, which this
 * project does not have (no `globals: true`), so `setup.ts` sets it instead.
 * Without it, CI printed ~95 copies of that warning per job and buried real
 * warnings in the same output.
 *
 * This asserts the effective value at runtime rather than scanning `setup.ts`,
 * for the reason `asyncUtilTimeout.test.ts` gives: the runtime value is what
 * React actually reads.
 */
describe("React act environment (unit project)", () => {
  it("is configured to support act", () => {
    expect(
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT,
    ).toBe(true);
  });
});
