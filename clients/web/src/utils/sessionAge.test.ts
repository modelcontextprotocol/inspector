import { describe, expect, it } from "vitest";
import { sessionAge } from "./sessionAge";

const NOW = Date.parse("2026-03-01T01:00:00.000Z");

describe("sessionAge", () => {
  it("formats a duration before now", () => {
    expect(sessionAge("2026-03-01T00:59:30.000Z", NOW)).toBe("30s ago");
    expect(sessionAge("2026-03-01T00:00:00.000Z", NOW)).toBe("1h00m ago");
  });

  it("says never for a timestamp that does not exist", () => {
    expect(sessionAge(null, NOW)).toBe("never");
  });
});
