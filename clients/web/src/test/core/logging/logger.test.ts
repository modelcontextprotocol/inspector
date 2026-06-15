import { describe, it, expect } from "vitest";
import { silentLogger } from "../../../../../../core/logging/logger.js";

describe("silentLogger", () => {
  it("reports silent level", () => {
    expect(silentLogger.level).toBe("silent");
  });

  it("accepts log calls at every level without throwing", () => {
    expect(() => {
      silentLogger.fatal("fatal");
      silentLogger.error("error");
      silentLogger.warn("warn");
      silentLogger.info("info");
      silentLogger.debug("debug");
      silentLogger.trace("trace");
      silentLogger.silent("silent");
    }).not.toThrow();
  });

  it("child returns a logger that remains silent", () => {
    const child = silentLogger.child({ component: "test" });
    expect(child.level).toBe("silent");
    expect(() => child.info("nested")).not.toThrow();
    expect(child.child()).toBe(child);
  });
});
