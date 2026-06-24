import { describe, it, expect } from "vitest";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliFailure,
  expectCliSuccess,
  expectOutputContains,
} from "./helpers/assertions.js";

describe("--method initialize", () => {
  it("connects and emits the cached InitializeResult fields", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "initialize",
    ]);
    expectCliSuccess(result);
    const json = JSON.parse(result.stdout) as {
      serverInfo: { name: string };
      protocolVersion: string;
      capabilities: Record<string, unknown>;
    };
    expect(json.serverInfo.name).toBeTruthy();
    expect(typeof json.protocolVersion).toBe("string");
    expect(typeof json.capabilities).toBe("object");
  });
});

describe("--format json", () => {
  it("wraps tools/list output in a single {result} envelope", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--cli",
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
      "--cli",
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
    expect(env.appInfo.hasApp).toBe(true);
    expect(env.appInfo.resourceUri).toBe("ui://demo/widget.html");
  });

  it("wraps --app-info output under {appInfo}", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--cli",
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
      "--cli",
      "--method",
      "tools/list",
      "--format",
      "yaml",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "--format must be 'text' or 'json'");
  });
});

describe("--tool-args-json", () => {
  it("passes the JSON object verbatim (string values stay strings)", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-args-json",
      JSON.stringify({ message: "012" }),
    ]);
    expectCliSuccess(result);
    // echo returns its args; with --tool-arg this would have coerced to the
    // number 12, but --tool-args-json preserves the string.
    expect(result.stdout).toContain("012");
  });

  it("rejects --tool-args-json combined with --tool-arg", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-arg",
      "x=1",
      "--tool-args-json",
      "{}",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "cannot be combined with --tool-arg");
  });

  it("rejects malformed JSON", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-args-json",
      "{not json}",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "not valid JSON");
  });

  it("rejects a non-object value", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-args-json",
      "[1,2]",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "must be a JSON object");
  });
});

describe("--connect-timeout", () => {
  it("accepts a numeric value and connects within it", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--connect-timeout",
      "5000",
      "--method",
      "tools/list",
    ]);
    expectCliSuccess(result);
  });

  it("rejects a negative value", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--connect-timeout",
      "-1",
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "non-negative number");
  });
});
