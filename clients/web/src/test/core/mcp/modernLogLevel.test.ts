import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODERN_LOG_LEVEL,
  resolveModernLogLevel,
} from "@inspector/core/mcp/types.js";

describe("resolveModernLogLevel", () => {
  it("falls back to the default when unset", () => {
    expect(resolveModernLogLevel()).toBe(DEFAULT_MODERN_LOG_LEVEL);
    expect(resolveModernLogLevel({})).toBe(DEFAULT_MODERN_LOG_LEVEL);
  });

  it('treats "off" as not opted in', () => {
    expect(resolveModernLogLevel({ modernLogLevel: "off" })).toBeUndefined();
  });

  it("passes an explicit level through", () => {
    expect(resolveModernLogLevel({ modernLogLevel: "error" })).toBe("error");
  });
});
