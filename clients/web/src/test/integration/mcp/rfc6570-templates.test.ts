import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  definedValues,
  expandUriTemplate,
  tryExpandUriTemplate,
} from "@inspector/core/mcp/uriTemplate.js";
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
 * The unit tests assert what `expandUriTemplate` *produces*. They cannot assert
 * that what it produces is what a spec-compliant server *accepts*, and that
 * second half is the entire bug: the old string substitution emitted a URI the
 * Inspector was perfectly happy with and the server rejected. So this drives
 * both directions over a real transport — the encoded URI must resolve, and the
 * unencoded one the old code produced must still be refused, so a regression
 * cannot pass by quietly loosening the server.
 *
 * The server is built by **resolving the checked-in config** rather than by
 * calling the fixture factories, which is the difference between covering the
 * wiring and merely asserting the factory: a misspelt preset name in
 * `preset-registry.ts`, or a config naming a preset that no longer exists,
 * fails here instead of only when someone runs the repro by hand.
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
      tools: resolved.tools,
      resources: resolved.resources,
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

  it("advertises every template from the checked-in config", async () => {
    const connected = await connectToShowcase();
    const { resourceTemplates } = await connected.listAllResourceTemplates();
    expect(resourceTemplates.map((entry) => entry.uriTemplate).sort()).toEqual([
      // The malformed one is advertised precisely so a client has to decide
      // what to do with it; the SDK's own constructor accepts it, so nothing
      // upstream of the Inspector rejects it. See the refusal test below.
      "foobar://events/{topic:abc}",
      "foobar://events/{topic}",
      "foobar://events{?topic}",
    ]);
  });

  it("refuses to expand the malformed template rather than guessing", async () => {
    // `abc` is not RFC 6570's `max-length` production, so there is no URI to
    // send. Guessing `{topic}` would read something the server never
    // advertised -- and this server would answer it, which is exactly why the
    // check has to happen client-side.
    const result = tryExpandUriTemplate("foobar://events/{topic:abc}", {
      topic: "news",
    });
    expect(result.uri).toBeUndefined();
    expect(result.error).toMatch(/Invalid RFC 6570 varspec/);
  });

  it("resolves the encoded URI the simple expression expands to", async () => {
    const connected = await connectToShowcase();
    const uri = expandUriTemplate("foobar://events/{topic}", {
      topic: "foo/bar",
    });
    expect(uri).toBe("foobar://events/foo%2Fbar");

    const { result } = await connected.readResource(uri);
    expect(result.contents[0]?.uri).toBe(uri);
  });

  it("rejects the unencoded URI the old string substitution produced", async () => {
    const connected = await connectToShowcase();
    // This is what the pre-fix client sent, and why #1919 was filed: the raw
    // `/` creates a second path segment that the template cannot match.
    await expect(
      connected.readResource("foobar://events/foo/bar"),
    ).rejects.toThrow(/not found/i);
  });

  it("resolves the encoded URI the query expression expands to", async () => {
    const connected = await connectToShowcase();
    const uri = expandUriTemplate("foobar://events{?topic}", {
      topic: "foo/bar",
    });
    expect(uri).toBe("foobar://events?topic=foo%2Fbar");

    const { result } = await connected.readResource(uri);
    expect(result.contents[0]?.uri).toBe(uri);
  });

  // The tests above expand with the helper and then call `readResource`, which
  // leaves `InspectorClient.readResourceFromTemplate` -- the API the TUI drives
  // and the one this PR rewired -- unproven: they pass whether or not that
  // method still uses the SDK's expander. These drive it end to end with a
  // value that the two expanders disagree about, so reverting the wiring fails
  // here rather than silently.
  it("expands and reads a simple expression through readResourceFromTemplate", async () => {
    const connected = await connectToShowcase();
    const invocation = await connected.readResourceFromTemplate(
      "foobar://events/{topic}",
      { topic: "foo/bar" },
    );
    expect(invocation.expandedUri).toBe("foobar://events/foo%2Fbar");
    expect(invocation.result.contents[0]?.uri).toBe(invocation.expandedUri);
  });

  it("encodes a sub-delim the SDK's expander leaves bare", async () => {
    const connected = await connectToShowcase();
    // Verified by reverting the wiring: `encodeURIComponent` does encode `/`,
    // so `foo/bar` alone does NOT distinguish the two expanders -- the SDK
    // handles that case correctly and #1919 was the web panel's own string
    // substitution. `!` is where they differ: it is a sub-delim, which RFC 6570
    // requires encoded and `encodeURIComponent` leaves alone, so the SDK
    // expander returns `foobar://events/a!b` and fails this assertion.
    const invocation = await connected.readResourceFromTemplate(
      "foobar://events/{topic}",
      { topic: "a!b" },
    );
    expect(invocation.expandedUri).toBe("foobar://events/a%21b");
    expect(invocation.result.contents[0]?.uri).toBe(invocation.expandedUri);
  });

  it("expands and reads a query expression through readResourceFromTemplate", async () => {
    const connected = await connectToShowcase();
    const invocation = await connected.readResourceFromTemplate(
      "foobar://events{?topic}",
      { topic: "foo/bar" },
    );
    expect(invocation.expandedUri).toBe("foobar://events?topic=foo%2Fbar");
    expect(invocation.result.contents[0]?.uri).toBe(invocation.expandedUri);
  });

  it("refuses the malformed template through readResourceFromTemplate", async () => {
    const connected = await connectToShowcase();
    await expect(
      connected.readResourceFromTemplate("foobar://events/{topic:abc}", {
        topic: "news",
      }),
    ).rejects.toThrow(/Invalid RFC 6570 varspec/);
  });

  it("resolves the base URI a blank query expression expands to", async () => {
    const connected = await connectToShowcase();
    // RFC 6570 drops the whole expression when the variable is *undefined*, so
    // an unfilled `topic` legitimately requests the unfiltered collection. The
    // form is what turns its untouched blank into "undefined" (`definedValues`)
    // — a key present with "" is a defined value and would expand to
    // `?topic=`, which is a different (and here, unregistered) resource. The
    // SDK's matcher compiles `{?topic}` to a *required* `\?topic=([^&]+)`, so a
    // template alone cannot serve this — the config registers the plain
    // resource, which is what a real server would do.
    const uri = expandUriTemplate(
      "foobar://events{?topic}",
      definedValues({ topic: "" }),
    );
    expect(uri).toBe("foobar://events");

    const { result } = await connected.readResource(uri);
    expect(result.contents[0]?.uri).toBe(uri);
  });
});
