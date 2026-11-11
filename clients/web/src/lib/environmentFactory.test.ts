import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserNavigation } from "@inspector/core/auth/browser/index.js";
import { MutableRedirectUrlProvider } from "@inspector/core/auth/providers.js";
import { createWebEnvironment } from "./environmentFactory";
import {
  getWebRemoteOAuthStorage,
  resetWebRemoteOAuthStorageCacheForTests,
} from "./remoteOAuthStorage";

describe("createWebEnvironment", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        host: "127.0.0.1:6299",
      },
    });
  });

  afterEach(() => {
    resetWebRemoteOAuthStorageCacheForTests();
    vi.unstubAllGlobals();
  });

  it("wires RemoteOAuthStorage shared with getWebRemoteOAuthStorage", () => {
    const redirectUrlProvider = new MutableRedirectUrlProvider();
    const first = createWebEnvironment("unit-test-token", redirectUrlProvider);
    const second = createWebEnvironment("unit-test-token", redirectUrlProvider);

    expect(first.environment.oauth).toBeDefined();
    expect(second.environment.oauth).toBeDefined();
    expect(second.environment.oauth!.storage).toBe(
      first.environment.oauth!.storage,
    );
    expect(first.environment.oauth!.storage).toBe(
      getWebRemoteOAuthStorage("unit-test-token"),
    );
  });

  it("uses BrowserNavigation for oauth.navigation", () => {
    const { environment } = createWebEnvironment(
      undefined,
      new MutableRedirectUrlProvider(),
    );
    expect(environment.oauth).toBeDefined();
    expect(environment.oauth!.navigation).toBeInstanceOf(BrowserNavigation);
  });

  it("returns the same logger instance as environment.logger", () => {
    const { environment, logger } = createWebEnvironment(
      "tok",
      new MutableRedirectUrlProvider(),
    );
    expect(logger).toBe(environment.logger);
  });

  it("passes redirectUrlProvider into oauth config", () => {
    const redirectUrlProvider = new MutableRedirectUrlProvider();
    redirectUrlProvider.redirectUrl = "http://127.0.0.1:6299/oauth/callback";
    const { environment } = createWebEnvironment("tok", redirectUrlProvider);
    if (!environment.oauth) {
      throw new Error("expected oauth config");
    }
    const { redirectUrlProvider: oauthRedirect } = environment.oauth;
    if (!oauthRedirect) {
      throw new Error("expected redirectUrlProvider");
    }
    expect(oauthRedirect.getRedirectUrl()).toBe(
      "http://127.0.0.1:6299/oauth/callback",
    );
  });

  it("forwards onBeforeOAuthRedirect to BrowserNavigation", () => {
    const onBeforeOAuthRedirect = vi.fn<(authorizationUrl: URL) => void>();
    const { environment } = createWebEnvironment(
      "tok",
      new MutableRedirectUrlProvider(),
      onBeforeOAuthRedirect,
    );
    if (!environment.oauth) {
      throw new Error("expected oauth config");
    }
    const { navigation } = environment.oauth;
    if (!navigation) {
      throw new Error("expected navigation");
    }
    const authUrl = new URL("https://idp.example/authorize?state=abc");
    navigation.navigateToAuthorization(authUrl);
    expect(onBeforeOAuthRedirect).toHaveBeenCalledWith(authUrl);
  });

  it("routes fetch through the wrapped global fetch at the window origin", async () => {
    const remoteBody = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/plain" },
      body: "echoed",
    };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify(remoteBody), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { environment } = createWebEnvironment(
      "api-tok",
      new MutableRedirectUrlProvider(),
    );
    fetchMock.mockClear();

    const res = await environment.fetch!("http://upstream.test/mcp");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("echoed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:6299/api/fetch",
    );
  });

  it("labels the transport's backend session with the server name (#2831)", async () => {
    // The connect is refused, so the transport never opens an event stream;
    // only the body it sent matters here.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const { environment } = createWebEnvironment(
      "api-tok",
      new MutableRedirectUrlProvider(),
      undefined,
      "My Server",
    );
    const { transport } = environment.transport(
      { type: "stdio", command: "node" },
      {},
    );
    await expect(transport.start()).rejects.toThrow(/Remote connect failed/);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:6299/api/mcp/connect");
    expect(JSON.parse(init!.body as string)).toMatchObject({
      serverName: "My Server",
    });
  });
});
