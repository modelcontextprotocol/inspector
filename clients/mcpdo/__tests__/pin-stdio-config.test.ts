import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import type { StdioServerConfig } from "@inspector/core/mcp/types.js";
import { pinStdioConfigToCaller } from "../src/connection/mcp.js";

type StdioConfig = StdioServerConfig;

describe("pinStdioConfigToCaller", () => {
  it("returns non-stdio configs unchanged", () => {
    const config = {
      type: "streamable-http",
      url: "https://example.com/mcp",
    } as const;
    expect(pinStdioConfigToCaller(config)).toBe(config);
  });

  it("pins a missing cwd to the caller's cwd and resolves a relative one", () => {
    const base: StdioConfig = { type: "stdio", command: process.execPath };
    expect(pinStdioConfigToCaller({ ...base }).cwd).toBe(process.cwd());
    expect(pinStdioConfigToCaller({ ...base, cwd: "sub/dir" }).cwd).toBe(
      path.resolve("sub/dir"),
    );
  });

  it("treats a config without an explicit type as stdio", () => {
    const pinned = pinStdioConfigToCaller<StdioConfig>({
      command: process.execPath,
    });
    expect(pinned.cwd).toBe(process.cwd());
  });

  it("snapshots the caller's default environment under the configured env", () => {
    const pinned = pinStdioConfigToCaller<StdioConfig>({
      type: "stdio",
      command: process.execPath,
      env: { PATH: "/configured/bin", EXTRA: "1" },
    });
    const defaults: Record<string, string> = getDefaultEnvironment();
    // Configured values win over the snapshot...
    expect(pinned.env).toMatchObject({ PATH: "/configured/bin", EXTRA: "1" });
    // ...and every other default-inherited var is filled from THIS process,
    // so the daemon's SDK transport never falls back to its own stale env.
    for (const [key, value] of Object.entries(defaults)) {
      if (key === "PATH") continue;
      expect(pinned.env?.[key]).toBe(value);
    }
  });

  it("resolves a bare command against the caller's PATH", () => {
    const pinned = pinStdioConfigToCaller<StdioConfig>({
      type: "stdio",
      command: "node",
    });
    expect(path.isAbsolute(pinned.command)).toBe(true);
  });
});
