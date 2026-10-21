import {
  getConfigOverridesFromQueryParams,
  getInitialArgs,
  getInitialCommand,
  getInitialSseUrl,
  getInitialTransportType,
  getMCPProxyAddress,
  getMCPProxyAuthToken,
  initializeInspectorConfig,
  saveInspectorConfig,
} from "../configUtils";
import { isOAuthCallbackPath } from "../../lib/oauthConnectionSnapshot";
import { DEFAULT_INSPECTOR_CONFIG } from "../../lib/constants";
import { InspectorConfig } from "../../lib/configurationTypes";

describe("configUtils", () => {
  describe("getMCPProxyAuthToken", () => {
    test("returns token and default header name", () => {
      const config: InspectorConfig = {
        ...DEFAULT_INSPECTOR_CONFIG,
        MCP_PROXY_AUTH_TOKEN: {
          ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
          value: "test-token-123",
        },
      };

      const result = getMCPProxyAuthToken(config);

      expect(result).toEqual({
        token: "test-token-123",
        header: "X-MCP-Proxy-Auth",
      });
    });

    test("returns empty token when not configured", () => {
      const config: InspectorConfig = {
        ...DEFAULT_INSPECTOR_CONFIG,
        MCP_PROXY_AUTH_TOKEN: {
          ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
          value: "",
        },
      };

      const result = getMCPProxyAuthToken(config);

      expect(result).toEqual({
        token: "",
        header: "X-MCP-Proxy-Auth",
      });
    });

    test("always returns X-MCP-Proxy-Auth as header name", () => {
      const config: InspectorConfig = {
        ...DEFAULT_INSPECTOR_CONFIG,
        MCP_PROXY_AUTH_TOKEN: {
          ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
          value: "any-token",
        },
      };

      const result = getMCPProxyAuthToken(config);

      expect(result.header).toBe("X-MCP-Proxy-Auth");
    });

    test("handles null/undefined value gracefully", () => {
      const config: InspectorConfig = {
        ...DEFAULT_INSPECTOR_CONFIG,
        MCP_PROXY_AUTH_TOKEN: {
          ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
          value: null as unknown as string,
        },
      };

      const result = getMCPProxyAuthToken(config);

      expect(result).toEqual({
        token: null,
        header: "X-MCP-Proxy-Auth",
      });
    });
  });

  describe("connection settings from the URL query", () => {
    const CONNECTION_QUERY =
      "?transport=stdio&serverCommand=injected-cmd&serverArgs=--injected" +
      "&serverUrl=http%3A%2F%2Finjected.example%2Fmcp" +
      "&MCP_PROXY_PORT=9999" +
      "&MCP_PROXY_FULL_ADDRESS=http%3A%2F%2Finjected.example" +
      "&MCP_PROXY_AUTH_TOKEN=injected-token";

    const navigate = (pathAndQuery: string) => {
      window.history.replaceState({}, "", pathAndQuery);
    };

    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("lastTransportType", "streamable-http");
      localStorage.setItem("lastSseUrl", "https://remote.example/mcp");
      localStorage.setItem("lastCommand", "saved-cmd");
      localStorage.setItem("lastArgs", "--saved");
    });

    afterEach(() => {
      navigate("/");
      localStorage.clear();
      sessionStorage.clear();
    });

    test("are read on the normal entry route", () => {
      navigate(`/${CONNECTION_QUERY}`);

      expect(isOAuthCallbackPath()).toBe(false);
      expect(getInitialTransportType()).toBe("stdio");
      expect(getInitialCommand()).toBe("injected-cmd");
      expect(getInitialArgs()).toBe("--injected");
      expect(getInitialSseUrl()).toBe("http://injected.example/mcp");

      const overrides = getConfigOverridesFromQueryParams(
        DEFAULT_INSPECTOR_CONFIG,
      );
      expect(overrides.MCP_PROXY_AUTH_TOKEN?.value).toBe("injected-token");
      expect(overrides.MCP_PROXY_FULL_ADDRESS?.value).toBe(
        "http://injected.example",
      );
    });

    test.each(["/oauth/callback", "/oauth/callback/debug"])(
      "are ignored on %s, which restores the saved connection",
      (path) => {
        navigate(`${path}${CONNECTION_QUERY}&code=abc&state=xyz`);

        expect(isOAuthCallbackPath()).toBe(true);
        expect(getInitialTransportType()).toBe("streamable-http");
        expect(getInitialCommand()).toBe("saved-cmd");
        expect(getInitialArgs()).toBe("--saved");
        expect(getInitialSseUrl()).toBe("https://remote.example/mcp");
        expect(
          getConfigOverridesFromQueryParams(DEFAULT_INSPECTOR_CONFIG),
        ).toEqual({});

        const config = initializeInspectorConfig("configUtilsTestConfig");
        expect(config.MCP_PROXY_AUTH_TOKEN.value).toBe(
          DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN.value,
        );
        expect(config.MCP_PROXY_FULL_ADDRESS.value).toBe(
          DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_FULL_ADDRESS.value,
        );
        expect(getMCPProxyAddress(config)).not.toContain("9999");
        expect(getMCPProxyAddress(config)).not.toContain("injected");
      },
    );

    test("fall back to defaults on the callback route when nothing is saved", () => {
      localStorage.clear();
      navigate(`/oauth/callback${CONNECTION_QUERY}&code=abc`);

      expect(getInitialCommand()).toBe("mcp-server-everything");
      expect(getInitialArgs()).toBe("");
    });
  });

  describe("proxy address and token from the query string", () => {
    const KEY = "inspectorConfig_test";
    const STORED_TOKEN = "stored-token";
    const QUERY_TOKEN = "query-token";
    const REMOTE = "http://proxy.example:5577";

    const setQuery = (query: string) => {
      window.history.replaceState({}, "", `/${query}`);
    };

    const storeConfig = (address: string, token: string) => {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          MCP_PROXY_FULL_ADDRESS: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_FULL_ADDRESS,
            value: address,
          },
        }),
      );
      sessionStorage.setItem(
        `${KEY}_ephemeral`,
        JSON.stringify({
          MCP_PROXY_AUTH_TOKEN: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
            value: token,
          },
        }),
      );
    };

    const storedAddress = () =>
      JSON.parse(localStorage.getItem(KEY) ?? "{}").MCP_PROXY_FULL_ADDRESS
        ?.value;

    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      setQuery("");
    });

    afterAll(() => {
      setQuery("");
    });

    test("sends the query token to a query proxy address", () => {
      storeConfig("", STORED_TOKEN);
      setQuery(
        `?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent(REMOTE)}&MCP_PROXY_AUTH_TOKEN=${QUERY_TOKEN}`,
      );
      const config = initializeInspectorConfig(KEY);
      expect(getMCPProxyAddress(config)).toBe(REMOTE);
      expect(getMCPProxyAuthToken(config).token).toBe(QUERY_TOKEN);
    });

    test("does not send the stored token to a query proxy address", () => {
      storeConfig("", STORED_TOKEN);
      setQuery(`?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent(REMOTE)}`);
      const config = initializeInspectorConfig(KEY);
      expect(getMCPProxyAddress(config)).toBe(REMOTE);
      expect(getMCPProxyAuthToken(config).token).toBe("");
    });

    test("drops the stored token for the session once a query proxy address is used", () => {
      storeConfig("", STORED_TOKEN);
      setQuery(`?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent(REMOTE)}`);
      const config = initializeInspectorConfig(KEY);
      saveInspectorConfig(KEY, config);
      expect(sessionStorage.getItem(`${KEY}_ephemeral`)).not.toContain(
        STORED_TOKEN,
      );
    });

    test("sends the stored token to the stored proxy address", () => {
      storeConfig(REMOTE, STORED_TOKEN);
      const config = initializeInspectorConfig(KEY);
      expect(getMCPProxyAddress(config)).toBe(REMOTE);
      expect(getMCPProxyAuthToken(config).token).toBe(STORED_TOKEN);
    });

    test("sends the stored token to the default proxy address", () => {
      storeConfig("", STORED_TOKEN);
      const config = initializeInspectorConfig(KEY);
      expect(getMCPProxyAddress(config)).toBe(
        `${window.location.protocol}//${window.location.hostname}:6277`,
      );
      expect(getMCPProxyAuthToken(config).token).toBe(STORED_TOKEN);
    });

    test("keeps the stored token when the query repeats the stored address", () => {
      storeConfig(REMOTE, STORED_TOKEN);
      setQuery(`?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent(`${REMOTE}/`)}`);
      const config = initializeInspectorConfig(KEY);
      expect(getMCPProxyAuthToken(config).token).toBe(STORED_TOKEN);
    });

    test("does not persist a query proxy address", () => {
      storeConfig(REMOTE, STORED_TOKEN);
      setQuery(
        `?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent("http://other.example:1")}`,
      );
      saveInspectorConfig(KEY, initializeInspectorConfig(KEY));
      expect(storedAddress()).toBe(REMOTE);

      // A later launch carrying only a fresh token uses the saved address.
      setQuery(`?MCP_PROXY_AUTH_TOKEN=${QUERY_TOKEN}`);
      const later = initializeInspectorConfig(KEY);
      expect(getMCPProxyAddress(later)).toBe(REMOTE);
      expect(getMCPProxyAuthToken(later).token).toBe(QUERY_TOKEN);
    });

    test("does not persist a query proxy address when none was saved", () => {
      setQuery(`?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent(REMOTE)}`);
      saveInspectorConfig(KEY, initializeInspectorConfig(KEY));
      expect(storedAddress()).toBeUndefined();
      // A new session (fresh tab) without the query uses the default.
      sessionStorage.clear();
      setQuery("");
      expect(initializeInspectorConfig(KEY).MCP_PROXY_FULL_ADDRESS.value).toBe(
        "",
      );
    });

    test("keeps a query proxy address and token across a same-tab redirect", () => {
      setQuery(
        `?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent(REMOTE)}&MCP_PROXY_AUTH_TOKEN=${QUERY_TOKEN}`,
      );
      saveInspectorConfig(KEY, initializeInspectorConfig(KEY));

      // The OAuth callback lands in the same tab without the original query.
      window.history.replaceState({}, "", "/oauth/callback?code=abc");
      const callback = initializeInspectorConfig(KEY);
      expect(getMCPProxyAddress(callback)).toBe(REMOTE);
      expect(getMCPProxyAuthToken(callback).token).toBe(QUERY_TOKEN);
      saveInspectorConfig(KEY, callback);
      expect(storedAddress()).toBeUndefined();
      expect(localStorage.getItem(KEY)).not.toContain(REMOTE);
    });

    test("does not send the tab's token to a different query address in a tab that inherits its session", () => {
      storeConfig("", STORED_TOKEN);
      setQuery(
        `?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent(REMOTE)}&MCP_PROXY_AUTH_TOKEN=${STORED_TOKEN}`,
      );
      saveInspectorConfig(KEY, initializeInspectorConfig(KEY));

      // A tab opened from this one starts with a copy of its sessionStorage.
      setQuery(
        `?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent("http://other.example:1")}`,
      );
      const opened = initializeInspectorConfig(KEY);
      expect(getMCPProxyAddress(opened)).toBe("http://other.example:1");
      expect(getMCPProxyAuthToken(opened).token).toBe("");
      saveInspectorConfig(KEY, opened);
      expect(localStorage.getItem(KEY)).not.toContain("other.example");
      expect(localStorage.getItem(KEY)).not.toContain(REMOTE);
    });

    test("a token-only URL in the same tab uses the saved proxy, not the tab's query address", () => {
      setQuery(`?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent(REMOTE)}`);
      saveInspectorConfig(KEY, initializeInspectorConfig(KEY));

      setQuery(`?MCP_PROXY_AUTH_TOKEN=${QUERY_TOKEN}`);
      const launched = initializeInspectorConfig(KEY);
      expect(getMCPProxyAddress(launched)).toBe(
        `${window.location.protocol}//${window.location.hostname}:6277`,
      );
      saveInspectorConfig(KEY, launched);
      setQuery("");
      expect(initializeInspectorConfig(KEY).MCP_PROXY_FULL_ADDRESS.value).toBe(
        "",
      );
    });

    test("ignores a tab's query address equal to the saved address", () => {
      storeConfig(REMOTE, STORED_TOKEN);
      sessionStorage.setItem(`${KEY}_session_proxy_address`, `${REMOTE}/`);
      const config = initializeInspectorConfig(KEY);
      expect(config.MCP_PROXY_FULL_ADDRESS.value).toBe(REMOTE);
      saveInspectorConfig(KEY, config);
      expect(sessionStorage.getItem(`${KEY}_session_proxy_address`)).toBeNull();
    });

    test("accepts only a numeric MCP_PROXY_PORT", () => {
      const base = `${window.location.protocol}//${window.location.hostname}`;
      setQuery("?MCP_PROXY_PORT=7000");
      expect(getMCPProxyAddress(DEFAULT_INSPECTOR_CONFIG)).toBe(`${base}:7000`);
      setQuery(`?MCP_PROXY_PORT=${encodeURIComponent("6277@other.example")}`);
      expect(getMCPProxyAddress(DEFAULT_INSPECTOR_CONFIG)).toBe(`${base}:6277`);
    });

    test("persists a proxy address the user changes", () => {
      setQuery(`?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent(REMOTE)}`);
      const config = initializeInspectorConfig(KEY);
      saveInspectorConfig(KEY, {
        ...config,
        MCP_PROXY_FULL_ADDRESS: {
          ...config.MCP_PROXY_FULL_ADDRESS,
          value: "http://typed.example:2",
        },
      });
      expect(storedAddress()).toBe("http://typed.example:2");
    });

    test("tolerates unparseable saved config when skipping the address", () => {
      setQuery(`?MCP_PROXY_FULL_ADDRESS=${encodeURIComponent(REMOTE)}`);
      const config = initializeInspectorConfig(KEY);
      localStorage.setItem(KEY, "not json");
      saveInspectorConfig(KEY, config);
      expect(storedAddress()).toBeUndefined();
    });
  });
});
