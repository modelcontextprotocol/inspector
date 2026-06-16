import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

const { existsSync, spawnSync } = vi.hoisted(() => ({
  existsSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({ existsSync }));
vi.mock("node:child_process", () => ({ spawnSync }));

import { ensureWebBuild } from "../../../../server/ensure-web-build.js";

const WEB_ROOT = "/repo/clients/web";
const DIST_ROOT = join(WEB_ROOT, "dist");
const INDEX_HTML = join(DIST_ROOT, "index.html");

describe("ensureWebBuild", () => {
  it("is a no-op when the build already exists", () => {
    const exists = vi.fn().mockReturnValue(true);
    const build = vi.fn();
    const log = vi.fn();

    ensureWebBuild(WEB_ROOT, DIST_ROOT, { exists, build, log });

    expect(exists).toHaveBeenCalledWith(INDEX_HTML);
    expect(build).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("builds on demand when the build is missing, then proceeds", () => {
    // Missing before the build, present after.
    const exists = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const build = vi.fn().mockReturnValue(0);
    const log = vi.fn();

    expect(() =>
      ensureWebBuild(WEB_ROOT, DIST_ROOT, { exists, build, log }),
    ).not.toThrow();

    expect(build).toHaveBeenCalledWith(WEB_ROOT, expect.any(Function));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("No production web build found");
  });

  it("throws an actionable error when the build exits non-zero", () => {
    const exists = vi.fn().mockReturnValue(false);
    const build = vi.fn().mockReturnValue(1);

    expect(() =>
      ensureWebBuild(WEB_ROOT, DIST_ROOT, { exists, build, log: vi.fn() }),
    ).toThrow(/Could not build the web UI automatically/);
  });

  it("throws when the build can't even run (null exit status)", () => {
    const exists = vi.fn().mockReturnValue(false);
    const build = vi.fn().mockReturnValue(null);

    expect(() =>
      ensureWebBuild(WEB_ROOT, DIST_ROOT, { exists, build, log: vi.fn() }),
    ).toThrow(/`--dev`/);
  });

  it("throws when the build succeeds but still produces no index.html", () => {
    // Exit 0 but the asset is still absent (e.g. a partial/aborted build).
    const exists = vi.fn().mockReturnValue(false);
    const build = vi.fn().mockReturnValue(0);

    expect(() =>
      ensureWebBuild(WEB_ROOT, DIST_ROOT, { exists, build, log: vi.fn() }),
    ).toThrow(/Could not build the web UI/);
    expect(build).toHaveBeenCalledTimes(1);
  });

  // Default seams (real `existsSync` / `spawnSync` / `console.log`) so the
  // production code path — not just the injected one — is exercised.
  describe("with default dependencies", () => {
    beforeEach(() => {
      existsSync.mockReset();
      spawnSync.mockReset();
    });

    it("is a no-op when index.html already exists (no spawn)", () => {
      existsSync.mockReturnValue(true);

      ensureWebBuild(WEB_ROOT, DIST_ROOT);

      expect(existsSync).toHaveBeenCalledWith(INDEX_HTML);
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it("spawns `npm run build:client` in the web root when missing", () => {
      existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
      spawnSync.mockReturnValue({ status: 0 });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        ensureWebBuild(WEB_ROOT, DIST_ROOT);
      } finally {
        logSpy.mockRestore();
      }

      expect(spawnSync).toHaveBeenCalledWith(
        "npm",
        ["run", "build:client"],
        expect.objectContaining({ cwd: WEB_ROOT, stdio: "inherit" }),
      );
    });

    it("throws when the spawned build exits non-zero", () => {
      existsSync.mockReturnValue(false);
      spawnSync.mockReturnValue({ status: 1 });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        expect(() => ensureWebBuild(WEB_ROOT, DIST_ROOT)).toThrow(
          /Could not build the web UI automatically/,
        );
      } finally {
        logSpy.mockRestore();
      }
    });

    it("surfaces the spawn error when the build can't start (ENOENT)", () => {
      existsSync.mockReturnValue(false);
      spawnSync.mockReturnValue({
        status: null,
        error: new Error("spawn npm ENOENT"),
      });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        expect(() => ensureWebBuild(WEB_ROOT, DIST_ROOT)).toThrow(
          /Could not build the web UI/,
        );
        expect(
          logSpy.mock.calls.some((c) =>
            String(c[0]).includes(
              "Web build failed to start: spawn npm ENOENT",
            ),
          ),
        ).toBe(true);
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});
