import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Wait for pino's async file destination to actually create the log file.
 * `pino.destination({ mkdir: true })` opens the stream asynchronously, so the
 * file (and any parent dir) appears a tick later. Awaiting this before cleanup
 * also guarantees the background mkdir/open has finished, so `afterEach`'s
 * rmSync can't race it into an ENOENT.
 */
async function waitForFile(filePath: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * `getTuiLogger` lazily builds a pino singleton that writes to a file. Each
 * test gets a fresh module (vi.resetModules) and a temp log dir so the two
 * directory-resolution branches can both be exercised without touching the
 * real ~/.mcp-inspector.
 */
describe("getTuiLogger", () => {
  const envKeys = ["MCP_INSPECTOR_LOG_DIR", "HOME", "USERPROFILE", "LOG_LEVEL"];
  let saved: Record<string, string | undefined>;
  let tempDir: string;

  beforeEach(() => {
    saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    tempDir = mkdtempSync(join(tmpdir(), "tui-logger-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes to MCP_INSPECTOR_LOG_DIR and returns a cached singleton", async () => {
    process.env.MCP_INSPECTOR_LOG_DIR = tempDir;
    const { getTuiLogger } = await import("../src/logger.js");

    const first = getTuiLogger();
    const second = getTuiLogger();

    expect(first).toBe(second);
    await waitForFile(join(tempDir, "auth.log"));
  });

  it("falls back to HOME/.mcp-inspector when MCP_INSPECTOR_LOG_DIR is unset", async () => {
    delete process.env.MCP_INSPECTOR_LOG_DIR;
    process.env.HOME = tempDir;
    const { getTuiLogger } = await import("../src/logger.js");

    const logger = getTuiLogger();

    expect(logger).toBeDefined();
    await waitForFile(join(tempDir, ".mcp-inspector", "auth.log"));
  });
});
