import { vi } from "vitest";

/**
 * Structural guard for the whole CLI suite: armed interactive OAuth must not
 * shell out to a real browser. Registered via vitest `setupFiles` so it does
 * not depend on import order in individual test files.
 */
vi.mock("../../src/open-url.js", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
