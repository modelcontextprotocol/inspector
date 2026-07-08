import { describe, it, expect, vi } from "vitest";
import {
  parseOAuthPersistBlob,
  serializeOAuthPersistBlob,
  createRemoteOAuthPersistBackend,
  createSessionOAuthPersistBackend,
  OAUTH_PERSIST_STORAGE_KEY,
} from "@inspector/core/auth/oauth-persist.js";
import type { OAuthPersistSnapshot } from "@inspector/core/auth/oauth-persist.js";

const SNAPSHOT: OAuthPersistSnapshot = {
  servers: { "http://s": { scope: "read" } },
  idpSessions: {},
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("parseOAuthPersistBlob", () => {
  it("returns null for empty input", () => {
    expect(parseOAuthPersistBlob(null)).toBeNull();
  });

  it("returns null for an empty object (server missing-file response)", () => {
    // The remote read() path relies on this: the server answers a missing
    // store with `c.json({}, 200)`, and the backend passes that straight
    // through instead of special-casing an empty object.
    expect(parseOAuthPersistBlob({})).toBeNull();
  });

  it("reads plain JSON with servers and idpSessions", () => {
    const snapshot = {
      servers: {
        "http://example.com": { codeVerifier: "v1" },
      },
      idpSessions: {
        "https://idp.example": { idToken: "token" },
      },
    };
    expect(parseOAuthPersistBlob(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("accepts an already-parsed object without re-serializing", () => {
    const snapshot = {
      servers: {
        "http://example.com": { codeVerifier: "v1" },
      },
      idpSessions: {},
    };
    expect(parseOAuthPersistBlob(snapshot)).toEqual(snapshot);
  });

  it("promotes legacy persist envelope state to the top level", () => {
    const legacy = {
      state: {
        servers: {
          "http://example.com": {
            tokens: { access_token: "t", token_type: "Bearer" },
          },
        },
        idpSessions: {},
      },
      version: 0,
    };
    expect(parseOAuthPersistBlob(JSON.stringify(legacy))).toEqual({
      servers: legacy.state.servers,
      idpSessions: {},
    });
  });
});

describe("serializeOAuthPersistBlob", () => {
  it("writes plain JSON without a state/version envelope", () => {
    const snapshot = {
      servers: { "http://example.com": { scope: "read" } },
      idpSessions: {},
    };
    const raw = serializeOAuthPersistBlob(snapshot);
    expect(JSON.parse(raw)).toEqual(snapshot);
    expect(raw).not.toContain('"version"');
    expect(raw).not.toMatch(/"state"\s*:/);
  });
});

describe("createRemoteOAuthPersistBackend", () => {
  const baseUrl = "http://remote.example/";
  const storeId = "oauth";
  const url = "http://remote.example/api/storage/oauth";

  it("read() returns the parsed snapshot and sends the auth header", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(SNAPSHOT));
    const backend = createRemoteOAuthPersistBackend({
      baseUrl,
      storeId,
      authToken: "tok",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(await backend.read()).toEqual(SNAPSHOT);
    expect(fetchFn).toHaveBeenCalledWith(url, {
      method: "GET",
      headers: { "x-mcp-remote-auth": "Bearer tok" },
    });
  });

  it("read() returns null for the empty-object missing-file response", async () => {
    const backend = createRemoteOAuthPersistBackend({
      baseUrl,
      storeId,
      fetchFn: (async () => jsonResponse({})) as unknown as typeof fetch,
    });
    expect(await backend.read()).toBeNull();
  });

  it("read() returns null on 404 and throws on other errors", async () => {
    const notFound = createRemoteOAuthPersistBackend({
      baseUrl,
      storeId,
      fetchFn: (async () =>
        new Response("", { status: 404 })) as unknown as typeof fetch,
    });
    expect(await notFound.read()).toBeNull();

    const failing = createRemoteOAuthPersistBackend({
      baseUrl,
      storeId,
      fetchFn: (async () =>
        new Response("", { status: 500 })) as unknown as typeof fetch,
    });
    await expect(failing.read()).rejects.toThrow(/Failed to read store: 500/);
  });

  it("write() POSTs the serialized snapshot and throws on failure", async () => {
    let capturedBody: string | undefined;
    const ok = vi.fn<typeof fetch>(async (_input, init) => {
      capturedBody = init?.body as string | undefined;
      return new Response("", { status: 200 });
    });
    const backend = createRemoteOAuthPersistBackend({
      baseUrl,
      storeId,
      fetchFn: ok,
    });
    await backend.write(SNAPSHOT);
    expect(ok).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(capturedBody ?? "")).toEqual(SNAPSHOT);

    const failing = createRemoteOAuthPersistBackend({
      baseUrl,
      storeId,
      fetchFn: (async () =>
        new Response("", { status: 500 })) as unknown as typeof fetch,
    });
    await expect(failing.write(SNAPSHOT)).rejects.toThrow(
      /Failed to write store: 500/,
    );
  });

  it("remove() DELETEs, tolerates 404, and throws on other errors", async () => {
    const ok = createRemoteOAuthPersistBackend({
      baseUrl,
      storeId,
      authToken: "tok",
      fetchFn: (async () =>
        new Response("", { status: 200 })) as unknown as typeof fetch,
    });
    await expect(ok.remove!()).resolves.toBeUndefined();

    const gone = createRemoteOAuthPersistBackend({
      baseUrl,
      storeId,
      fetchFn: (async () =>
        new Response("", { status: 404 })) as unknown as typeof fetch,
    });
    await expect(gone.remove!()).resolves.toBeUndefined();

    const failing = createRemoteOAuthPersistBackend({
      baseUrl,
      storeId,
      fetchFn: (async () =>
        new Response("", { status: 500 })) as unknown as typeof fetch,
    });
    await expect(failing.remove!()).rejects.toThrow(
      /Failed to delete store: 500/,
    );
  });
});

describe("createSessionOAuthPersistBackend", () => {
  function fakeStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      map,
    } as unknown as Storage & { map: Map<string, string> };
  }

  it("round-trips a snapshot through the default storage key", async () => {
    const storage = fakeStorage();
    const backend = createSessionOAuthPersistBackend({
      getStorage: () => storage,
    });
    expect(await backend.read()).toBeNull();
    await backend.write(SNAPSHOT);
    expect(storage.map.has(OAUTH_PERSIST_STORAGE_KEY)).toBe(true);
    expect(await backend.read()).toEqual(SNAPSHOT);
    await backend.remove!();
    expect(await backend.read()).toBeNull();
  });

  it("honors a custom storage key", async () => {
    const storage = fakeStorage();
    const backend = createSessionOAuthPersistBackend({
      storageKey: "custom-key",
      getStorage: () => storage,
    });
    await backend.write(SNAPSHOT);
    expect(storage.map.has("custom-key")).toBe(true);
  });
});
