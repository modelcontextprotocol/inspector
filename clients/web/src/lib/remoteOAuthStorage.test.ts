import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRemoteOAuthStorage,
  getWebRemoteOAuthStorage,
  resetWebRemoteOAuthStorageCacheForTests,
} from "./remoteOAuthStorage";

describe("remoteOAuthStorage", () => {
  afterEach(() => {
    resetWebRemoteOAuthStorageCacheForTests();
  });

  it("returns one RemoteOAuthStorage instance per cache key", () => {
    const a = getRemoteOAuthStorage({
      baseUrl: "http://127.0.0.1:6277",
      authToken: "tok-a",
    });
    const aAgain = getRemoteOAuthStorage({
      baseUrl: "http://127.0.0.1:6277",
      authToken: "tok-a",
    });
    const b = getRemoteOAuthStorage({
      baseUrl: "http://127.0.0.1:6277",
      authToken: "tok-b",
    });

    expect(aAgain).toBe(a);
    expect(b).not.toBe(a);
  });

  it("getWebRemoteOAuthStorage uses window.location origin", () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        host: "127.0.0.1:6299",
      },
    });

    const storage = getWebRemoteOAuthStorage("smoke-web-token");
    const again = getWebRemoteOAuthStorage("smoke-web-token");

    expect(again).toBe(storage);
    vi.unstubAllGlobals();
  });

  it("throws when window is unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(() => getWebRemoteOAuthStorage()).toThrow(
      "getWebRemoteOAuthStorage requires a browser environment",
    );
    vi.unstubAllGlobals();
  });

  it("creates a new instance after the test cache reset", () => {
    const first = getRemoteOAuthStorage({
      baseUrl: "http://127.0.0.1:6277",
      authToken: "reset-me",
    });
    resetWebRemoteOAuthStorageCacheForTests();
    const second = getRemoteOAuthStorage({
      baseUrl: "http://127.0.0.1:6277",
      authToken: "reset-me",
    });
    expect(second).not.toBe(first);
  });
});
