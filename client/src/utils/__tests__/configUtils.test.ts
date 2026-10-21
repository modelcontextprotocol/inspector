import {
  getConfigOverridesFromQueryParams,
  getInitialArgs,
  getInitialCommand,
  getInitialSseUrl,
  getInitialTransportType,
  getMCPProxyAddress,
  getMCPProxyAuthToken,
  initializeInspectorConfig,
  isOAuthCallbackPath,
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
});
