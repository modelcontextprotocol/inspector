import { describe, it, expect, vi } from "vitest";
import { RemoteOAuthStorage } from "@inspector/core/auth/remote/index.js";
import {
  getRemoteOAuthStorage,
  getWebOAuthBaseUrl,
  webOAuthFetch,
} from "./remoteOAuthStorage";

const NOOP_FETCH = vi.fn(
  async () =>
    new Response(JSON.stringify({ state: { servers: {} }, version: 0 }), {
      status: 200,
    }),
) as unknown as typeof fetch;

describe("remoteOAuthStorage", () => {
  it("getWebOAuthBaseUrl derives the backend origin from window.location", () => {
    expect(getWebOAuthBaseUrl()).toBe(
      `${window.location.protocol}//${window.location.host}`,
    );
  });

  it("returns a RemoteOAuthStorage instance", () => {
    const storage = getRemoteOAuthStorage(
      "http://a.example",
      undefined,
      NOOP_FETCH,
    );
    expect(storage).toBeInstanceOf(RemoteOAuthStorage);
  });

  it("memoizes one instance per {baseUrl, authToken}", () => {
    const a1 = getRemoteOAuthStorage("http://memo.example", "tok", NOOP_FETCH);
    const a2 = getRemoteOAuthStorage("http://memo.example", "tok", NOOP_FETCH);
    expect(a1).toBe(a2);

    // A different auth token is a distinct key → distinct instance.
    const b = getRemoteOAuthStorage("http://memo.example", "other", NOOP_FETCH);
    expect(b).not.toBe(a1);

    // A different base URL is a distinct key → distinct instance.
    const c = getRemoteOAuthStorage("http://memo2.example", "tok", NOOP_FETCH);
    expect(c).not.toBe(a1);
  });

  it("treats an undefined authToken as its own stable key", () => {
    const a = getRemoteOAuthStorage("http://undef.example", undefined);
    const b = getRemoteOAuthStorage("http://undef.example", undefined);
    expect(a).toBe(b);
  });

  it("webOAuthFetch delegates to globalThis.fetch preserving the receiver", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
    try {
      const res = await webOAuthFetch("http://x.example");
      expect(spy).toHaveBeenCalledWith("http://x.example");
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });
});
