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
  getStorybookOptimizeDeps,
  getViteBaseConfig,
  getViteDevCors,
  getViteDevOptimizeDeps,
} from "../../../../server/vite-base-config.js";

describe("getViteDevCors", () => {
  it("reflects only the configured origins, not any loopback port (#2752)", () => {
    const origins = ["http://localhost:6274", "http://127.0.0.1:6274"];
    expect(getViteDevCors(origins)).toEqual({ origin: origins });
  });

  it("copies the list so mutating the Vite config can't reach the caller's", () => {
    const origins = ["http://localhost:6274"];
    const cors = getViteDevCors(origins);
    expect(cors.origin).not.toBe(origins);
    cors.origin.push("http://localhost:9999");
    expect(origins).toEqual(["http://localhost:6274"]);
  });
});

describe("getViteBaseConfig", () => {
  it("excludes node-only deps from optimizeDeps so vite dev doesn't scan them", () => {
    const config = getViteBaseConfig();
    expect(config.optimizeDeps.exclude).toEqual(
      expect.arrayContaining([
        "@modelcontextprotocol/client/stdio",
        "atomically",
        "chokidar",
        "cross-spawn",
        "which",
        "@napi-rs/keyring",
        // #2082 — reached through `core/auth/node/file-lock.ts`. The tsup
        // `external` lists cover the production bundles, not `vite dev`, so
        // a node-only dependency has to be named in both places.
        "proper-lockfile",
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

describe("getStorybookOptimizeDeps", () => {
  it("forces a re-bundle on every run so a stale cache cannot re-optimize mid-run (#2340)", () => {
    const config = getStorybookOptimizeDeps();
    expect(config.force).toBe(true);
  });

  it("keeps the base include and exclude sets", () => {
    const config = getStorybookOptimizeDeps();
    const base = getViteBaseConfig().optimizeDeps;
    expect(config.include).toEqual(base.include);
    expect(config.exclude).toEqual(base.exclude);
    expect(config.include).toContain("@modelcontextprotocol/client");
  });

  it("does not carry the dev server's stale-request tolerance", () => {
    // `ignoreOutdatedRequests` belongs to `vite dev`, where a full page reload
    // follows a re-optimization; under Vitest a request for an outdated dep
    // must fail loudly, since nothing reloads the tester iframe.
    expect(getStorybookOptimizeDeps()).not.toHaveProperty(
      "ignoreOutdatedRequests",
    );
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
