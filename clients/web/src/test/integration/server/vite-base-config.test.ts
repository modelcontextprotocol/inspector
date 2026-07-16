import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearViteDepsCache,
  getViteBaseConfig,
  getViteDevOptimizeDeps,
} from "../../../../server/vite-base-config.js";

describe("getViteBaseConfig", () => {
  it("excludes node-only deps from optimizeDeps so vite dev doesn't scan them", () => {
    const config = getViteBaseConfig();
    expect(config.optimizeDeps.exclude).toEqual(
      expect.arrayContaining([
        "@modelcontextprotocol/client/stdio",
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

describe("getViteDevOptimizeDeps", () => {
  it("forces a full pre-bundle on each dev launch with no stale-request 504s", () => {
    const config = getViteDevOptimizeDeps();
    expect(config.force).toBe(true);
    expect(config.ignoreOutdatedRequests).toBe(true);
    expect(config.include).toEqual([
      "ajv",
      "@modelcontextprotocol/client/validators/ajv",
    ]);
    expect(config.exclude).toEqual(getViteBaseConfig().optimizeDeps.exclude);
  });
});

describe("clearViteDepsCache", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "vite-cache-clear-"));
    mkdirSync(join(tempRoot, "node_modules", ".vite", "deps"), {
      recursive: true,
    });
    writeFileSync(
      join(tempRoot, "node_modules", ".vite", "deps", "metadata.json"),
      "{}",
    );
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("removes node_modules/.vite before a dev server start", () => {
    expect(existsSync(join(tempRoot, "node_modules", ".vite"))).toBe(true);
    clearViteDepsCache(tempRoot);
    expect(existsSync(join(tempRoot, "node_modules", ".vite"))).toBe(false);
  });
});
