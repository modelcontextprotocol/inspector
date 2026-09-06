import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  loadConfig,
  resolveConfig,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of `test-servers/configs/empty-cursor-http.json` — the
 * documented manual reproduction for #2220.
 *
 * The unit tests on the adapters assert the outbound params directly, which is
 * where the decision is made. What they cannot see is the round trip: that a
 * server may hand back `""` as a `nextCursor` at all, that the SDK carries it
 * through both directions without normalizing it away, and that a page walk
 * driven by it actually advances. Those are the premise of the fix, and a
 * change anywhere in that chain would leave the unit tests green while the
 * showcase server quietly stopped reproducing the bug.
 *
 * The server is built by **resolving the checked-in config** rather than by
 * hand, so a config that names a dead preset — or an `emptyStringCursor` flag
 * that stops being threaded through `resolveConfig` — fails here rather than
 * only when someone runs the repro by hand.
 */
describe("empty-string pagination cursor over the wire (#2220)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  const configPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../../test-servers/configs/empty-cursor-http.json",
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
      ...resolved,
      serverInfo: createTestServerInfo("empty-cursor-test", "1.0.0"),
      port: undefined,
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

  it("resolves the config with the empty-cursor flag intact", () => {
    const resolved = resolveConfig(loadConfig(configPath));
    expect(resolved.emptyStringCursor).toBe(true);
    expect(resolved.maxPageSize).toEqual({
      tools: 4,
      resources: 4,
      prompts: 4,
    });
    expect(resolved.tools).toHaveLength(12);
  });

  /**
   * One walk per list, driven by the same three assertions: page one hands back
   * `""` rather than a numeric index, sending it back yields the *second* four
   * items rather than the first four again, and the walk still terminates.
   *
   * The names are the assertion for "advanced" — a length check alone would
   * pass on a server that re-served page one, which is exactly the failure.
   */
  const WALKS: {
    label: string;
    walk: (
      client: InspectorClient,
      cursor?: string,
    ) => Promise<{ names: string[]; nextCursor?: string }>;
  }[] = [
    {
      label: "tools/list",
      walk: async (connected, cursor) => {
        const page = await connected.listTools(cursor);
        return {
          names: page.tools.map((tool) => tool.name),
          nextCursor: page.nextCursor,
        };
      },
    },
    {
      label: "prompts/list",
      walk: async (connected, cursor) => {
        const page = await connected.listPrompts(cursor);
        return {
          names: page.prompts.map((prompt) => prompt.name),
          nextCursor: page.nextCursor,
        };
      },
    },
    {
      label: "resources/list",
      walk: async (connected, cursor) => {
        const page = await connected.listResources(cursor);
        return {
          names: page.resources.map((resource) => resource.uri),
          nextCursor: page.nextCursor,
        };
      },
    },
  ];

  it.each(WALKS)(
    "$label advances past an empty-string cursor instead of re-serving page one",
    async ({ walk }) => {
      const connected = await connectToShowcase();

      const first = await walk(connected);
      expect(first.names).toHaveLength(4);
      // The premise: the server really does hand back `""`, and nothing between
      // here and the wire turned it into `undefined`.
      expect(first.nextCursor).toBe("");

      const second = await walk(connected, first.nextCursor);
      expect(second.names).toHaveLength(4);
      // On the pre-fix adapters this was `first.names` again.
      expect(second.names).not.toEqual(first.names);
      expect(second.nextCursor).toBe("8");

      const third = await walk(connected, second.nextCursor);
      expect(third.names).toHaveLength(4);
      expect(third.nextCursor).toBeUndefined();

      // All twelve, each seen exactly once — the walk covered the list rather
      // than looping over one page.
      const seen = [...first.names, ...second.names, ...third.names];
      expect(new Set(seen).size).toBe(12);
    },
  );
});
