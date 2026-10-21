import {
  getMCPProxyAddress,
  getMCPProxyAuthToken,
  initializeInspectorConfig,
  saveInspectorConfig,
} from "../configUtils";
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
      setQuery("");
      expect(initializeInspectorConfig(KEY).MCP_PROXY_FULL_ADDRESS.value).toBe(
        "",
      );
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
