import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Guards the `__tests__/setup.ts` log-dir pin (#2723). Every TUI test file
 * inherits that setup file, so asserting here that the override is in place,
 * and points inside the temp directory, holds for the files that mount `App`
 * too. Without it `getTuiLogger()` falls back to `HOME/.mcp-inspector` and the
 * suite appends to the developer's real `auth.log`.
 */
describe("TUI test log directory", () => {
  it("is pinned inside the OS temp directory by the shared setup file", () => {
    const logDir = process.env.MCP_INSPECTOR_LOG_DIR;
    expect(logDir).toBeDefined();
    const relative = path.relative(os.tmpdir(), logDir ?? "");
    expect(relative).not.toBe("");
    expect(relative.startsWith("..")).toBe(false);
    expect(path.isAbsolute(relative)).toBe(false);
  });
});
