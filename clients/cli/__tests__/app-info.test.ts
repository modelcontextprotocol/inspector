import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";

/**
 * The default test server has no MCP App tools, so this exercises the
 * negative path: `--app-info` prints `{"hasApp":false,...}` on stdout and
 * exits 2. The positive path is unit-tested at the `extractAppInfo` level
 * (`clients/web/src/test/core/apps.test.ts`) and end-to-end via the
 * `mcpAppDemo` fixture.
 */
describe("--app-info", () => {
  it("rejects --app-info without --method tools/call", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/list",
      "--app-info",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--app-info requires --method tools/call");
  });

  it("emits {hasApp:false} as one JSON line and exits 2 for a non-App tool", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--app-info",
    ]);
    expect(result.exitCode).toBe(2);
    const line = result.stdout.trim().split("\n")[0];
    const info = JSON.parse(line) as { hasApp: boolean; toolName: string };
    expect(info).toEqual({ hasApp: false, toolName: "echo" });
    expect(result.stderr).toContain("has no MCP App UI resource");
  });

  it("emits {hasApp:false} and exits 2 when the tool is not found", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "no-such-tool",
      "--app-info",
    ]);
    expect(result.exitCode).toBe(2);
    const info = JSON.parse(result.stdout.trim().split("\n")[0]) as {
      hasApp: boolean;
    };
    expect(info.hasApp).toBe(false);
  });

  it("emits the resource-side csp/permissions and exits 0 for an App tool", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "mcp_app_demo",
      "--app-info",
    ]);
    expect(result.exitCode).toBe(0);
    const info = JSON.parse(result.stdout.trim().split("\n")[0]) as {
      hasApp: boolean;
      toolName: string;
      resourceUri: string;
      csp: unknown;
      permissions: unknown;
      prefersBorder: boolean;
      resourceMimeType: string;
    };
    expect(info.hasApp).toBe(true);
    expect(info.toolName).toBe("mcp_app_demo");
    expect(info.resourceUri).toBe("ui://demo/widget.html");
    expect(info.csp).toEqual({ connectDomains: [], resourceDomains: [] });
    expect(info.permissions).toEqual({ clipboard: false });
    expect(info.prefersBorder).toBe(true);
    expect(info.resourceMimeType).toBe("text/html");
  });

  it("appends an MCP App Info block after a normal tools/call on an App tool", async () => {
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
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--- MCP App Info ---");
    expect(result.stdout).toContain('"hasApp": true');
  });

  it("does not invoke the tool when --app-info is set", async () => {
    // get_sum requires numeric a/b args; without --app-info this would fail
    // with a tool error. With --app-info the tool is never called, so the
    // only error is the no-app exit-2.
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "get_sum",
      "--app-info",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.output).not.toContain("isError");
  });
});
