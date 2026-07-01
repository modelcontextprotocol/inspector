import { describe, it, expect, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import { OAuthStorageBase } from "@inspector/core/auth/oauth-storage.js";
import {
  createOAuthStore,
  normalizeServerUrl,
} from "@inspector/core/auth/store.js";

/**
 * Builds an OAuthStorageBase backed by an *async* in-memory storage adapter
 * pre-seeded with the given persisted blob. Hydration of the store completes
 * only after the returned `release()` is called, so tests can assert that
 * getters wait for it.
 */
function makeAsyncBackedStorage(
  persistedServers: Record<string, unknown> = {},
) {
  let mem: string | null = JSON.stringify({
    state: { servers: persistedServers },
    version: 0,
  });
  let releaseGetItem!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGetItem = resolve;
  });
  const adapter = createJSONStorage(() => ({
    getItem: async () => {
      await gate;
      return mem;
    },
    setItem: async (name: string, value: string) => {
      void name;
      mem = value;
    },
    removeItem: async () => {
      mem = null;
    },
  }));
  const store = createOAuthStore(adapter);
  return { storage: new OAuthStorageBase(store), release: releaseGetItem };
}

const SERVER = "https://example.com/mcp";
const METADATA = {
  issuer: SERVER,
  authorization_endpoint: `${SERVER}/authorize`,
  token_endpoint: `${SERVER}/token`,
  response_types_supported: ["code"],
};

describe("OAuthStorageBase — async hydration", () => {
  it("getCodeVerifier awaits hydration before reading state", async () => {
    const { storage, release } = makeAsyncBackedStorage({
      [SERVER]: { codeVerifier: "persisted-verifier" },
    });
    // The store is empty until release() lets the async getItem resolve.
    let resolvedWith: string | undefined | "pending" = "pending";
    const p = storage.getCodeVerifier(SERVER).then((v) => {
      resolvedWith = v;
    });
    // Give the microtask queue a chance — the getter should NOT have resolved
    // because hydration is still gated.
    await Promise.resolve();
    expect(resolvedWith).toBe("pending");
    release();
    await p;
    expect(resolvedWith).toBe("persisted-verifier");
  });

  it("getServerMetadata awaits hydration before reading state", async () => {
    const { storage, release } = makeAsyncBackedStorage({
      [SERVER]: { serverMetadata: METADATA },
    });
    const p = storage.getServerMetadata(SERVER);
    release();
    expect(await p).toEqual(METADATA);
  });

  it("getTokens and getClientInformation await hydration", async () => {
    const { storage, release } = makeAsyncBackedStorage({
      [SERVER]: {
        tokens: { access_token: "t", token_type: "Bearer" },
        clientInformation: { client_id: "abc" },
      },
    });
    const tokens = storage.getTokens(SERVER);
    const client = storage.getClientInformation(SERVER);
    release();
    expect(await tokens).toEqual({ access_token: "t", token_type: "Bearer" });
    expect(await client).toEqual({ client_id: "abc" });
  });

  it("ready() resolves once hydration completes", async () => {
    const { storage, release } = makeAsyncBackedStorage();
    let ready = false;
    void storage.ready().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    release();
    await storage.ready();
    expect(ready).toBe(true);
  });

  it("ready() resolves promptly when the adapter is synchronous", async () => {
    let mem: string | null = null;
    const syncAdapter = createJSONStorage(() => ({
      getItem: () => mem,
      setItem: (name: string, value: string) => {
        void name;
        mem = value;
      },
      removeItem: () => {
        mem = null;
      },
    }));
    const storage = new OAuthStorageBase(createOAuthStore(syncAdapter));
    // With a sync adapter the constructor's rehydrate() resolves on the next
    // microtask, so ready() and the getters settle without any release step.
    await storage.ready();
    expect(await storage.getCodeVerifier(SERVER)).toBeUndefined();
  });

  it("save* awaits hydration so a late merge cannot clobber the write", async () => {
    const { storage, release } = makeAsyncBackedStorage({
      [SERVER]: { codeVerifier: "persisted-old" },
    });
    // Kick off a save while hydration is still gated. It must not write until
    // hydration completes, otherwise the persist merge would overwrite "new"
    // with "persisted-old".
    const save = storage.saveCodeVerifier(SERVER, "new");
    let saved = false;
    void save.then(() => {
      saved = true;
    });
    await Promise.resolve();
    expect(saved).toBe(false);
    release();
    await save;
    expect(await storage.getCodeVerifier(SERVER)).toBe("new");
  });

  it("clear() before hydration is not resurrected by the late merge", async () => {
    // A clear issued while hydration is still gated must survive the pending
    // rehydrate() that would otherwise merge the persisted (un-cleared) blob
    // back on top and silently restore the credential.
    const { storage, release } = makeAsyncBackedStorage({
      [SERVER]: { tokens: { access_token: "t", token_type: "Bearer" } },
    });
    storage.clear(SERVER);
    release();
    await storage.ready();
    // Give the deferred re-apply (scheduled off `hydrated`) a microtask to run.
    await Promise.resolve();
    expect(await storage.getTokens(SERVER)).toBeUndefined();
  });

  it("clearTokens before hydration clears only tokens and survives the merge", async () => {
    const { storage, release } = makeAsyncBackedStorage({
      [SERVER]: {
        tokens: { access_token: "t", token_type: "Bearer" },
        codeVerifier: "keep-me",
      },
    });
    storage.clearTokens(SERVER);
    release();
    await storage.ready();
    await Promise.resolve();
    // Tokens cleared, but the sibling field from the persisted blob remains.
    expect(await storage.getTokens(SERVER)).toBeUndefined();
    expect(await storage.getCodeVerifier(SERVER)).toBe("keep-me");
  });

  it("clear() after hydration does not schedule a deferred re-apply", async () => {
    const { storage, release } = makeAsyncBackedStorage({
      [SERVER]: { tokens: { access_token: "t", token_type: "Bearer" } },
    });
    release();
    await storage.ready();
    // Hydration already settled → synchronous clear, immediately observable.
    storage.clear(SERVER);
    expect(await storage.getTokens(SERVER)).toBeUndefined();
  });

  it("normalizeServerUrl canonicalizes host case, bare-origin trailing slash, default port, and whitespace", () => {
    expect(normalizeServerUrl("https://Example.COM/mcp")).toBe(
      "https://example.com/mcp",
    );
    expect(normalizeServerUrl("https://example.com")).toBe(
      "https://example.com/",
    );
    expect(normalizeServerUrl("https://example.com:443/mcp")).toBe(
      "https://example.com/mcp",
    );
    expect(normalizeServerUrl("  https://example.com/mcp  ")).toBe(
      "https://example.com/mcp",
    );
    // Non-URL strings (e.g. a stdio server name) are passed through trimmed.
    expect(normalizeServerUrl("  my-stdio-server  ")).toBe("my-stdio-server");
  });

  it("store keys are normalized so save and get tolerate cosmetic URL differences", async () => {
    const { storage, release } = makeAsyncBackedStorage();
    release();
    await storage.saveCodeVerifier("https://Example.COM/mcp", "v");
    expect(await storage.getCodeVerifier("https://example.com/mcp")).toBe("v");
    // Bare-origin: the web inspector stores `new URL().href` (trailing slash);
    // a CLI caller passing the slash-less form must still hit it.
    await storage.saveTokens("https://api.partner.dev/", {
      access_token: "t",
      token_type: "Bearer",
    });
    expect(await storage.getTokens("https://api.partner.dev")).toEqual({
      access_token: "t",
      token_type: "Bearer",
    });
  });

  it("a partial write migrates a pre-normalization raw-key blob onto the canonical key (no orphaned fields)", async () => {
    // Persisted under the bare-origin raw key (no trailing slash), the form a
    // pre-normalization writer used; canonical form is `https://api.partner.dev/`.
    // The caller consistently addresses the endpoint with that same raw string
    // (matching getServerState's raw-key fallback).
    const RAW = "https://api.partner.dev";
    const { storage, release } = makeAsyncBackedStorage({
      [RAW]: { tokens: { access_token: "existing", token_type: "Bearer" } },
    });
    release();
    await storage.ready();
    // A partial write must MERGE onto the existing blob, not shadow it with a
    // fresh canonical entry — the pre-existing token must remain reachable.
    await storage.saveCodeVerifier(RAW, "v");
    expect(await storage.getCodeVerifier(RAW)).toBe("v");
    expect(await storage.getTokens(RAW)).toEqual({
      access_token: "existing",
      token_type: "Bearer",
    });
    // The blob now lives under the canonical key, so the canonical form finds it
    // too and the raw-key orphan no longer shadows anything.
    expect(await storage.getTokens("https://api.partner.dev/")).toEqual({
      access_token: "existing",
      token_type: "Bearer",
    });
  });

  it("clear() removes a pre-normalization raw-key blob, not just the canonical key", async () => {
    const RAW = "https://api.partner.dev";
    const { storage, release } = makeAsyncBackedStorage({
      [RAW]: { tokens: { access_token: "existing", token_type: "Bearer" } },
    });
    release();
    await storage.ready();
    storage.clear(RAW);
    // Both the canonical and raw keys must be gone — no orphan resurfacing via
    // getServerState's raw-key fallback.
    expect(await storage.getTokens(RAW)).toBeUndefined();
    expect(await storage.getTokens("https://api.partner.dev/")).toBeUndefined();
  });

  it("getServerState falls back to a pre-normalization persisted key", async () => {
    // A blob persisted before normalization existed may carry a raw key that
    // the canonical form differs from (here: bare-origin without slash).
    const { storage, release } = makeAsyncBackedStorage({
      "https://legacy.example": { codeVerifier: "legacy" },
    });
    release();
    expect(await storage.getCodeVerifier("https://legacy.example")).toBe(
      "legacy",
    );
  });

  it("ready()/getters resolve (empty) when the adapter throws instead of hanging", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const throwingAdapter = createJSONStorage(() => ({
        getItem: async () => {
          throw new Error("Failed to read store: 500");
        },
        setItem: async () => {},
        removeItem: async () => {},
      }));
      const storage = new OAuthStorageBase(createOAuthStore(throwingAdapter));
      // Race ready() against a short timeout — if the catch path doesn't
      // resolve `hydrated`, this would hit "TIMEOUT" instead of "ok".
      const result = await Promise.race([
        storage.ready().then(() => "ok"),
        new Promise((r) => setTimeout(() => r("TIMEOUT"), 200)),
      ]);
      expect(result).toBe("ok");
      expect(await storage.getTokens(SERVER)).toBeUndefined();
      expect(warn).toHaveBeenCalled();
      // The failure is recorded so callers can distinguish "no token" from
      // "store unreadable".
      expect(storage.getHydrationError()).toBeInstanceOf(Error);
    } finally {
      warn.mockRestore();
    }
  });

  it("getHydrationError() is undefined after a successful hydration", async () => {
    const { storage, release } = makeAsyncBackedStorage();
    release();
    await storage.ready();
    expect(storage.getHydrationError()).toBeUndefined();
  });
});
