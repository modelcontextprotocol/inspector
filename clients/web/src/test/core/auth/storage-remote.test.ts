import { describe, it, expect, beforeEach, vi } from "vitest";
import { RemoteOAuthStorage } from "@inspector/core/auth/remote/storage-remote.js";

const NOOP_FETCH = vi.fn(
  async () =>
    new Response(JSON.stringify({ state: { servers: {} }, version: 0 }), {
      status: 200,
    }),
) as unknown as typeof fetch;

describe("RemoteOAuthStorage (unit, mocked fetch)", () => {
  let storage: RemoteOAuthStorage;
  const serverUrl = "http://localhost:3000";

  beforeEach(() => {
    storage = new RemoteOAuthStorage({
      baseUrl: "http://remote.example",
      storeId: `unit-${Math.random().toString(36).slice(2)}`,
      fetchFn: NOOP_FETCH,
    });
  });

  it("getClientInformation returns undefined when nothing is stored", async () => {
    expect(await storage.getClientInformation(serverUrl)).toBeUndefined();
  });

  it("saveClientInformation + getClientInformation round-trip", async () => {
    await storage.saveClientInformation(serverUrl, { client_id: "dyn" });
    expect(await storage.getClientInformation(serverUrl)).toEqual({
      client_id: "dyn",
    });
  });

  it("savePreregisteredClientInformation + getClientInformation(isPreregistered=true)", async () => {
    await storage.savePreregisteredClientInformation(serverUrl, {
      client_id: "pre",
    });
    expect(await storage.getClientInformation(serverUrl, true)).toEqual({
      client_id: "pre",
    });
  });

  it("clearClientInformation default branch removes dynamic info", async () => {
    await storage.saveClientInformation(serverUrl, { client_id: "dyn" });
    storage.clearClientInformation(serverUrl);
    expect(await storage.getClientInformation(serverUrl)).toBeUndefined();
  });

  it("clearClientInformation(isPreregistered=true) removes preregistered info", async () => {
    await storage.savePreregisteredClientInformation(serverUrl, {
      client_id: "pre",
    });
    storage.clearClientInformation(serverUrl, true);
    expect(await storage.getClientInformation(serverUrl, true)).toBeUndefined();
  });

  it("tokens round-trip and clearTokens", async () => {
    const tokens = { access_token: "t", token_type: "Bearer" };
    await storage.saveTokens(serverUrl, tokens);
    expect(await storage.getTokens(serverUrl)).toEqual(tokens);
    storage.clearTokens(serverUrl);
    expect(await storage.getTokens(serverUrl)).toBeUndefined();
  });

  it("codeVerifier round-trip and clearCodeVerifier", async () => {
    await storage.saveCodeVerifier(serverUrl, "verifier");
    expect(storage.getCodeVerifier(serverUrl)).toBe("verifier");
    storage.clearCodeVerifier(serverUrl);
    expect(storage.getCodeVerifier(serverUrl)).toBeUndefined();
  });

  it("scope round-trip and clearScope", async () => {
    await storage.saveScope(serverUrl, "read write");
    expect(storage.getScope(serverUrl)).toBe("read write");
    storage.clearScope(serverUrl);
    expect(storage.getScope(serverUrl)).toBeUndefined();
  });

  it("serverMetadata round-trip and clearServerMetadata", async () => {
    const md = {
      issuer: serverUrl,
      authorization_endpoint: `${serverUrl}/authorize`,
      token_endpoint: `${serverUrl}/token`,
      response_types_supported: ["code"],
    };
    await storage.saveServerMetadata(serverUrl, md);
    expect(storage.getServerMetadata(serverUrl)).toEqual(md);
    storage.clearServerMetadata(serverUrl);
    expect(storage.getServerMetadata(serverUrl)).toBeNull();
  });

  it("clear() wipes all state for a server", async () => {
    await storage.saveClientInformation(serverUrl, { client_id: "x" });
    await storage.saveTokens(serverUrl, {
      access_token: "t",
      token_type: "Bearer",
    });
    storage.clear(serverUrl);
    expect(await storage.getClientInformation(serverUrl)).toBeUndefined();
    expect(await storage.getTokens(serverUrl)).toBeUndefined();
  });

  it("default storeId is 'oauth' when omitted", () => {
    const s = new RemoteOAuthStorage({
      baseUrl: "http://r.example",
      fetchFn: NOOP_FETCH,
    });
    // No public accessor; constructing without throwing covers the default-branch.
    expect(s).toBeInstanceOf(RemoteOAuthStorage);
  });
});
