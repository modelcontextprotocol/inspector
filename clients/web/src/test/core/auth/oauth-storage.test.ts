import { describe, it, expect, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import { OAuthStorageBase } from "@inspector/core/auth/oauth-storage.js";
import { createOAuthStore } from "@inspector/core/auth/store.js";

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
    } finally {
      warn.mockRestore();
    }
  });
});
