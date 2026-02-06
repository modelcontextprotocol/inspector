import { getMCPProxyAuthToken } from "../configUtils";
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
});
