import { describe, it, expect, vi } from "vitest";
import {
  parseOAuthPersistBlob,
  serializeOAuthPersistBlob,
  mergeOAuthSections,
  parseOAuthPersistSections,
  parseOAuthStoreWriteBody,
  serializeOAuthSectionedWrite,
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

  it("rejects malformed entry maps instead of coercing them", () => {
    // `{ servers: ["bad"] }` used to be accepted and then coerced into
    // nonsensical entries downstream; a map that is not a record of records
    // must reject the whole payload (400 on the route, unreadable on disk).
    expect(
      parseOAuthPersistBlob({ servers: ["bad"], idpSessions: {} }),
    ).toBeNull();
    expect(parseOAuthPersistBlob({ servers: "nope" })).toBeNull();
    expect(
      parseOAuthPersistBlob({ idpSessions: { issuer: "scalar" } }),
    ).toBeNull();
    expect(
      parseOAuthPersistBlob({ state: { servers: ["bad"] }, version: 0 }),
    ).toBeNull();
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

describe("mergeOAuthSections", () => {
  const disk: OAuthPersistSnapshot = {
    servers: {
      "http://a": { scope: "a-disk" },
      "http://b": { scope: "b-disk" },
    },
    idpSessions: { "https://idp1": { idToken: "disk-1" } },
  };

  it("overlays only the named server entries, keeping the rest from disk", () => {
    const snapshot: OAuthPersistSnapshot = {
      // Stale memory: never saw http://b, has an outdated http://a it did not
      // mutate — only the named entry may land.
      servers: { "http://c": { scope: "c-mem" }, "http://a": { scope: "old" } },
      idpSessions: {},
    };
    const merged = mergeOAuthSections(disk, snapshot, {
      servers: ["http://c"],
    });
    expect(merged).toEqual({
      servers: {
        "http://a": { scope: "a-disk" },
        "http://b": { scope: "b-disk" },
        "http://c": { scope: "c-mem" },
      },
      idpSessions: { "https://idp1": { idToken: "disk-1" } },
    });
  });

  it("treats a named key absent from the snapshot as a deletion", () => {
    const snapshot: OAuthPersistSnapshot = { servers: {}, idpSessions: {} };
    const merged = mergeOAuthSections(disk, snapshot, {
      servers: ["http://a"],
      idpSessions: ["https://idp1"],
    });
    expect(merged).toEqual({
      servers: { "http://b": { scope: "b-disk" } },
      idpSessions: {},
    });
  });

  it("overlays named idpSessions independently of servers", () => {
    const snapshot: OAuthPersistSnapshot = {
      servers: {},
      idpSessions: {
        "https://idp1": { idToken: "mem-1" },
        "https://idp2": { idToken: "mem-2" },
      },
    };
    const merged = mergeOAuthSections(disk, snapshot, {
      idpSessions: ["https://idp2"],
    });
    expect(merged.servers).toEqual(disk.servers);
    expect(merged.idpSessions).toEqual({
      "https://idp1": { idToken: "disk-1" },
      "https://idp2": { idToken: "mem-2" },
    });
  });

  it("starts from an empty store when disk is null (first write)", () => {
    const snapshot: OAuthPersistSnapshot = {
      servers: { "http://a": { scope: "mem" } },
      idpSessions: {},
    };
    expect(
      mergeOAuthSections(null, snapshot, { servers: ["http://a"] }),
    ).toEqual({
      servers: { "http://a": { scope: "mem" } },
      idpSessions: {},
    });
  });

  it("keeps a __proto__ key as an own entry instead of hitting the prototype setter", () => {
    // JSON.parse produces "__proto__" as an own key; a plain assignment
    // while merging would invoke the inherited setter, silently dropping
    // the entry (and orphaning its already-split secrets).
    const snapshot: OAuthPersistSnapshot = {
      servers: JSON.parse('{"__proto__": {"scope": "evil-name"}}'),
      idpSessions: JSON.parse('{"__proto__": {"idToken": "t"}}'),
    };
    const merged = mergeOAuthSections(null, snapshot, {
      servers: ["__proto__"],
      idpSessions: ["__proto__"],
    });
    expect(Object.hasOwn(merged.servers, "__proto__")).toBe(true);
    expect(Object.hasOwn(merged.idpSessions, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(merged.servers)).toBe(Object.prototype);
    // Serialization must carry the entry.
    expect(JSON.stringify(merged)).toContain("evil-name");
  });

  it("propagates a clear of a __proto__ entry instead of resurrecting it", () => {
    // After a clear, `snapshot.servers` is `{}` — a plain lookup for
    // "__proto__" would return the inherited `Object.prototype`, turning
    // the deletion into an update that re-creates an empty entry.
    const diskWithProto: OAuthPersistSnapshot = {
      servers: JSON.parse('{"__proto__": {"scope": "stale"}}'),
      idpSessions: JSON.parse('{"__proto__": {"idToken": "stale"}}'),
    };
    const merged = mergeOAuthSections(
      diskWithProto,
      { servers: {}, idpSessions: {} },
      { servers: ["__proto__"], idpSessions: ["__proto__"] },
    );
    expect(Object.hasOwn(merged.servers, "__proto__")).toBe(false);
    expect(Object.hasOwn(merged.idpSessions, "__proto__")).toBe(false);
    expect(JSON.stringify(merged)).not.toContain("stale");
  });
});

describe("parseOAuthPersistSections", () => {
  it("parses servers and idpSessions string arrays", () => {
    expect(
      parseOAuthPersistSections({
        servers: ["http://a"],
        idpSessions: ["https://i"],
      }),
    ).toEqual({ servers: ["http://a"], idpSessions: ["https://i"] });
  });

  it("accepts either key alone or an empty object", () => {
    expect(parseOAuthPersistSections({ servers: [] })).toEqual({
      servers: [],
    });
    expect(parseOAuthPersistSections({})).toEqual({});
  });

  it("rejects non-objects and non-string-array values", () => {
    expect(parseOAuthPersistSections("a string")).toBeNull();
    expect(parseOAuthPersistSections(null)).toBeNull();
    expect(parseOAuthPersistSections({ servers: "http://a" })).toBeNull();
    expect(parseOAuthPersistSections({ servers: [1] })).toBeNull();
    expect(parseOAuthPersistSections({ idpSessions: {} })).toBeNull();
  });

  it("rejects unknown keys so a typo cannot become a silent no-op", () => {
    expect(parseOAuthPersistSections({ server: ["http://a"] })).toBeNull();
    expect(
      parseOAuthPersistSections({ servers: ["http://a"], extra: true }),
    ).toBeNull();
  });
});

describe("parseOAuthStoreWriteBody", () => {
  const SNAP = { servers: {}, idpSessions: {} };

  it("treats a bare blob as a full replacement", () => {
    expect(parseOAuthStoreWriteBody(SNAP)).toEqual({ snapshot: SNAP });
  });

  it("parses a { sections, snapshot } envelope", () => {
    expect(
      parseOAuthStoreWriteBody({
        sections: { servers: ["http://a"] },
        snapshot: SNAP,
      }),
    ).toEqual({ sections: { servers: ["http://a"] }, snapshot: SNAP });
  });

  it("round-trips serializeOAuthSectionedWrite", () => {
    const sections = { servers: ["http://a"] };
    expect(
      parseOAuthStoreWriteBody(
        JSON.parse(serializeOAuthSectionedWrite(SNAPSHOT, sections)),
      ),
    ).toEqual({ sections, snapshot: SNAPSHOT });
  });

  it("rejects bad envelopes and non-OAuth bodies", () => {
    // A `sections` key marks an envelope: a bad descriptor or missing
    // snapshot must not fall back to a full replacement.
    expect(
      parseOAuthStoreWriteBody({
        sections: { servers: "nope" },
        snapshot: SNAP,
      }),
    ).toBeNull();
    expect(parseOAuthStoreWriteBody({ sections: { servers: [] } })).toBeNull();
    expect(parseOAuthStoreWriteBody({ someOtherStore: true })).toBeNull();
    expect(parseOAuthStoreWriteBody("not an object")).toBeNull();
    // Malformed maps inside either form reject the write, not coerce it.
    expect(parseOAuthStoreWriteBody({ servers: ["bad"] })).toBeNull();
    expect(
      parseOAuthStoreWriteBody({
        sections: { servers: ["http://a"] },
        snapshot: { servers: ["bad"], idpSessions: {} },
      }),
    ).toBeNull();
  });

  it("rejects an envelope carrying unknown keys", () => {
    expect(
      parseOAuthStoreWriteBody({
        sections: { servers: ["http://a"] },
        snapshot: SNAP,
        extra: 1,
      }),
    ).toBeNull();
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

  it("write() with sections carries them in the body envelope", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      capturedUrl = String(input);
      capturedBody = init?.body as string | undefined;
      return new Response("", { status: 200 });
    });
    const backend = createRemoteOAuthPersistBackend({
      baseUrl,
      storeId,
      fetchFn,
    });
    const sections = { servers: ["http://s"] };
    await backend.write(SNAPSHOT, sections);
    // In the body, not the URL: a descriptor naming many server URLs
    // would otherwise exceed Node's request-target limit.
    const parsed = new URL(capturedUrl ?? "");
    expect(parsed.pathname).toBe(`/api/storage/${storeId}`);
    expect(parsed.search).toBe("");
    expect(JSON.parse(capturedBody ?? "")).toEqual({
      sections,
      snapshot: SNAPSHOT,
    });
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
