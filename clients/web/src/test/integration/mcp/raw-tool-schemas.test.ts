import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { countFindings, lintTools } from "@inspector/core/json/schemaLint.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createEchoTool,
  createGetWeatherTool,
  createGetTempTool,
  loadConfig,
  resolveConfig,
} from "@modelcontextprotocol/inspector-test-server";
import type { ServerConfig } from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of `ServerConfig.rawToolSchemas` (#1005) — the only way this
 * repo can advertise a tool schema containing a bare `true`, an array-form
 * `type`, or a remote `$ref`, since every preset builds its schema from Zod
 * and Zod cannot emit any of them.
 *
 * The lint itself is unit-tested against hand-built `Tool` objects, which
 * bypasses this path entirely: handler installation, config resolution, and
 * the interaction with pagination and duplication could all regress while
 * those stayed green. This file drives the real server over a real transport
 * and asserts on what actually reaches the wire.
 */
describe("rawToolSchemas override (#1005)", () => {
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
      serverInfo: createTestServerInfo("raw-tool-schemas-test", "1.0.0"),
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

  it("advertises the raw document, and the lint finds it end to end", async () => {
    const started = await start({
      rawToolSchemas: {
        echo: {
          inputSchema: {
            type: "object",
            properties: {
              message: { type: "string" },
              show_ids: { type: ["null", "boolean"] },
            },
          },
          outputSchema: {
            type: "object",
            properties: { data: true },
          },
        },
      },
    });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    const echo = tools.find((t) => t.name === "echo");

    // The bare `true` survives the wire — a Zod-built schema could not
    // produce it, so its presence here proves the override is what is served.
    expect(echo?.outputSchema).toEqual({
      type: "object",
      properties: { data: true },
    });
    expect(
      (echo?.inputSchema as { properties?: Record<string, unknown> }).properties
        ?.show_ids,
    ).toEqual({ type: ["null", "boolean"] });

    const results = lintTools(tools);
    expect(results.map((r) => r.toolName)).toEqual(["echo"]);
    expect(results[0]?.findings.map((f) => f.rule).sort()).toEqual([
      "boolean-schema",
      "type-union",
    ]);
  });

  it("drops a tool whose inputSchema root is not an object, before any client sees it", async () => {
    // This is why `schemaLint` has no "inputSchema must be an object" rule.
    // The SDK types `inputSchema` with `type: literal("object")`, so such a
    // tool fails `ListToolsResultSchema` and `salvageListItems` removes it —
    // no client can pass it to the lint, and a rule for it could never fire.
    // If this ever starts returning the tool, that rule becomes worth adding
    // back and this test is the signal.
    const started = await start({
      rawToolSchemas: {
        echo: { inputSchema: { type: "array", items: { type: "string" } } },
      },
    });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toEqual(["get_weather"]);
  });

  it("leaves an unnamed tool's real schema alone", async () => {
    const started = await start({
      rawToolSchemas: { echo: { outputSchema: { type: "object" } } },
    });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    const weather = tools.find((t) => t.name === "get_weather");
    // get_weather keeps the Zod-derived schema, which is portable.
    expect(weather?.inputSchema).toMatchObject({ type: "object" });
    expect(lintTools(tools)).toEqual([]);
  });

  it("replaces only the schema named, leaving the sibling untouched", async () => {
    const started = await start({
      rawToolSchemas: {
        echo: { outputSchema: { type: "object", properties: { data: true } } },
      },
    });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    const echo = tools.find((t) => t.name === "echo");
    // Only `outputSchema` was overridden, so the Zod-built input survives.
    expect(echo?.inputSchema).toMatchObject({ type: "object" });
    expect(
      (echo?.inputSchema as { properties?: Record<string, unknown> })
        .properties,
    ).toHaveProperty("message");
  });

  it("ignores a name that is not registered", async () => {
    const started = await start({
      rawToolSchemas: { not_a_tool: { inputSchema: true } },
    });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toEqual(["echo", "get_weather"]);
    expect(lintTools(tools)).toEqual([]);
  });

  it("still calls the tool when only the input schema was overridden", async () => {
    const started = await start({
      rawToolSchemas: {
        echo: {
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" }, opts: {} },
          },
        },
      },
    });
    const connected = await connect(started.url);

    // The handler and its real Zod validation are untouched by the override —
    // the fixture would be misleading if the tool it flags could not be run.
    const { tools } = await connected.listAllTools();
    const echo = tools.find((t) => t.name === "echo")!;
    const result = await connected.callTool(echo, { message: "hi" });
    expect(JSON.stringify(result)).toContain("hi");
  });

  it("makes the call fail when an outputSchema is put on a tool with no structured content", async () => {
    // Pinning the sharp edge documented on `ServerConfig.rawToolSchemas`: a
    // conforming client validates results against the advertised output
    // schema, so an override on a preset that returns none breaks every call.
    // This is why the showcase config puts its bare-`true` outputSchema on
    // `get_temp` (which does return structured content) rather than on `echo`.
    const started = await start({
      rawToolSchemas: {
        echo: { outputSchema: { type: "object", properties: { data: true } } },
      },
    });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    const echo = tools.find((t) => t.name === "echo")!;
    await expect(connected.callTool(echo, { message: "hi" })).rejects.toThrow(
      /returned no structured content/,
    );
  });

  it("serves the shape the showcase config declares", async () => {
    // Covers the JSON → ConfigFile → ServerConfig plumbing, not just the
    // in-process option: a config file is how the manual repro and the
    // screenshots in #1005 are produced, and `resolveConfig` forwarding
    // `rawToolSchemas` is a line nothing else exercises. Without this, the
    // shipped fixture could silently lose its overrides while every other
    // test in this file stayed green.
    const configPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../../test-servers/configs/unportable-schemas-http.json",
    );
    const resolved = resolveConfig(loadConfig(configPath));
    expect(Object.keys(resolved.rawToolSchemas ?? {}).sort()).toEqual([
      "add",
      "echo",
      "get_temp",
    ]);

    // Let the harness pick the port instead of the config's fixed one, so this
    // test can't collide with a manually-running showcase server.
    const started = await start({
      tools: resolved.tools,
      rawToolSchemas: resolved.rawToolSchemas,
    });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    // The exact verdict the README and the PR screenshots claim: one error on
    // get_temp, warnings on echo and add, get_weather clean.
    const results = lintTools(tools);
    expect(
      results.map((r) => ({
        tool: r.toolName,
        rules: r.findings.map((f) => f.rule).sort(),
      })),
    ).toEqual([
      { tool: "get_temp", rules: ["boolean-schema"] },
      { tool: "echo", rules: ["type-union", "untyped-schema"] },
      { tool: "add", rules: ["remote-ref"] },
    ]);
    expect(countFindings(results)).toEqual({ errors: 1, warnings: 3 });

    // Every flagged tool in the fixture must stay runnable — the README and
    // the PR say so, and a showcase that errors on its own obvious button is
    // worse than no showcase. Each is called with the arguments its ADVERTISED
    // schema renders, including the properties the override added, since that
    // is what a user clicking through the form would send.
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    await expect(
      connected.callTool(byName("get_temp"), { city: "Oslo", units: "C" }),
    ).resolves.toBeDefined();
    await expect(
      connected.callTool(byName("echo"), {
        message: "hi",
        show_ids: null,
        opts: {},
      }),
    ).resolves.toBeDefined();
    await expect(
      connected.callTool(byName("add"), { a: 1, b: 2 }),
    ).resolves.toBeDefined();
  });

  it("keeps a structured-content tool callable under an outputSchema override", async () => {
    // The shape the showcase config actually ships: the bare `true` rides a
    // tool that returns structured content, and the override stays permissive
    // enough (no `required`) that the real payload still validates — so the
    // flagged tool is still runnable from the Tools tab.
    const started = await start({
      tools: [createGetTempTool(), createEchoTool()],
      rawToolSchemas: {
        get_temp: {
          outputSchema: {
            type: "object",
            properties: { data: true, city: { type: "string" } },
          },
        },
      },
    });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    const getTemp = tools.find((t) => t.name === "get_temp")!;
    expect(lintTools(tools).map((r) => r.toolName)).toEqual(["get_temp"]);

    const result = await connected.callTool(getTemp, {
      city: "Oslo",
      units: "C",
    });
    expect(JSON.stringify(result)).toContain("Oslo");
  });

  it("applies before duplication, so both copies carry the raw schema", async () => {
    const started = await start({
      duplicateToolNames: ["echo"],
      rawToolSchemas: {
        echo: { outputSchema: { type: "object", properties: { data: true } } },
      },
    });
    const connected = await connect(started.url);

    const { tools } = await connected.listAllTools();
    const echoes = tools.filter((t) => t.name === "echo");
    expect(echoes).toHaveLength(2);
    for (const e of echoes) {
      expect(e.outputSchema).toEqual({
        type: "object",
        properties: { data: true },
      });
    }
  });
});
