/**
 * `routeOAuthRequests` — MCP traffic to one fetch, OAuth work to another
 * (#2749).
 */

import { describe, expect, it, vi } from "vitest";
import {
  isWellKnownUri,
  routeOAuthRequests,
} from "@inspector/core/auth/routeOAuthRequests.js";
import { exemptMcpEndpoint } from "@inspector/core/auth/requestTimeout.js";

function fetches() {
  const mcp = vi.fn<typeof fetch>().mockResolvedValue(new Response("mcp"));
  const oauth = vi.fn<typeof fetch>().mockResolvedValue(new Response("oauth"));
  return { mcp, oauth };
}

describe("routeOAuthRequests", () => {
  it("routes by the predicate, handing each fetch the original arguments", async () => {
    const { mcp, oauth } = fetches();
    const isMcp = vi.fn((url: string) => url.endsWith("/mcp"));
    const routed = routeOAuthRequests(mcp, oauth, isMcp);

    const mcpInit = { method: "POST", body: "{}" };
    expect(await (await routed("http://s.example/mcp", mcpInit)).text()).toBe(
      "mcp",
    );
    expect(mcp).toHaveBeenCalledWith("http://s.example/mcp", mcpInit);

    const url = new URL("http://as.example/token");
    expect(await (await routed(url)).text()).toBe("oauth");
    expect(oauth).toHaveBeenCalledWith(url, undefined);
    expect(isMcp).toHaveBeenLastCalledWith(url.href, expect.any(Headers));
  });

  it("hands the predicate a Request's URL and headers", async () => {
    const { mcp, oauth } = fetches();
    const isMcp = vi.fn<(url: string, headers: Headers) => boolean>(
      () => false,
    );
    const req = new Request("http://as.example/token", {
      headers: { "x-probe": "1" },
    });
    await routeOAuthRequests(mcp, oauth, isMcp)(req);
    const [seenUrl, seenHeaders] = isMcp.mock.calls[0] ?? [];
    expect(seenUrl).toBe("http://as.example/token");
    expect(seenHeaders?.get("x-probe")).toBe("1");
  });

  it("sends a same-path OAuth form to OAuth under exemptMcpEndpoint", async () => {
    const { mcp, oauth } = fetches();
    const routed = routeOAuthRequests(
      mcp,
      oauth,
      exemptMcpEndpoint(() => "http://s.example/mcp"),
    );
    await routed("http://s.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await routed("http://s.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token",
    });
    await routed("http://as.example/token");
    expect(mcp).toHaveBeenCalledTimes(1);
    expect(oauth).toHaveBeenCalledTimes(2);
  });

  // Copilot (#2796): legacy SSE widens the MCP exemption to the whole origin,
  // which must not swallow the server's own discovery documents.
  it("sends a same-origin well-known URI to OAuth under legacy SSE", async () => {
    const { mcp, oauth } = fetches();
    const routed = routeOAuthRequests(
      mcp,
      oauth,
      exemptMcpEndpoint(
        () => "http://s.example/sse",
        () => true,
      ),
    );
    await routed("http://s.example/messages?sessionId=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await routed("http://s.example/.well-known/oauth-protected-resource");
    await routed("http://s.example/tenant/.well-known/openid-configuration");
    expect(mcp).toHaveBeenCalledTimes(1);
    expect(oauth).toHaveBeenCalledTimes(2);
  });
});

describe("isWellKnownUri", () => {
  it.each([
    ["http://s.example/.well-known/oauth-authorization-server", true],
    ["http://s.example/.well-known/oauth-protected-resource/mcp", true],
    ["http://s.example/tenant/.well-known/openid-configuration", true],
    ["http://s.example/mcp", false],
    ["http://s.example/well-known/x", false],
    ["not a url", false],
  ])("%s → %s", (url, expected) => {
    expect(isWellKnownUri(url)).toBe(expected);
  });
});
