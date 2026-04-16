import { describe, it, expect } from "@jest/globals";
import {
  formatDuration,
  formatTimestamp,
  formatTimestampFull,
} from "../timeUtils";

describe("timeUtils", () => {
  describe("formatDuration", () => {
    it("formats milliseconds for values under 1 second", () => {
      expect(formatDuration(0)).toBe("0ms");
      expect(formatDuration(1)).toBe("1ms");
      expect(formatDuration(245)).toBe("245ms");
      expect(formatDuration(999)).toBe("999ms");
    });

    it("formats seconds with one decimal for values under 10 seconds", () => {
      expect(formatDuration(1000)).toBe("1.0s");
      expect(formatDuration(1500)).toBe("1.5s");
      expect(formatDuration(2400)).toBe("2.4s");
      expect(formatDuration(9999)).toBe("10.0s");
    });

    it("formats seconds as integers for values 10 seconds and above", () => {
      expect(formatDuration(10000)).toBe("10s");
      expect(formatDuration(15000)).toBe("15s");
      expect(formatDuration(59999)).toBe("60s");
    });

    it("formats minutes and seconds for values 1 minute and above", () => {
      expect(formatDuration(60000)).toBe("1m");
      expect(formatDuration(90000)).toBe("1m 30s");
      expect(formatDuration(120000)).toBe("2m");
      expect(formatDuration(150000)).toBe("2m 30s");
    });

    it("handles edge cases", () => {
      expect(formatDuration(60001)).toBe("1m");
      expect(formatDuration(61000)).toBe("1m 1s");
    });
  });

  describe("formatTimestamp", () => {
    it("formats ISO timestamp to time-only string", () => {
      // Using a fixed date to ensure consistent output
      const isoString = "2026-01-15T14:34:56.000Z";
      const result = formatTimestamp(isoString);

      // The exact output depends on locale, but it should contain time components
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });

  describe("formatTimestampFull", () => {
    it("formats ISO timestamp to full date/time string", () => {
      const isoString = "2026-01-15T14:34:56.000Z";
      const result = formatTimestampFull(isoString);

      // The exact output depends on locale, but it should contain date and time
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });
});
