import { describe, it, expect, beforeEach, vi } from "vitest";
import { BrowserOAuthStorage } from "@inspector/core/auth/browser/storage.js";
import type { TokenRevocationOutcome } from "@inspector/core/auth/revocation.js";
import type { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { clearServerOAuthState } from "./clearServerOAuthState";

const SERVER_URL = "https://mcp.example.com/mcp";

function skipped(): TokenRevocationOutcome {
  return { status: "skipped", reason: "no_endpoint" };
}

describe("clearServerOAuthState", () => {
  let storage: BrowserOAuthStorage;

  beforeEach(async () => {
    storage = new BrowserOAuthStorage();
    await storage.clear(SERVER_URL);
  });

  it("clears storage by server URL when not the active connection", async () => {
    await storage.saveTokens(SERVER_URL, {
      access_token: "tok",
      token_type: "Bearer",
    });

    const { cleared } = await clearServerOAuthState({
      config: { type: "streamable-http", url: SERVER_URL },
      isActiveConnection: false,
      oauthStorage: storage,
    });

    expect(cleared).toBe(true);
    expect(await storage.getTokens(SERVER_URL)).toBeUndefined();
  });

  it("uses the live client when clearing the active connection", async () => {
    const clearOAuthTokens = vi.fn<InspectorClient["clearOAuthTokens"]>(
      async () => skipped(),
    );
    const inspectorClient = { clearOAuthTokens };

    const { cleared } = await clearServerOAuthState({
      config: { type: "streamable-http", url: SERVER_URL },
      inspectorClient,
      isActiveConnection: true,
      oauthStorage: storage,
    });

    expect(cleared).toBe(true);
    expect(clearOAuthTokens).toHaveBeenCalledTimes(1);
    expect(clearOAuthTokens).toHaveBeenCalledWith({ revoke: true });
  });

  it("returns cleared: false for stdio servers", async () => {
    await expect(
      clearServerOAuthState({
        config: { type: "stdio", command: "node", args: [] },
        isActiveConnection: false,
        oauthStorage: storage,
      }),
    ).resolves.toEqual({ cleared: false });
  });

  // #2144 — the opt-out has to reach the live client, since that is where the
  // RFC 7009 request is actually made.
  it("forwards revoke: false to the live client", async () => {
    const clearOAuthTokens = vi.fn<InspectorClient["clearOAuthTokens"]>(
      async () => skipped(),
    );

    await clearServerOAuthState({
      config: { type: "streamable-http", url: SERVER_URL },
      inspectorClient: { clearOAuthTokens },
      isActiveConnection: true,
      oauthStorage: storage,
      revoke: false,
    });

    expect(clearOAuthTokens).toHaveBeenCalledWith({ revoke: false });
  });

  // #2144 — the non-active path revokes from the store directly. The snapshot
  // is taken before the clear (after it there is no token, client id or cached
  // metadata to build a request from), but the clear itself runs before the
  // network — so by the time the request goes out the store is already empty.
  it("clears before sending, using the snapshot it took first", async () => {
    await storage.saveTokens(
      SERVER_URL,
      {
        access_token: "tok",
        token_type: "Bearer",
        refresh_token: "refresh-tok",
      },
      // Issuer-bound and matching the metadata below: an unkeyed grant records
      // no authorization server and is deliberately refused.
      { issuer: "https://as.example.com" },
    );
    await storage.saveServerMetadata(SERVER_URL, {
      issuer: "https://as.example.com",
      authorization_endpoint: "https://as.example.com/authorize",
      token_endpoint: "https://as.example.com/token",
      revocation_endpoint: "https://as.example.com/revoke",
      response_types_supported: ["code"],
    });

    let tokensAtRequestTime: unknown = "unset";
    const fetchFn = vi.fn<typeof fetch>(async () => {
      tokensAtRequestTime = await storage.getTokens(SERVER_URL);
      return new Response(null, { status: 200 });
    });

    const { revocation } = await clearServerOAuthState({
      config: { type: "streamable-http", url: SERVER_URL },
      isActiveConnection: false,
      oauthStorage: storage,
      fetchFn,
    });

    expect(revocation).toEqual({
      status: "revoked",
      tokenTypeHint: "refresh_token",
      endpoint: "https://as.example.com/revoke",
    });
    // The store was already empty when the request went out — that is the
    // ordering, and it is what stops a concurrently-written grant being wiped.
    expect(tokensAtRequestTime).toBeUndefined();
    expect(await storage.getTokens(SERVER_URL)).toBeUndefined();
  });

  // Without a backend-proxied fetch the request would go out on the page
  // origin, where a real authorization server's missing CORS headers reject it.
  // Skipping is honest; attempting it would fail loudly on real deployments and
  // succeed on permissive ones.
  it("skips revocation on the non-active path when given no fetch", async () => {
    await storage.saveTokens(SERVER_URL, {
      access_token: "tok",
      token_type: "Bearer",
    });

    const { revocation } = await clearServerOAuthState({
      config: { type: "streamable-http", url: SERVER_URL },
      isActiveConnection: false,
      oauthStorage: storage,
    });

    expect(revocation).toEqual({ status: "skipped", reason: "disabled" });
    expect(await storage.getTokens(SERVER_URL)).toBeUndefined();
  });

  it("skips the request on the non-active path when revoke is off", async () => {
    const fetchFn = vi.fn<typeof fetch>();

    const { revocation } = await clearServerOAuthState({
      config: { type: "streamable-http", url: SERVER_URL },
      isActiveConnection: false,
      oauthStorage: storage,
      revoke: false,
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(revocation).toEqual({ status: "skipped", reason: "disabled" });
  });
});
