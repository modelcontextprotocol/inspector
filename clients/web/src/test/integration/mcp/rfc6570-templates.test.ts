import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  expandTemplate,
  templateVariableNames,
} from "../../../utils/uriTemplate";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  loadConfig,
  resolveConfig,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of `test-servers/configs/rfc6570-templates-http.json` — the
 * documented manual reproduction for #1919.
 *
 * The helper's unit tests assert what `expandTemplate` *produces*; they cannot
 * assert that the produced URI is what a spec-compliant server *accepts*. That
 * second half is the whole bug: the old string substitution emitted a URI the
 * Inspector was perfectly happy with and the server rejected. So this test
 * drives both directions against a real server over a real transport — the
 * encoded URI must resolve, and the unencoded one the old code produced must
 * still be refused, so a regression cannot pass by loosening the server.
 *
 * The server is built by **resolving the checked-in config** rather than by
 * calling the fixture factory, so a misspelt preset name in `preset-registry.ts`
 * (or a config naming a preset that no longer exists) fails here instead of
 * only when someone runs the repro by hand.
 */
describe("RFC 6570 resource templates over the wire (#1919)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  const configPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../../test-servers/configs/rfc6570-templates-http.json",
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
      serverInfo: createTestServerInfo("rfc6570-templates-test", "1.0.0"),
      resourceTemplates: resolved.resourceTemplates,
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

  /**
   * Read the sole content block as JSON. `contents[]` is a text-or-blob union,
   * so narrow rather than cast — a fixture that started returning a blob should
   * fail here with a clear message, not at `JSON.parse(undefined)`.
   */
  async function readJson(
    connected: InspectorClient,
    uri: string,
  ): Promise<unknown> {
    const { result } = await connected.readResource(uri);
    const [content] = result.contents;
    expect(content).toBeDefined();
    if (!("text" in content)) {
      throw new Error(`expected a text content block for ${uri}`);
    }
    return JSON.parse(content.text);
  }

  it("resolves the preset the config names", () => {
    const resolved = resolveConfig(loadConfig(configPath));
    expect(resolved.resourceTemplates?.map((t) => t.uriTemplate)).toEqual([
      "foobar://events/{topic}",
      "foobar://events{?topic}",
    ]);
  });

  it("advertises both templates, including the query expression", async () => {
    const connected = await connectToShowcase();
    const { resourceTemplates } = await connected.listAllResourceTemplates();
    const byName = Object.fromEntries(
      resourceTemplates.map((t) => [t.name, t.uriTemplate]),
    );
    expect(byName["events-by-path"]).toBe("foobar://events/{topic}");
    expect(byName["events-by-query"]).toBe("foobar://events{?topic}");
  });

  it("discovers a variable in each expression form", () => {
    expect(templateVariableNames("foobar://events/{topic}")).toEqual(["topic"]);
    expect(templateVariableNames("foobar://events{?topic}")).toEqual(["topic"]);
  });

  it("reads a reserved-character value through the simple expression", async () => {
    const connected = await connectToShowcase();
    const uri = expandTemplate("foobar://events/{topic}", { topic: "foo/bar" });
    expect(uri).toBe("foobar://events/foo%2Fbar");

    expect(await readJson(connected, uri)).toEqual({
      topic: "foo%2Fbar",
      matchedUri: uri,
    });
  });

  it("reads through the query expression", async () => {
    const connected = await connectToShowcase();
    const uri = expandTemplate("foobar://events{?topic}", { topic: "weather" });
    expect(uri).toBe("foobar://events?topic=weather");

    expect(await readJson(connected, uri)).toMatchObject({ topic: "weather" });
  });

  // The old behavior, pinned from the server's side. If this ever starts
  // succeeding, the repro server has stopped reproducing and the test above
  // would keep passing while proving nothing.
  it("rejects the unencoded URI the old string substitution produced", async () => {
    const connected = await connectToShowcase();
    await expect(
      connected.readResource("foobar://events/foo/bar"),
    ).rejects.toThrow(/not found/i);
  });
});
