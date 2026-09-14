import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createEchoTool,
  createGetWeatherTool,
  loadConfig,
  resolveConfig,
} from "@modelcontextprotocol/inspector-test-server";
import type { ServerConfig } from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of `ServerConfig.duplicateToolNames` (#1957) — the only way this
 * repo can serve a `tools/list` that repeats a name, since every preset
 * registers a unique one and the SDK's `registerTool` rejects a repeat.
 *
 * The Tools sidebar keyed its rows by `tool.name`, so duplicates collided and
 * filtering left an unrelated row mounted. The component-level regressions live
 * in `ToolControls.test.tsx`; this file covers the server option those
 * screenshots and the manual repro depend on — the wire shape, the ordering
 * that makes the defect observable, and the config plumbing.
 */
describe("duplicate tool names in tools/list (#1957)", () => {
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

  async function start(config: Partial<ServerConfig>): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("duplicate-tool-names-test", "1.0.0"),
      tools: [createEchoTool(), createGetWeatherTool()],
      ...config,
    });
    await started.start();
    server = started;
    return started;
  }

  async function connect(url: string): Promise<InspectorClient> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      { environment: { transport: createTransportNode } },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  it("emits the named tools twice, repeats appended, second copy titled", async () => {
    const started = await start({ duplicateToolNames: ["echo"] });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();

    // Repeats go at the END, not beside their twin. That ordering is
    // load-bearing: React matches a leading run of same-key children first, so
    // an adjacent duplicate lines up and the defect hides. Asserting the exact
    // sequence keeps a future "tidy-up" from silently defanging the fixture.
    expect(tools.map((t) => t.name)).toEqual(["echo", "get_weather", "echo"]);
    // These presets carry no title, so the marker falls back to the name —
    // which is what keeps the two rows distinguishable on screen.
    expect(tools.at(-1)?.title).toBe("echo (duplicate)");
    // Only the appended copy is marked; the originals are passed through as-is.
    expect(tools[0]?.title).toBeUndefined();
    expect(tools[1]?.title).toBeUndefined();
  });

  it("leaves the list alone when no names are given", async () => {
    const started = await start({ duplicateToolNames: [] });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toEqual(["echo", "get_weather"]);
  });

  it("ignores a name that is not registered", async () => {
    const started = await start({ duplicateToolNames: ["not_a_tool"] });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toEqual(["echo", "get_weather"]);
  });

  it("duplicates before paginating, so a pair straddles a page boundary", async () => {
    const started = await start({
      duplicateToolNames: ["echo", "get_weather"],
      maxPageSize: { tools: 2 },
    });
    const connected = await connect(started.url);

    // Four tools at a page size of two: the duplicated copies land on page 2,
    // which only holds if duplication runs before the slice.
    const firstPage = await connected.listTools();
    expect(firstPage.tools.map((t) => t.name)).toEqual(["echo", "get_weather"]);
    expect(firstPage.nextCursor).toBeDefined();

    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toEqual([
      "echo",
      "get_weather",
      "echo",
      "get_weather",
    ]);
    expect(tools.slice(2).map((t) => t.title)).toEqual([
      "echo (duplicate)",
      "get_weather (duplicate)",
    ]);
  });

  it("serves the shape the showcase config declares", async () => {
    // Covers the JSON → ConfigFile → ServerConfig plumbing, not just the
    // in-process option: a config file is how the manual repro and the
    // screenshots in #1957 are produced.
    const configPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../../test-servers/configs/duplicate-tool-names-http.json",
    );
    const resolved = resolveConfig(loadConfig(configPath));
    expect(resolved.duplicateToolNames).toEqual(["get_weather", "echo"]);

    // Let the harness pick the port instead of the config's fixed one, so this
    // test can't collide with a manually-running showcase server.
    const started = await start({
      tools: resolved.tools,
      duplicateToolNames: resolved.duplicateToolNames,
    });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toEqual([
      "get_weather",
      "get_temp",
      "echo",
      "add",
      "get_weather",
      "echo",
    ]);

    // The whole point of the fixture: filtering by "get" must be able to drop
    // every non-matching row, duplicates included.
    const matching = tools.filter(
      (t) =>
        t.name.includes("get") ||
        (t.title?.toLowerCase().includes("get") ?? false),
    );
    expect(matching).toHaveLength(3);
  });
});
