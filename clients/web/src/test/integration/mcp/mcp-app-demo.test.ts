import { describe, it, expect, afterEach } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createMcpAppDemoTool,
  createMcpAppDemoResource,
} from "@modelcontextprotocol/inspector-test-server";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const MCP_APP_DEMO_URI = "ui://demo/widget.html";

/**
 * Exercises the `mcp_app_demo` preset added in #1557 end-to-end: it confirms the
 * `_meta` plumbing through the composable test server's tool/resource
 * definitions surfaces on `tools/list` and `resources/read`, which is what the
 * downstream Apps-host and CLI `--app-info` tests rely on.
 */
describe("mcp_app_demo preset", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      client = null;
    }
    if (server) {
      try {
        await server.stop();
      } catch {
        // Ignore server stop errors
      }
      server = null;
    }
  });

  async function connect(): Promise<InspectorClient> {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo("mcp-app-demo-test", "1.0.0"),
      tools: [createMcpAppDemoTool()],
      resources: [createMcpAppDemoResource()],
    });
    await server.start();
    const connected = new InspectorClient(
      { type: "streamable-http", url: server.url },
      { environment: { transport: createTransportNode } },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  it("exposes tool-level _meta.ui.resourceUri on tools/list", async () => {
    const connected = await connect();
    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "mcp_app_demo");
    expect(tool).toBeDefined();
    const meta = (tool as Tool)._meta as
      | { ui?: { resourceUri?: string; visibility?: string[] } }
      | undefined;
    expect(meta?.ui?.resourceUri).toBe(MCP_APP_DEMO_URI);
    expect(meta?.ui?.visibility).toEqual(["model", "app"]);
  });

  it("exposes resource-level _meta.ui on resources/read", async () => {
    const connected = await connect();
    const invocation = await connected.readResource(MCP_APP_DEMO_URI);
    const contents = invocation.result.contents;
    expect(contents).toHaveLength(1);
    const entry = contents[0];
    expect(entry.mimeType).toBe("text/html");
    expect("text" in entry ? String(entry.text) : "").toContain("mcp-app-demo");
    const meta = entry._meta as
      | {
          ui?: {
            csp?: { connectDomains?: string[]; resourceDomains?: string[] };
            permissions?: { clipboard?: boolean };
            prefersBorder?: boolean;
          };
        }
      | undefined;
    expect(meta?.ui?.csp).toEqual({
      connectDomains: [],
      resourceDomains: [],
    });
    expect(meta?.ui?.permissions).toEqual({ clipboard: false });
    expect(meta?.ui?.prefersBorder).toBe(true);
  });

  it("echoes the input title from the tool handler", async () => {
    const connected = await connect();
    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "mcp_app_demo")!;
    const result = await connected.callTool(tool, { title: "Widget A" });
    expect(result.success).toBe(true);
    const content = result.result!.content;
    const text =
      content[0] && "text" in content[0] ? String(content[0].text) : "";
    expect(text).toBe('mcp_app_demo rendered with title="Widget A"');
  });
});
