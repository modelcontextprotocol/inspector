/**
 * SEP-2792 `_meta` → `Accept-Language` mirroring in the transport
 * `createTransportNode` builds for Streamable HTTP (#2987) — the one the CLI,
 * the TUI and the web backend all send through.
 */
import { describe, it, expect, vi } from "vitest";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { LanguageMirroringStreamableHTTPClientTransport } from "@inspector/core/mcp/node/languageMirroringTransport.js";
import { ACCEPT_LANGUAGE_META_KEY } from "@inspector/core/mcp/acceptLanguage.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";

const URL_ = "https://mcp.example.com/mcp";

function settings(
  headers: InspectorServerSettings["headers"] = [],
): InspectorServerSettings {
  return {
    headers,
    metadata: {},
    env: [],
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: 60000,
    maxFetchRequests: 1000,
    roots: [],
  };
}

/** A notification, so `send` resolves on the 202 without awaiting a reply. */
function notification(meta?: Record<string, unknown>): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    method: "notifications/message",
    params: meta ? { _meta: meta } : {},
  };
}

async function sentHeaders(
  message: JSONRPCMessage,
  options: {
    configured?: InspectorServerSettings["headers"];
    sendHeaders?: Record<string, string>;
  } = {},
): Promise<Headers> {
  const fetchFn = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 202 }),
  );
  const { transport } = createTransportNode(
    { type: "streamable-http", url: URL_ },
    { fetchFn, settings: settings(options.configured) },
  );
  expect(transport).toBeInstanceOf(
    LanguageMirroringStreamableHTTPClientTransport,
  );
  await transport.start();
  await transport.send(
    message,
    options.sendHeaders ? { headers: options.sendHeaders } : undefined,
  );
  await transport.close();
  const [input, init] = fetchFn.mock.calls[0]!;
  return new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
}

describe("LanguageMirroringStreamableHTTPClientTransport (#2987)", () => {
  it("mirrors the _meta preference to Accept-Language exactly", async () => {
    const headers = await sentHeaders(
      notification({ [ACCEPT_LANGUAGE_META_KEY]: "fr-CA, en;q=0.5" }),
    );
    expect(headers.get("accept-language")).toBe("fr-CA, en;q=0.5");
  });

  it("adds nothing when the message carries no preference", async () => {
    const headers = await sentHeaders(notification());
    expect(headers.get("accept-language")).toBeNull();
  });

  it("replaces a configured Accept-Language with the mirror", async () => {
    const headers = await sentHeaders(
      notification({ [ACCEPT_LANGUAGE_META_KEY]: "de" }),
      { configured: [{ key: "Accept-Language", value: "fr" }] },
    );
    expect(headers.get("accept-language")).toBe("de");
  });

  it("keeps per-send headers a caller already passed", async () => {
    const headers = await sentHeaders(
      notification({ [ACCEPT_LANGUAGE_META_KEY]: "ja" }),
      { sendHeaders: { "Mcp-Param-City": "Tokyo" } },
    );
    expect(headers.get("mcp-param-city")).toBe("Tokyo");
    expect(headers.get("accept-language")).toBe("ja");
  });

  it("leaves per-send headers untouched when there is no preference", async () => {
    const headers = await sentHeaders(notification(), {
      sendHeaders: { "Mcp-Param-City": "Oslo" },
    });
    expect(headers.get("mcp-param-city")).toBe("Oslo");
    expect(headers.get("accept-language")).toBeNull();
  });
});
