import { describe, it, expect, afterEach } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  ACCEPT_LANGUAGE_META_KEY,
  CONTENT_LANGUAGE_META_KEY,
} from "@inspector/core/mcp/acceptLanguage.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  createLocalizedGreetingTool,
  selectGreetingLanguage,
  ACCEPT_LANGUAGE_META_KEY as FIXTURE_ACCEPT_LANGUAGE_META_KEY,
  CONTENT_LANGUAGE_META_KEY as FIXTURE_CONTENT_LANGUAGE_META_KEY,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";
import type { RequestMetadata } from "@inspector/core/mcp/types.js";

/**
 * The `localized_greeting` showcase fixture (#2979), driven over a direct
 * (Node) Streamable HTTP connection. The direct transport does not mirror
 * `_meta` into `Accept-Language` — only the web backend does — so these cases
 * set the header through a wrapping `fetch` and observe how the fixture treats
 * agreement and mismatch. Node's `fetch` sends `Accept-Language: *` on any
 * request that carries none, so "no header" is not reachable over HTTP here.
 */
describe("localized_greeting fixture (SEP-2792)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    await client?.disconnect().catch(() => {});
    client = null;
    await server?.stop().catch(() => {});
    server = null;
  });

  /** A `fetch` that stamps `Accept-Language` on every request it sends. */
  function fetchWithLanguage(value: string): typeof fetch {
    return (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Accept-Language", value);
      return fetch(input, { ...init, headers });
    };
  }

  async function greet(options: {
    meta?: RequestMetadata;
    acceptLanguage?: string;
    args?: Record<string, string>;
  }) {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createLocalizedGreetingTool()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: {
          transport: createTransportNode,
          ...(options.acceptLanguage !== undefined && {
            fetch: fetchWithLanguage(options.acceptLanguage),
          }),
        },
        ...(options.meta && { defaultMetadata: options.meta }),
      },
    );
    await client.connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "localized_greeting");
    expect(tool).toBeDefined();
    const invocation = await client.callTool(tool!, options.args ?? {});
    expect(invocation.success).toBe(true);
    return {
      text: JSON.stringify(invocation.result?.content),
      isError: invocation.result?.isError === true,
      contentLanguage: invocation.result?._meta?.[CONTENT_LANGUAGE_META_KEY],
    };
  }

  it("shares its _meta keys with core", () => {
    expect(FIXTURE_ACCEPT_LANGUAGE_META_KEY).toBe(ACCEPT_LANGUAGE_META_KEY);
    expect(FIXTURE_CONTENT_LANGUAGE_META_KEY).toBe(CONTENT_LANGUAGE_META_KEY);
  });

  it("falls back to the server default with no preference at all", async () => {
    const result = await greet({});
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Hello, world!");
    expect(result.text).toContain("_meta acceptLanguage: (none)");
    // Node's fetch default, which matches the wildcard → server default.
    expect(result.text).toContain("Accept-Language header: *");
    expect(result.contentLanguage).toBe("en");
  });

  it("answers from _meta when the header agrees with it exactly", async () => {
    const result = await greet({
      meta: { [ACCEPT_LANGUAGE_META_KEY]: "es-MX" },
      acceptLanguage: "es-MX",
      args: { name: "Ada" },
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Hola, Ada!");
    expect(result.contentLanguage).toBe("es");
  });

  it("reports a present header that disagrees with _meta as HeaderMismatch", async () => {
    const result = await greet({
      meta: { [ACCEPT_LANGUAGE_META_KEY]: "de" },
      acceptLanguage: "fr",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("HeaderMismatch");
    expect(result.text).toContain("Accept-Language header: fr");
    expect(result.contentLanguage).toBeUndefined();
  });

  it("flags Node fetch's default * against an unmirrored _meta preference", async () => {
    // What a client that sets `_meta` but does not mirror it looks like on
    // the wire: the runtime fills in `*`, which a strict server rejects.
    const result = await greet({
      meta: { [ACCEPT_LANGUAGE_META_KEY]: "es-MX" },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Accept-Language header: *");
  });

  it("uses a header-only preference when _meta carries none", async () => {
    const result = await greet({ acceptLanguage: "ja" });
    expect(result.isError).toBe(false);
    expect(result.contentLanguage).toBe("ja");
  });

  it("lets an explicit language argument override the preference", async () => {
    const result = await greet({
      meta: { [ACCEPT_LANGUAGE_META_KEY]: "fr" },
      acceptLanguage: "fr",
      args: { language: "de" },
    });
    expect(result.text).toContain("Hallo, world!");
    expect(result.contentLanguage).toBe("de");
  });

  describe("selectGreetingLanguage", () => {
    it.each([
      [undefined, "en"],
      ["", "en"],
      ["fr", "fr"],
      ["FR-ca", "fr"],
      ["zh-Hant-TW", "en"],
      ["zh, de;q=0.1", "de"],
      ["de;q=0.2, es;q=0.8", "es"],
      ["ja;q=0.5, fr;q=0.5", "ja"],
      ["fr;q=0, de", "de"],
      ["es;q=nope, de", "de"],
      ["*", "en"],
      ["*;q=0.9, fr;q=0.1", "en"],
      [" , ;q=1", "en"],
      ["de; level=1", "de"],
      ["constructor", "en"],
      ["toString, __proto__", "en"],
    ])("%j → %s", (preference, expected) => {
      expect(selectGreetingLanguage(preference)).toBe(expected);
    });
  });
});
