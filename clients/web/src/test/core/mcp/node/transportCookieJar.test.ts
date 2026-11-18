/**
 * Where the cookie jar sits in `createTransportNode`'s fetch chain (#2936).
 *
 * The jar must sit *below* the auth-challenge interceptor: the interceptor
 * turns a 401/403 into a throw, so a jar above it would never see that
 * response's `Set-Cookie`, and the OAuth retry that follows would carry stale
 * cookies. The two-replica behavior itself is
 * `integration/mcp/cookie-jar-affinity.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";
import type { JSONRPCRequest } from "@modelcontextprotocol/client";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";

const URL_ = "https://mcp.example.com/mcp";

const SETTINGS: InspectorServerSettings = {
  headers: [],
  metadata: {},
  env: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  roots: [],
  cookieJar: true,
};

/**
 * A network response from the MCP endpoint. happy-dom's `Headers` drops
 * `Set-Cookie` as a browser's would, so the lines are served through an own
 * `getSetCookie` on an otherwise real `Headers`.
 */
function networkResponse(
  status: number,
  body: string | null,
  headers: Record<string, string>,
  setCookie: string[] = [],
): Response {
  const response = new Response(body, { status, headers });
  Object.defineProperty(response.headers, "getSetCookie", {
    value: () => setCookie,
  });
  Object.defineProperty(response, "url", { value: URL_ });
  return response;
}

const REQUEST: JSONRPCRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {},
};

describe("createTransportNode cookie jar placement (#2936)", () => {
  it("keeps a cookie set on a 401 the interceptor throws on", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      networkResponse(
        200,
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
        { "content-type": "application/json" },
      ),
    );
    fetchFn.mockResolvedValueOnce(
      networkResponse(401, null, { "www-authenticate": 'Bearer realm="mcp"' }, [
        "lb=pod-b",
      ]),
    );
    const { transport } = createTransportNode(
      { type: "streamable-http", url: URL_ },
      { fetchFn, settings: SETTINGS, interceptAuthChallenges: true },
    );
    await transport.start();
    await expect(transport.send(REQUEST)).rejects.toThrow();
    await transport.send(REQUEST);
    await transport.close();

    const cookies = fetchFn.mock.calls.map(([input, init]) =>
      new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      ).get("cookie"),
    );
    expect(cookies[0]).toBeNull();
    expect(cookies[1]).toBe("lb=pod-b");
  });
});
