import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createNumberedResources,
  createFileResourceTemplate,
  loadConfig,
  resolveConfig,
} from "@modelcontextprotocol/inspector-test-server";
import type { ServerConfig } from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of `ServerConfig.duplicateResourceUris` (#2206) — the only way
 * this repo can serve a `resources/list` that repeats a URI, since
 * `registerResource` keys on the URI and no preset can produce a repeat.
 *
 * The Resources sidebar keyed its rows by `resource.uri`, so duplicates
 * collided: React logged `Encountered two children with the same key` on every
 * render and a filtered-out row survived reconciliation. The component-level
 * regressions live in `ResourceControls.test.tsx`; this file covers the server
 * option the manual repro depends on — the wire shape, the ordering that makes
 * the defect observable, and the config plumbing. It mirrors
 * `duplicate-tool-names.test.ts` (#1957) deliberately, since the two fixtures
 * have to stay the same shape to stay comparable.
 */
describe("duplicate resource URIs in resources/list (#2206)", () => {
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
      serverInfo: createTestServerInfo("duplicate-resource-uris-test", "1.0.0"),
      resources: createNumberedResources(2),
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

  it("emits the named resources twice, repeats appended, second copy titled", async () => {
    const started = await start({
      duplicateResourceUris: ["test://resource_1"],
    });
    const connected = await connect(started.url);

    const { resources } = await connected.listAllResources();

    // Repeats go at the END, not beside their twin. That ordering is
    // load-bearing: React matches a leading run of same-key children first, so
    // an adjacent duplicate lines up and the defect hides. Asserting the exact
    // sequence keeps a future "tidy-up" from silently defanging the fixture.
    expect(resources.map((r) => r.uri)).toEqual([
      "test://resource_1",
      "test://resource_2",
      "test://resource_1",
    ]);
    // These fixtures carry no title, so the marker falls back to the name —
    // which is what keeps the two rows distinguishable on screen.
    expect(resources.at(-1)?.title).toBe("resource_1 (duplicate)");
    // Only the appended copy is marked; the originals are passed through as-is.
    expect(resources[0]?.title).toBeUndefined();
    expect(resources[1]?.title).toBeUndefined();
  });

  it("leaves the list alone when no URIs are given", async () => {
    const started = await start({ duplicateResourceUris: [] });
    const connected = await connect(started.url);

    const { resources } = await connected.listAllResources();
    expect(resources.map((r) => r.uri)).toEqual([
      "test://resource_1",
      "test://resource_2",
    ]);
  });

  // The option matches the assembled list, not `state.registeredResources`, so
  // a URI a resource template contributed is duplicated too (Copilot). Both
  // kinds land in the same Resources sidebar list and collide on the same React
  // key, so the fixture has to be able to reproduce either.
  it("duplicates a URI a resource template listed", async () => {
    const started = await start({
      resources: [],
      resourceTemplates: [
        createFileResourceTemplate(undefined, () => ["file:///notes.md"]),
      ],
      duplicateResourceUris: ["file:///notes.md"],
    });
    const connected = await connect(started.url);

    const { resources } = await connected.listAllResources();
    expect(resources.map((r) => r.uri)).toEqual([
      "file:///notes.md",
      "file:///notes.md",
    ]);
    expect(resources.at(-1)?.title).toBe("file:///notes.md (duplicate)");
  });

  it("ignores a URI that is not registered", async () => {
    const started = await start({
      duplicateResourceUris: ["test://not_a_resource"],
    });
    const connected = await connect(started.url);

    const { resources } = await connected.listAllResources();
    expect(resources.map((r) => r.uri)).toEqual([
      "test://resource_1",
      "test://resource_2",
    ]);
  });

  it("duplicates before paginating, so a pair straddles a page boundary", async () => {
    const started = await start({
      duplicateResourceUris: ["test://resource_1", "test://resource_2"],
      maxPageSize: { resources: 2 },
    });
    const connected = await connect(started.url);

    // Two resources at a page size of two: the duplicated copies land on page
    // 2, which only holds if duplication runs before the slice.
    const firstPage = await connected.listResources();
    expect(firstPage.resources.map((r) => r.uri)).toEqual([
      "test://resource_1",
      "test://resource_2",
    ]);
    expect(firstPage.nextCursor).toBeDefined();

    const { resources } = await connected.listAllResources();
    expect(resources.map((r) => r.uri)).toEqual([
      "test://resource_1",
      "test://resource_2",
      "test://resource_1",
      "test://resource_2",
    ]);
    expect(resources.slice(2).map((r) => r.title)).toEqual([
      "resource_1 (duplicate)",
      "resource_2 (duplicate)",
    ]);
  });

  it("serves the shape the showcase config declares", async () => {
    // Covers the JSON → ConfigFile → ServerConfig plumbing, not just the
    // in-process option: a config file is how the manual repro is produced.
    const configPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../../test-servers/configs/duplicate-resource-uris-http.json",
    );
    const resolved = resolveConfig(loadConfig(configPath));
    expect(resolved.duplicateResourceUris).toEqual([
      "test://resource_1",
      "test://resource_3",
    ]);

    // Let the harness pick the port instead of the config's fixed one, so this
    // test can't collide with a manually-running showcase server.
    const started = await start({
      resources: resolved.resources,
      duplicateResourceUris: resolved.duplicateResourceUris,
    });
    const connected = await connect(started.url);

    const { resources } = await connected.listAllResources();
    expect(resources.map((r) => r.uri)).toEqual([
      "test://resource_1",
      "test://resource_2",
      "test://resource_3",
      "test://resource_4",
      "test://resource_1",
      "test://resource_3",
    ]);

    // The whole point of the fixture: filtering by "resource_2" must be able to
    // drop every non-matching row, duplicates included.
    const matching = resources.filter(
      (r) =>
        r.name.includes("resource_2") ||
        r.uri.includes("resource_2") ||
        (r.title?.includes("resource_2") ?? false),
    );
    expect(matching).toHaveLength(1);
  });
});
