import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { normalizeNullableUnion } from "@inspector/core/json/nullableUnion.js";
import { toFormSchema } from "../../../utils/jsonUtils";
import type { InspectorFormSchema } from "../../../utils/jsonUtils";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  loadConfig,
  resolveConfig,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of `test-servers/configs/nullable-fields-http.json` — the
 * documented manual reproduction for #1928.
 *
 * The unit tests on both form builders construct the `anyOf` shape by hand,
 * which verifies the *renderers* but assumes the premise: that Zod's
 * `.nullish()` actually emits `anyOf: [<branch>, { type: "null" }]` with the
 * `enum` on the branch. That premise is the whole reason the fix exists, and
 * nothing else pins it — a Zod change in how it compiles a nullish enum would
 * leave every unit test green while the showcase server quietly stopped
 * reproducing the bug.
 *
 * So the server is built by **resolving the checked-in config**, not by calling
 * the fixture factory directly. That is deliberate and is the difference
 * between covering the wiring and merely asserting the factory: going through
 * `loadConfig` → `resolveConfig` means a misspelt preset name in
 * `preset-registry.ts`, or a config that names a preset that no longer exists,
 * fails here rather than only when someone runs the repro by hand.
 */
describe("nullable argument schemas over the wire (#1928)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  const configPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../../test-servers/configs/nullable-fields-http.json",
  );

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

  /**
   * Boot the showcase config. The harness picks the port rather than using the
   * config's fixed one, so this cannot collide with a showcase server someone
   * is running by hand.
   */
  async function connectToShowcase(): Promise<InspectorClient> {
    const resolved = resolveConfig(loadConfig(configPath));
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("nullable-fields-test", "1.0.0"),
      tools: resolved.tools,
    });
    await started.start();
    server = started;

    const connected = new InspectorClient(
      { type: "streamable-http", url: started.url },
      { environment: { transport: createTransportNode } },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  async function recordShipmentSchema(): Promise<InspectorFormSchema> {
    const connected = await connectToShowcase();
    const { tools } = await connected.listAllTools();
    const tool = tools.find((entry) => entry.name === "record_shipment");
    expect(tool).toBeDefined();
    const schema = toFormSchema(tool?.inputSchema);
    expect(schema).not.toBeNull();
    return schema as InspectorFormSchema;
  }

  it("resolves the preset the config names", () => {
    // Fails on a misspelt registry case or a config naming a dead preset —
    // neither of which the hand-built unit schemas can see.
    const resolved = resolveConfig(loadConfig(configPath));
    expect(resolved.tools?.map((tool) => tool.name)).toEqual([
      "record_shipment",
      "get_temp",
    ]);
  });

  it("emits an anyOf-with-null for every nullish argument, enum on the branch", async () => {
    const schema = await recordShipmentSchema();
    const properties = schema.properties ?? {};
    expect(Object.keys(properties).sort()).toEqual([
      "direction",
      "express",
      "quantity",
      "reference",
    ]);

    // The premise of the whole fix: no top-level `type`, and the `enum` sits on
    // the surviving branch rather than beside it.
    const direction = properties.direction;
    expect(direction?.type).toBeUndefined();
    expect(direction?.enum).toBeUndefined();
    expect(direction?.anyOf).toHaveLength(2);
    expect(direction?.anyOf).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "null" })]),
    );
  });

  it("collapses each argument to the type its widget dispatches on", async () => {
    const schema = await recordShipmentSchema();
    const collapsed = Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([name, propertySchema]) => [
        name,
        normalizeNullableUnion(propertySchema),
      ]),
    );

    expect(collapsed.direction?.type).toBe("string");
    expect(collapsed.direction?.enum).toEqual(["envio", "recebimento"]);
    expect(collapsed.reference?.type).toBe("string");
    expect(collapsed.quantity?.type).toBe("integer");
    expect(collapsed.express?.type).toBe("boolean");

    for (const propertySchema of Object.values(collapsed)) {
      expect(propertySchema?.nullable).toBe(true);
      expect(propertySchema?.anyOf).toBeUndefined();
    }
  });
});
