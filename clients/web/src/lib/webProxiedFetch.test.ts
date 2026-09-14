import { describe, it, expect, beforeEach, vi } from "vitest";

const { createRemoteFetchMock } = vi.hoisted(() => ({
  createRemoteFetchMock: vi.fn(),
}));

vi.mock("@inspector/core/mcp/remote/index.js", () => ({
  createRemoteFetch: createRemoteFetchMock,
}));

import {
  getWebProxiedFetch,
  resetWebProxiedFetchCacheForTests,
} from "./webProxiedFetch";

describe("getWebProxiedFetch", () => {
  beforeEach(() => {
    resetWebProxiedFetchCacheForTests();
    createRemoteFetchMock.mockReset();
    createRemoteFetchMock.mockImplementation(() => vi.fn());
  });

  it("builds a remote fetch against the page origin and the API token", () => {
    getWebProxiedFetch("tok");
    expect(createRemoteFetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: `${window.location.protocol}//${window.location.host}`,
        authToken: "tok",
      }),
    );
  });

  it("reuses the instance for the same origin and token", () => {
    const first = getWebProxiedFetch("tok");
    expect(getWebProxiedFetch("tok")).toBe(first);
    expect(createRemoteFetchMock).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when the token changes", () => {
    const first = getWebProxiedFetch("tok");
    expect(getWebProxiedFetch("other")).not.toBe(first);
    expect(createRemoteFetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when window is unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(() => getWebProxiedFetch()).toThrow(
      "getWebProxiedFetch requires a browser environment",
    );
    vi.unstubAllGlobals();
  });

  it("forwards a fetch that reaches the injected base fetch", async () => {
    const inner = vi.fn<typeof fetch>(async () => new Response(null));
    createRemoteFetchMock.mockImplementation(
      ({ fetchFn }: { fetchFn: typeof fetch }) => fetchFn,
    );
    const proxied = getWebProxiedFetch();
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(inner as typeof fetch);
    await proxied("https://example.com");
    expect(inner).toHaveBeenCalled();
    globalFetch.mockRestore();
  });
});
