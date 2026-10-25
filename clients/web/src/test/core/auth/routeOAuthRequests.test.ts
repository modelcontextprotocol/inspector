/**
 * `routeOAuthRequests` — MCP traffic to one fetch, OAuth work to another
 * (#2749).
 */

import { describe, expect, it, vi } from "vitest";
import {
  isMcpShapedRequest,
  routeOAuthRequests,
} from "@inspector/core/auth/routeOAuthRequests.js";
import { exemptMcpEndpoint } from "@inspector/core/auth/requestTimeout.js";

function fetches() {
  const mcp = vi.fn<typeof fetch>().mockResolvedValue(new Response("mcp"));
  const oauth = vi.fn<typeof fetch>().mockResolvedValue(new Response("oauth"));
  return { mcp, oauth };
}

const RPC = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

/** An MCP message POST, as every transport sends one. */
function rpcPost(body: string = RPC): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  };
}

describe("isMcpShapedRequest", () => {
  it.each<[string, RequestInfo | URL, RequestInit | undefined, boolean]>([
    ["a JSON-RPC POST", "http://s/mcp", rpcPost(), true],
    ["a JSON-RPC batch POST", "http://s/mcp", rpcPost(`[${RPC},${RPC}]`), true],
    ["an empty batch", "http://s/mcp", rpcPost("[]"), false],
    ["a mixed batch", "http://s/mcp", rpcPost(`[${RPC},{"a":1}]`), false],
    ["a non-JSON-RPC JSON POST (DCR)", "http://s/r", rpcPost('{"a":1}'), false],
    ["a JSON null POST", "http://s/r", rpcPost("null"), false],
    ["a non-JSON POST", "http://s/r", rpcPost("grant_type=x"), false],
    [
      "a URLSearchParams POST",
      "http://s/t",
      { method: "post", body: new URLSearchParams({ a: "b" }) },
      false,
    ],
    [
      "an event-stream GET",
      "http://s/sse",
      { headers: { Accept: "Text/Event-Stream" } },
      true,
    ],
    ["a plain GET (discovery)", "http://s/meta", undefined, false],
    ["a DELETE", "http://s/mcp", { method: "DELETE" }, true],
    ["a PUT", "http://s/mcp", { method: "PUT", body: RPC }, false],
    [
      "a Request GET accepting event-stream",
      new Request("http://s/sse", { headers: { accept: "text/event-stream" } }),
      undefined,
      true,
    ],
    [
      "a Request POST (body unreadable synchronously)",
      new Request("http://s/mcp", { method: "POST", body: RPC }),
      undefined,
      false,
    ],
  ])("%s → %s", (_label, input, init, expected) => {
    expect(isMcpShapedRequest(input, init)).toBe(expected);
  });
});

describe("routeOAuthRequests", () => {
  it("sends MCP-shaped traffic to the endpoint to mcpFetch, with the original arguments", async () => {
    const { mcp, oauth } = fetches();
    const isMcp = vi.fn<(url: string, headers: Headers) => boolean>(() => true);
    const routed = routeOAuthRequests(mcp, oauth, isMcp);
    const init = rpcPost();
    expect(await (await routed("http://s.example/mcp", init)).text()).toBe(
      "mcp",
    );
    expect(mcp).toHaveBeenCalledWith("http://s.example/mcp", init);
    const [seenUrl, seenHeaders] = isMcp.mock.calls[0] ?? [];
    expect(seenUrl).toBe("http://s.example/mcp");
    expect(seenHeaders?.get("content-type")).toBe("application/json");
  });

  it("sends MCP-shaped traffic elsewhere to oauthFetch", async () => {
    const { mcp, oauth } = fetches();
    const url = new URL("http://other.example/mcp");
    await routeOAuthRequests(mcp, oauth, () => false)(url, rpcPost());
    expect(oauth).toHaveBeenCalledWith(url, rpcPost());
    expect(mcp).not.toHaveBeenCalled();
  });

  it("sends a non-MCP shape to oauthFetch without consulting the predicate", async () => {
    const { mcp, oauth } = fetches();
    const isMcp = vi.fn(() => true);
    await routeOAuthRequests(mcp, oauth, isMcp)("http://s.example/meta");
    expect(oauth).toHaveBeenCalledTimes(1);
    expect(isMcp).not.toHaveBeenCalled();
  });

  it("sends a same-path OAuth form to OAuth under exemptMcpEndpoint", async () => {
    const { mcp, oauth } = fetches();
    const routed = routeOAuthRequests(
      mcp,
      oauth,
      exemptMcpEndpoint(() => "http://s.example/mcp"),
    );
    await routed("http://s.example/mcp", rpcPost());
    await routed("http://s.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token",
    });
    expect(mcp).toHaveBeenCalledTimes(1);
    expect(oauth).toHaveBeenCalledTimes(1);
  });

  // Copilot (#2796, rounds 2 and 3): legacy SSE widens the MCP exemption to
  // the whole origin, which must not swallow the server's own OAuth requests —
  // discovery at a well-known or a custom path, or a registration POST.
  it("keeps same-origin OAuth on the guard under legacy SSE", async () => {
    const { mcp, oauth } = fetches();
    const routed = routeOAuthRequests(
      mcp,
      oauth,
      exemptMcpEndpoint(
        () => "http://s.example/sse",
        () => true,
      ),
    );
    await routed("http://s.example/sse", {
      headers: { accept: "text/event-stream" },
    });
    await routed("http://s.example/messages?sessionId=1", rpcPost());
    expect(mcp).toHaveBeenCalledTimes(2);

    await routed("http://s.example/.well-known/oauth-protected-resource");
    await routed("http://s.example/custom/protected-resource");
    await routed(
      "http://s.example/register",
      rpcPost('{"redirect_uris":["http://localhost/cb"]}'),
    );
    expect(oauth).toHaveBeenCalledTimes(3);
    expect(mcp).toHaveBeenCalledTimes(2);
  });
});
