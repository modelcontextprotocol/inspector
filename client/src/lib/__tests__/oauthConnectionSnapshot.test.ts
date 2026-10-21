import {
  OAuthConnectionSnapshot,
  clearOAuthConnectionSnapshot,
  getOAuthCallbackSnapshot,
  getOAuthReconnectRefusal,
  isOAuthCallbackPath,
  readOAuthConnectionSnapshot,
  saveOAuthConnectionSnapshot,
} from "../oauthConnectionSnapshot";
import { InspectorOAuthClientProvider } from "../auth";

jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  discoverAuthorizationServerMetadata: jest.fn(),
}));

const SNAPSHOT: OAuthConnectionSnapshot = {
  serverUrl: "https://remote.example/mcp",
  transportType: "streamable-http",
  connectionType: "proxy",
  command: "",
  args: "",
  proxyAddress: "http://localhost:6277",
};

const LIVE = {
  authorizedServerUrl: SNAPSHOT.serverUrl,
  sseUrl: SNAPSHOT.serverUrl,
  transportType: SNAPSHOT.transportType,
  connectionType: SNAPSHOT.connectionType,
  proxyAddress: SNAPSHOT.proxyAddress,
};

describe("oauthConnectionSnapshot", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  test("isOAuthCallbackPath matches exactly the routes App renders as callbacks", () => {
    expect(isOAuthCallbackPath("/oauth/callback")).toBe(true);
    expect(isOAuthCallbackPath("/oauth/callback/debug")).toBe(true);
    expect(isOAuthCallbackPath("/")).toBe(false);
    expect(isOAuthCallbackPath("/oauth/callback/")).toBe(false);
    expect(isOAuthCallbackPath("/oauth/callbackx")).toBe(false);
  });

  test("round-trips through sessionStorage and clears", () => {
    saveOAuthConnectionSnapshot(SNAPSHOT);
    expect(readOAuthConnectionSnapshot()).toEqual(SNAPSHOT);
    clearOAuthConnectionSnapshot();
    expect(readOAuthConnectionSnapshot()).toBeNull();
  });

  test("rejects malformed stored values", () => {
    sessionStorage.setItem("mcp_oauth_connection_snapshot", "{not json");
    expect(readOAuthConnectionSnapshot()).toBeNull();
    sessionStorage.setItem(
      "mcp_oauth_connection_snapshot",
      JSON.stringify({ ...SNAPSHOT, transportType: "websocket" }),
    );
    expect(readOAuthConnectionSnapshot()).toBeNull();
    sessionStorage.setItem("mcp_oauth_connection_snapshot", "null");
    expect(readOAuthConnectionSnapshot()).toBeNull();
  });

  test("getOAuthCallbackSnapshot reads only on a callback route", () => {
    saveOAuthConnectionSnapshot(SNAPSHOT);
    expect(getOAuthCallbackSnapshot()).toBeNull();
    window.history.replaceState({}, "", "/oauth/callback?code=abc");
    expect(getOAuthCallbackSnapshot()).toEqual(SNAPSHOT);
  });

  describe("getOAuthReconnectRefusal", () => {
    test("allows a matching HTTP connection", () => {
      expect(getOAuthReconnectRefusal(SNAPSHOT, LIVE)).toBeUndefined();
      expect(
        getOAuthReconnectRefusal(
          { ...SNAPSHOT, transportType: "sse" },
          { ...LIVE, transportType: "sse" },
        ),
      ).toBeUndefined();
    });

    test("refuses without a snapshot", () => {
      expect(getOAuthReconnectRefusal(null, LIVE)).toMatch(
        /No saved connection/,
      );
    });

    test("refuses stdio, in the snapshot or live", () => {
      expect(
        getOAuthReconnectRefusal(
          { ...SNAPSHOT, transportType: "stdio" },
          { ...LIVE, transportType: "stdio" },
        ),
      ).toMatch(/only to SSE and Streamable HTTP/);
      expect(
        getOAuthReconnectRefusal(SNAPSHOT, { ...LIVE, transportType: "stdio" }),
      ).toMatch(/only to SSE and Streamable HTTP/);
    });

    test.each([
      ["authorizedServerUrl", "https://other.example/mcp"],
      ["sseUrl", "https://other.example/mcp"],
      ["transportType", "sse"],
      ["connectionType", "direct"],
      ["proxyAddress", "http://other.example:6277"],
    ])("refuses when live %s differs", (key, value) => {
      expect(
        getOAuthReconnectRefusal(SNAPSHOT, { ...LIVE, [key]: value }),
      ).toMatch(/changed during authorization/);
    });
  });

  describe("InspectorOAuthClientProvider.redirectToAuthorization", () => {
    let consoleError: jest.SpyInstance;
    beforeEach(() => {
      // jsdom reports cross-origin navigation as "not implemented".
      consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => consoleError.mockRestore());

    test("saves the connection it was given before redirecting", () => {
      const { serverUrl, ...connection } = SNAPSHOT;
      new InspectorOAuthClientProvider(
        serverUrl,
        connection,
      ).redirectToAuthorization(new URL("https://auth.example/authorize"));
      expect(readOAuthConnectionSnapshot()).toEqual(SNAPSHOT);
    });

    test("clears a stale snapshot when given no connection", () => {
      saveOAuthConnectionSnapshot(SNAPSHOT);
      new InspectorOAuthClientProvider(
        SNAPSHOT.serverUrl,
      ).redirectToAuthorization(new URL("https://auth.example/authorize"));
      expect(readOAuthConnectionSnapshot()).toBeNull();
    });
  });
});
