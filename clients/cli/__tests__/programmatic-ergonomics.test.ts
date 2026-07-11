import { describe, it, expect } from "vitest";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import { DEFAULT_CONNECT_TIMEOUT_MS, withConnectTimeout } from "../src/cli.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import {
  expectCliFailure,
  expectCliSuccess,
  expectOutputContains,
} from "./helpers/assertions.js";

describe("withConnectTimeout", () => {
  const baseSettings: InspectorServerSettings = {
    headers: [{ key: "X-Test", value: "1" }],
    metadata: [],
    env: [],
    connectionTimeout: 42,
    requestTimeout: 0,
    taskTtl: 60000,
    maxFetchRequests: 1000,
    autoRefreshOnListChanged: false,
    roots: [],
  };

  it("returns the settings unchanged when no timeout is given", () => {
    expect(withConnectTimeout(baseSettings, undefined)).toBe(baseSettings);
    expect(withConnectTimeout(undefined, undefined)).toBeUndefined();
  });

  it("overrides an existing settings' connectionTimeout", () => {
    const result = withConnectTimeout(baseSettings, 5000);
    expect(result).not.toBe(baseSettings);
    expect(result?.connectionTimeout).toBe(5000);
    // Other fields are preserved.
    expect(result?.headers).toEqual(baseSettings.headers);
  });

  it("builds a minimal settings object when none was provided", () => {
    const result = withConnectTimeout(undefined, DEFAULT_CONNECT_TIMEOUT_MS);
    expect(result?.connectionTimeout).toBe(DEFAULT_CONNECT_TIMEOUT_MS);
    expect(result?.headers).toEqual([]);
    expect(result?.requestTimeout).toBe(0);
  });
});

/**
 * Covers the programmatic-ergonomics flags from #1573: `--method initialize`,
 * `--tool-args-json`, `--connect-timeout`, and the MCP_CATALOG_PATH ad-hoc
 * gate. All connect to the bundled stdio test server.
 */
describe("--method initialize", () => {
  it("connects and emits the cached InitializeResult fields", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([command, ...args, "--method", "initialize"]);
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

describe("--tool-args-json", () => {
  it("passes the JSON object verbatim (string values stay strings)", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-args-json",
      JSON.stringify({ message: "012" }),
    ]);
    expectCliSuccess(result);
    // echo returns its message; with --tool-arg message=012 the value would
    // coerce to the number 12 (and fail the string schema), but
    // --tool-args-json preserves the string "012".
    expect(result.stdout).toContain("012");
  });

  it("rejects --tool-args-json combined with --tool-arg", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
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

describe("MCP_CATALOG_PATH with an ad-hoc target", () => {
  it("does not conflict with an ad-hoc target (env catalog is ignored)", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([command, ...args, "--method", "tools/list"], {
      env: { MCP_CATALOG_PATH: "/no/such/catalog.json" },
    });
    expectCliSuccess(result);
  });
});

describe("--connect-timeout", () => {
  it("accepts a numeric value and connects within it", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--connect-timeout",
      "5000",
      "--method",
      "tools/list",
    ]);
    expectCliSuccess(result);
  });

  it("accepts 0 (no timeout) and connects", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--connect-timeout",
      "0",
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
      "--connect-timeout",
      "-1",
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "non-negative number");
  });

  it("rejects a non-numeric value", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--connect-timeout",
      "soon",
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "non-negative number");
  });
});
