import { describe, it, expect } from "vitest";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliFailure,
  expectCliSuccess,
  expectOutputContains,
} from "./helpers/assertions.js";

/**
 * Covers the `--format json` envelope from #1574: a single JSON object on
 * stdout (`result`, plus `appInfo` as a sibling key for App tools), no banner.
 */
describe("--format json", () => {
  it("wraps tools/list output in a single {result} envelope", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/list",
      "--format",
      "json",
    ]);
    expectCliSuccess(result);
    expect(result.stdout.trim().split("\n").length).toBe(1);
    const env = JSON.parse(result.stdout) as { result: { tools: unknown[] } };
    expect(Array.isArray(env.result.tools)).toBe(true);
  });

  it("emits {result, appInfo} as one JSON object for an App tool (no banner)", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "mcp_app_demo",
      "--tool-arg",
      "title=hello",
      "--format",
      "json",
    ]);
    expectCliSuccess(result);
    expect(result.stdout).not.toContain("--- MCP App Info ---");
    const env = JSON.parse(result.stdout) as {
      result: unknown;
      appInfo: { hasApp: boolean; resourceUri: string };
    };
    expect(env.result).toBeTruthy();
    expect(env.appInfo.hasApp).toBe(true);
    expect(env.appInfo.resourceUri).toBe("ui://demo/widget.html");
  });

  it("omits appInfo for a non-App tool", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-arg",
      "message=hi",
      "--format",
      "json",
    ]);
    expectCliSuccess(result);
    const env = JSON.parse(result.stdout) as {
      result: unknown;
      appInfo?: unknown;
    };
    expect(env.result).toBeTruthy();
    expect(env.appInfo).toBeUndefined();
  });

  it("wraps --app-info output under {appInfo} and exits 2 for a non-App tool", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--app-info",
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(2);
    const env = JSON.parse(result.stdout.trim()) as {
      appInfo: { hasApp: boolean };
    };
    expect(env.appInfo.hasApp).toBe(false);
  });

  it("rejects an unknown --format value", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/list",
      "--format",
      "yaml",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "--format must be 'text' or 'json'");
  });
});
