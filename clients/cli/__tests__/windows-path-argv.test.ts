import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { runCli } from "../src/cli.js";

/**
 * A Windows-style path forwarded as a stdio server command or argument must
 * reach the transport byte-for-byte (#2416). Nothing in the CLI's argv
 * handling interprets a backslash today — the positional/option split keys
 * only on a leading `-` and on `--`, and commander never sees the target —
 * but nothing asserted it either, so a future "normalize the path" or
 * shell-style unescape would have passed every existing test.
 *
 * The seam is the `InspectorClient` constructor: it is the first thing that
 * receives the resolved `MCPServerConfig`, so recording its argument and then
 * throwing a sentinel observes the full `runCli` path (split, commander,
 * `resolveServerConfigs`) without spawning a process. A real spawn would add
 * nothing here — this suite runs on POSIX, where these strings are not paths
 * at all, and what is under test is only that they arrive unaltered.
 */
const { seen, STOP } = vi.hoisted(() => ({
  seen: { configs: [] as unknown[] },
  STOP: "stop-before-connect",
}));

vi.mock("@inspector/core/mcp/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@inspector/core/mcp/index.js")>();
  class RecordingInspectorClient {
    constructor(config: unknown) {
      seen.configs.push(config);
      throw new Error(STOP);
    }
  }
  return { ...actual, InspectorClient: RecordingInspectorClient };
});

// String.raw keeps every backslash literal, so each fixture is exactly what a
// Windows shell hands the process in argv.
const COMMAND = String.raw`C:\Program Files\nodejs\node.exe`;
const SCRIPT = String.raw`C:\Users\dev\mcp\build\index.js`;
// A UNC path: a leading double backslash that a naive collapse would halve.
const UNC = String.raw`\\fileserver\share\mcp\config.json`;
// `\n` and `\t` sequences a shell-style unescape would turn into control
// characters, plus a trailing separator that a trim or normalize would drop.
// (A raw template cannot end in a backslash, hence the concatenation.)
const ESCAPE_LOOKALIKE = String.raw`C:\temp\new\table` + "\\";
const CWD = String.raw`D:\work\server`;

async function resolvedConfig(argv: string[]): Promise<MCPServerConfig> {
  await expect(runCli(["node", "inspector-cli", ...argv])).rejects.toThrow(
    STOP,
  );
  expect(seen.configs).toHaveLength(1);
  return seen.configs[0] as MCPServerConfig;
}

describe("Windows paths in forwarded stdio argv (#2416)", () => {
  beforeEach(() => {
    seen.configs.length = 0;
  });

  it("keeps the fixtures' backslashes intact before they are used", () => {
    // Guards the fixtures themselves: if String.raw were dropped, the
    // round-trip assertions below would compare two equally mangled strings.
    expect(UNC.startsWith("\\\\")).toBe(true);
    expect(ESCAPE_LOOKALIKE).not.toMatch(/[\n\t]/);
    expect(ESCAPE_LOOKALIKE.endsWith("\\")).toBe(true);
  });

  it("forwards a backslash command, args and --cwd unchanged", async () => {
    const config = await resolvedConfig([
      COMMAND,
      SCRIPT,
      UNC,
      ESCAPE_LOOKALIKE,
      "--cwd",
      CWD,
      "--method",
      "tools/list",
    ]);
    expect(config).toEqual({
      type: "stdio",
      command: COMMAND,
      args: [SCRIPT, UNC, ESCAPE_LOOKALIKE],
      cwd: CWD,
    });
  });

  it("forwards a dash-leading backslash arg unchanged when the target ends at --", async () => {
    // Without `--` a leading `-` ends the target, so a server flag carrying a
    // Windows path is only forwardable in this form.
    const flagWithPath = String.raw`--root=C:\data\mcp`;
    const config = await resolvedConfig([
      COMMAND,
      SCRIPT,
      flagWithPath,
      "--",
      "--method",
      "tools/list",
    ]);
    expect(config).toEqual({
      type: "stdio",
      command: COMMAND,
      args: [SCRIPT, flagWithPath],
    });
  });
});
