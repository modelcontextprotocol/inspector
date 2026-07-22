import { describe, it, expect, afterEach, vi } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import type { ExcludedTool } from "@inspector/core/mcp/types.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createEchoTool,
  createGetWeatherTool,
  createInvalidHeaderTool,
} from "@modelcontextprotocol/inspector-test-server";
import type { ServerConfig } from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of the SEP-2243 excluded-tools surface (#1632). A modern
 * Streamable HTTP client MUST drop a tool whose `x-mcp-header` annotation
 * violates the spec; the SDK does so silently. `refreshExcludedTools()` re-lists
 * the RAW (unfiltered) `tools/list` and reports the dropped tools with the
 * constraint they broke, so the Tools tab can show *why* a tool vanished.
 */
describe("excluded tools (SEP-2243 x-mcp-header)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
      client = null;
    }
    if (server) {
      try {
        await server.stop();
      } catch {
        // ignore
      }
      server = null;
    }
  });

  async function start(
    modern: ServerConfig["modern"] | undefined,
    maxPageSize?: number,
  ): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("excluded-tools-test", "1.0.0"),
      // A valid tool, a valid-header tool, and an invalid-header tool.
      tools: [
        createEchoTool(),
        createGetWeatherTool(),
        createInvalidHeaderTool(),
      ],
      ...(modern ? { modern } : {}),
      ...(maxPageSize ? { maxPageSize: { tools: maxPageSize } } : {}),
    });
    await started.start();
    server = started;
    return started;
  }

  async function connect(
    url: string,
    era: "legacy" | "modern",
  ): Promise<InspectorClient> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation(era),
      },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  it("excludes the invalid-header tool from the managed list on a modern connection", async () => {
    const started = await start({});
    const connected = await connect(started.url, "modern");

    const { tools } = await connected.listAllTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("echo");
    expect(names).toContain("get_weather");
    // The SDK drops the invalid-header tool from the aggregated list.
    expect(names).not.toContain("invalid_header_tool");
  });

  it("surfaces the excluded tool with its reason after listAllTools (modern)", async () => {
    const started = await start({});
    const connected = await connect(started.url, "modern");

    const events: ExcludedTool[][] = [];
    connected.addEventListener("excludedToolsChange", (e) => {
      events.push(e.detail);
    });

    // listAllTools recomputes excluded tools as a side effect.
    await connected.listAllTools();

    const excluded = connected.getExcludedTools();
    expect(excluded.map((x) => x.tool.name)).toEqual(["invalid_header_tool"]);
    expect(excluded[0]?.reason).toContain("RFC 9110 token");
    // The change event fired with the same set.
    expect(events.at(-1)?.map((x) => x.tool.name)).toEqual([
      "invalid_header_tool",
    ]);
  });

  it("refreshExcludedTools returns the excluded set directly (modern)", async () => {
    const started = await start({});
    const connected = await connect(started.url, "modern");

    const excluded = await connected.refreshExcludedTools();
    expect(excluded.map((x) => x.tool.name)).toEqual(["invalid_header_tool"]);
  });

  it("reports no excluded tools on a legacy connection (no exclusion there)", async () => {
    const started = await start(undefined);
    const connected = await connect(started.url, "legacy");

    // Legacy servers don't exclude — the invalid-header tool stays in the list.
    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toContain("invalid_header_tool");
    expect(connected.getExcludedTools()).toEqual([]);
    expect(await connected.refreshExcludedTools()).toEqual([]);
  });

  it("clears excluded tools on disconnect", async () => {
    const started = await start({});
    const connected = await connect(started.url, "modern");
    await connected.listAllTools();
    expect(connected.getExcludedTools().length).toBe(1);

    await connected.disconnect();
    client = null;
    expect(connected.getExcludedTools()).toEqual([]);
  });

  it("walks every raw page to find the excluded tool (pagination)", async () => {
    // Page size 1 → the raw `tools/list` walk spans three pages; the invalid
    // tool is on the last one, so this exercises the cursor loop.
    const started = await start({}, 1);
    const connected = await connect(started.url, "modern");

    const excluded = await connected.refreshExcludedTools();
    expect(excluded.map((x) => x.tool.name)).toEqual(["invalid_header_tool"]);
  });

  it("listAllTools still returns tools if the excluded recompute throws", async () => {
    const started = await start({});
    const connected = await connect(started.url, "modern");
    // The excluded-tools recompute is best-effort: a failure must not fail the
    // tools list itself.
    vi.spyOn(connected, "refreshExcludedTools").mockRejectedValueOnce(
      new Error("boom"),
    );
    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toContain("echo");
  });

  it("is a no-op returning [] before connect (not modern)", async () => {
    const fresh = new InspectorClient(
      { type: "streamable-http", url: "http://localhost:1/never" },
      { environment: { transport: createTransportNode } },
    );
    // No round trip: the gate is false (era not modern), so it returns [].
    expect(await fresh.refreshExcludedTools()).toEqual([]);
  });
});
