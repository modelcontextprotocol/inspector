import { describe, it, expect } from "vitest";
import { getViteBaseConfig } from "../../../../server/vite-base-config.js";

describe("getViteBaseConfig", () => {
  it("excludes node-only deps from optimizeDeps so vite dev doesn't scan them", () => {
    const config = getViteBaseConfig();
    expect(config.optimizeDeps.exclude).toEqual(
      expect.arrayContaining([
        "@modelcontextprotocol/sdk/client/stdio.js",
        "atomically",
        "cross-spawn",
        "which",
      ]),
    );
  });

  it("returns a fresh object each call (callers can mutate safely)", () => {
    const a = getViteBaseConfig();
    const b = getViteBaseConfig();
    expect(a).not.toBe(b);
    expect(a.optimizeDeps).not.toBe(b.optimizeDeps);
  });
});
