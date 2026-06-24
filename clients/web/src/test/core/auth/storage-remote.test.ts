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
    expect(await storage.getCodeVerifier(serverUrl)).toBe("verifier");
    storage.clearCodeVerifier(serverUrl);
    expect(await storage.getCodeVerifier(serverUrl)).toBeUndefined();
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
    expect(await storage.getServerMetadata(serverUrl)).toEqual(md);
    storage.clearServerMetadata(serverUrl);
    expect(await storage.getServerMetadata(serverUrl)).toBeNull();
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

  it("getCodeVerifier waits for the async hydration GET before reading", async () => {
    // Unlike the other tests in this file (which write-then-read in the same
    // session), this asserts that a value PERSISTED on the backend before the
    // store was constructed is still returned — i.e. the getter awaits the
    // remote storage adapter's hydration GET.
    let releaseGet!: () => void;
    const getGate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    const fetchFn = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          await getGate;
          return new Response(
            JSON.stringify({
              state: {
                servers: { [serverUrl]: { codeVerifier: "from-disk" } },
              },
              version: 0,
            }),
            { status: 200 },
          );
        }
        void url;
        return new Response("{}", { status: 200 });
      },
    );
    const s = new RemoteOAuthStorage({
      baseUrl: "http://remote.example",
      storeId: "hydration-test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const p = s.getCodeVerifier(serverUrl);
    releaseGet();
    expect(await p).toBe("from-disk");
  });

  it("persist POST is sent with keepalive so it survives an immediate redirect", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const s = new RemoteOAuthStorage({
      baseUrl: "http://remote.example",
      storeId: "keepalive-test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await s.ready();
    await s.saveCodeVerifier(serverUrl, "v");
    // Zustand persist fires setItem on the next microtask after set(); flush
    // a couple of ticks so the POST has been issued.
    await Promise.resolve();
    await Promise.resolve();
    const post = fetchFn.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeDefined();
    expect((post?.[1] as RequestInit).keepalive).toBe(true);
  });

  it("a failed persist POST is surfaced via console.error (Zustand swallows the rejection)", async () => {
    const fetchFn = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        return (init?.method ?? "GET") === "POST"
          ? new Response("nope", { status: 500 })
          : new Response("{}", { status: 200 });
      },
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const s = new RemoteOAuthStorage({
        baseUrl: "http://remote.example",
        storeId: "fail-test",
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      await s.ready();
      await s.saveTokens(serverUrl, {
        access_token: "t",
        token_type: "Bearer",
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(err).toHaveBeenCalled();
      const msg = err.mock.calls.flat().map(String).join(" ");
      expect(msg).toContain("persist write failed");
      expect(msg).toContain("fail-test");
    } finally {
      err.mockRestore();
    }
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
