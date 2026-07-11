import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";

/**
 * The default stdio test server advertises exactly one MCP App tool
 * (`mcp_app_demo` + its `mcp_app_demo_widget` UI resource). These cover both
 * the positive probe (csp/permissions/exit-0) and the negative path
 * (`{hasApp:false}` + exit 2), plus the exit-5 tool-not-found distinction and
 * the NDJSON `tools/list --app-info` shape. The `extractAppInfo` unit is
 * covered in the web core suite; here we exercise the CLI wiring end-to-end.
 */
describe("--app-info", () => {
  it("rejects --app-info on a method other than tools/call or tools/list", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "resources/list",
      "--app-info",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "--app-info requires --method tools/call (with --tool-name) or --method tools/list",
    );
  });

  it("emits NDJSON (one app-info line per tool) on --method tools/list --app-info", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/list",
      "--app-info",
    ]);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    const infos = lines.map(
      (l) => JSON.parse(l) as { hasApp: boolean; toolName: string },
    );
    // Every line is a valid app-info object with a toolName.
    expect(infos.every((i) => typeof i.toolName === "string")).toBe(true);
    // The fixture's `mcp_app_demo` is the (only) App tool.
    const demo = infos.find((i) => i.toolName === "mcp_app_demo");
    expect(demo?.hasApp).toBe(true);
    expect(infos.filter((i) => i.hasApp).length).toBe(1);
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

  it("exits 5 (TOOL_ERROR, code:tool_not_found) when the tool is not found — distinct from the no-app exit-2", async () => {
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
    expect(result.exitCode).toBe(5);
    expect(result.stdout).toBe("");
    const envelope = JSON.parse(result.stderr.trim()) as {
      error: { code: string };
    };
    expect(envelope.error.code).toBe("tool_not_found");
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

  it("does not collect app-info on a plain text-mode tools/call", async () => {
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
    expect(result.stdout).not.toContain("--- MCP App Info ---");
    expect(result.stdout).not.toContain("hasApp");
    // stdout is a single JSON value (the tool result) so `| jq` works.
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("does not invoke the tool when --app-info is set", async () => {
    // get_sum requires numeric a/b args; without --app-info this would fail
    // with a tool error. With --app-info the tool is never called, so the
    // only outcome is the no-app exit-2.
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
