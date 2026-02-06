import { createProxyFetch } from "../proxyFetch";
import { DEFAULT_INSPECTOR_CONFIG } from "../constants";
import type { InspectorConfig } from "../configurationTypes";

describe("createProxyFetch", () => {
  const mockFetch = jest.fn();
  const proxyAddress = "http://localhost:6277";

  const configWithProxy: InspectorConfig = {
    ...DEFAULT_INSPECTOR_CONFIG,
    MCP_PROXY_FULL_ADDRESS: {
      ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_FULL_ADDRESS,
      value: proxyAddress,
    },
    MCP_PROXY_AUTH_TOKEN: {
      ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
      value: "test-proxy-token",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
  });

  it("returns a function", () => {
    const fetchFn = createProxyFetch(configWithProxy);
    expect(typeof fetchFn).toBe("function");
  });

  it("sends POST to proxy /fetch endpoint with correct headers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: {},
          body: "response body",
        }),
    });

    const fetchFn = createProxyFetch(configWithProxy);
    await fetchFn("https://example.com/.well-known/oauth-authorization-server");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(`${proxyAddress}/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MCP-Proxy-Auth": "Bearer test-proxy-token",
      },
      body: expect.any(String),
    });
  });

  it("includes target url and init in request body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          body: '{"issuer":"https://example.com"}',
        }),
    });

    const fetchFn = createProxyFetch(configWithProxy);
    await fetchFn("https://example.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=abc",
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({
      url: "https://example.com/oauth/token",
      init: {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code=abc",
      },
    });
  });

  it("reconstructs Response from proxy response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          body: '{"issuer":"https://example.com"}',
        }),
    });

    const fetchFn = createProxyFetch(configWithProxy);
    const response = await fetchFn(
      "https://example.com/.well-known/oauth-authorization-server",
    );

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.statusText).toBe("OK");
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.text();
    expect(body).toBe('{"issuer":"https://example.com"}');
  });

  it("throws when proxy returns non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: "Unauthorized",
    });

    const fetchFn = createProxyFetch(configWithProxy);
    await expect(fetchFn("https://example.com/")).rejects.toThrow(
      "Proxy fetch failed: Unauthorized",
    );
  });

  it("uses URL object as input", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: {},
          body: "",
        }),
    });

    const fetchFn = createProxyFetch(configWithProxy);
    await fetchFn(new URL("https://example.com/discovery"));

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.url).toBe("https://example.com/discovery");
  });
});
