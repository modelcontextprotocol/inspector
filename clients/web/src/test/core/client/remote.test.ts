import { describe, it, expect, vi, afterEach } from "vitest";
import {
  loadClientConfigRemote,
  saveClientConfigRemote,
} from "@inspector/core/client/remote.js";
import type { ClientConfig } from "@inspector/core/client/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const validConfig: ClientConfig = {
  enterpriseManagedAuth: {
    idp: { issuer: "https://idp.example.com", clientId: "cid" },
  },
};

/** Build a minimal `Response`-like stub for the mocked fetch. */
function fakeResponse(init: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
}): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: init.json ?? (async () => ({})),
  } as unknown as Response;
}

describe("client remote config", () => {
  describe("loadClientConfigRemote", () => {
    it("parses a populated store and strips the trailing slash from baseUrl", async () => {
      const fetchFn = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, json: async () => validConfig }),
      );
      const config = await loadClientConfigRemote({
        baseUrl: "http://localhost:3000/",
        fetchFn,
      });
      expect(config).toEqual(validConfig);
      expect(fetchFn).toHaveBeenCalledWith(
        "http://localhost:3000/api/storage/client",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("sends the bearer auth header when a token is provided", async () => {
      const fetchFn = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, json: async () => ({}) }),
      );
      await loadClientConfigRemote({
        baseUrl: "http://localhost:3000",
        authToken: "tok",
        fetchFn,
      });
      expect(fetchFn).toHaveBeenCalledWith(
        "http://localhost:3000/api/storage/client",
        expect.objectContaining({
          headers: { "x-mcp-remote-auth": "Bearer tok" },
        }),
      );
    });

    it("returns {} on a 404", async () => {
      const fetchFn = vi.fn(async () =>
        fakeResponse({ ok: false, status: 404 }),
      );
      expect(
        await loadClientConfigRemote({ baseUrl: "http://x", fetchFn }),
      ).toEqual({});
    });

    it("throws on a non-404 error status", async () => {
      const fetchFn = vi.fn(async () =>
        fakeResponse({ ok: false, status: 500 }),
      );
      await expect(
        loadClientConfigRemote({ baseUrl: "http://x", fetchFn }),
      ).rejects.toThrow(/Failed to read client config: 500/);
    });

    it("returns {} when the store is empty or not an object", async () => {
      const emptyObj = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, json: async () => ({}) }),
      );
      expect(
        await loadClientConfigRemote({
          baseUrl: "http://x",
          fetchFn: emptyObj,
        }),
      ).toEqual({});

      const nullJson = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, json: async () => null }),
      );
      expect(
        await loadClientConfigRemote({
          baseUrl: "http://x",
          fetchFn: nullJson,
        }),
      ).toEqual({});
    });
  });

  describe("saveClientConfigRemote", () => {
    it("POSTs the validated, serialized config with content-type and auth headers", async () => {
      const fetchFn = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200 }),
      );
      await saveClientConfigRemote(validConfig, {
        baseUrl: "http://localhost:3000/",
        authToken: "tok",
        fetchFn,
      });
      expect(fetchFn).toHaveBeenCalledWith(
        "http://localhost:3000/api/storage/client",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mcp-remote-auth": "Bearer tok",
          },
          body: JSON.stringify(validConfig, null, 2),
        }),
      );
    });

    it("omits the auth header when no token is given", async () => {
      const fetchFn = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200 }),
      );
      await saveClientConfigRemote(validConfig, {
        baseUrl: "http://x",
        fetchFn,
      });
      expect(fetchFn).toHaveBeenCalledWith(
        "http://x/api/storage/client",
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("throws when the write fails", async () => {
      const fetchFn = vi.fn(async () =>
        fakeResponse({ ok: false, status: 503 }),
      );
      await expect(
        saveClientConfigRemote(validConfig, { baseUrl: "http://x", fetchFn }),
      ).rejects.toThrow(/Failed to write client config: 503/);
    });
  });

  describe("global fetch fallback", () => {
    it("uses globalThis.fetch when no fetchFn is supplied", async () => {
      const globalFetch = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, json: async () => validConfig }),
      );
      vi.stubGlobal("fetch", globalFetch);

      const loaded = await loadClientConfigRemote({ baseUrl: "http://x" });
      expect(loaded).toEqual(validConfig);

      await saveClientConfigRemote(validConfig, { baseUrl: "http://x" });
      expect(globalFetch).toHaveBeenCalledTimes(2);
    });
  });
});
