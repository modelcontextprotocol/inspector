import { getMCPProxyAuthToken, getInitialConnectionType } from "../configUtils";
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

  describe("getInitialConnectionType", () => {
    const originalLocation = window.location;

    const setLocation = (search: string) => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: new URL(`http://localhost:6274/${search}`),
      });
    };

    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    });

    test("returns 'direct' when query param is 'direct'", () => {
      setLocation("?connectionType=direct");
      expect(getInitialConnectionType()).toBe("direct");
    });

    test("returns 'proxy' when query param is 'proxy'", () => {
      setLocation("?connectionType=proxy");
      expect(getInitialConnectionType()).toBe("proxy");
    });

    test("falls back to localStorage when query param is missing", () => {
      setLocation("");
      localStorage.setItem("lastConnectionType", "direct");
      expect(getInitialConnectionType()).toBe("direct");
    });

    test("ignores invalid query param values and falls back to localStorage", () => {
      setLocation("?connectionType=bogus");
      localStorage.setItem("lastConnectionType", "direct");
      expect(getInitialConnectionType()).toBe("direct");
    });

    test("defaults to 'proxy' when nothing is set", () => {
      setLocation("");
      expect(getInitialConnectionType()).toBe("proxy");
    });
  });
});
