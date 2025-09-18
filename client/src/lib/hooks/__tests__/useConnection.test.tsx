import { renderHook, act } from "@testing-library/react";
import { useConnection } from "../useConnection";
import { z } from "zod";
import { ClientRequest } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_INSPECTOR_CONFIG } from "../../constants";
import {
  SSEClientTransportOptions,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  ElicitResult,
  ElicitRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { discoverScopes } from "../../auth";
import { CustomHeaders } from "../../types/customHeaders";

// Mock fetch
global.fetch = jest.fn().mockResolvedValue({
  json: () => Promise.resolve({ status: "ok" }),
  headers: {
    get: jest.fn().mockReturnValue(null),
  },
});

// Mock the SDK dependencies
const mockRequest = jest.fn().mockResolvedValue({ test: "response" });
const mockClient = {
  request: mockRequest,
  notification: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
  getServerCapabilities: jest.fn(),
  getServerVersion: jest.fn(),
  getInstructions: jest.fn(),
  setNotificationHandler: jest.fn(),
  setRequestHandler: jest.fn(),
};

// Mock transport instances
const mockSSETransport: {
  start: jest.Mock;
  url: URL | undefined;
  options: SSEClientTransportOptions | undefined;
} = {
  start: jest.fn(),
  url: undefined,
  options: undefined,
};

const mockStreamableHTTPTransport: {
  start: jest.Mock;
  url: URL | undefined;
  options: SSEClientTransportOptions | undefined;
} = {
  start: jest.fn(),
  url: undefined,
  options: undefined,
};

jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
}));

jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => {
  // Minimal mock class that supports instanceof checks
  class SseError extends Error {
    code: number;
    event: ErrorEvent;
    constructor(code: number, message: string, event: ErrorEvent) {
      super(message);
      this.code = code;
      this.event = event;
    }
  }

  return {
    SSEClientTransport: jest.fn((url, options) => {
      mockSSETransport.url = url;
      mockSSETransport.options = options;
      return mockSSETransport;
    }),
    SseError,
  };
});

jest.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: jest.fn((url, options) => {
    mockStreamableHTTPTransport.url = url;
    mockStreamableHTTPTransport.options = options;
    return mockStreamableHTTPTransport;
  }),
}));

jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: jest.fn().mockResolvedValue("AUTHORIZED"),
}));

// Mock the toast hook
jest.mock("@/lib/hooks/useToast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

// Mock the auth provider
jest.mock("../../auth", () => ({
  InspectorOAuthClientProvider: jest.fn().mockImplementation(() => ({
    tokens: jest.fn().mockResolvedValue({ access_token: "mock-token" }),
    redirectUrl: "http://localhost:3000/oauth/callback",
  })),
  clearClientInformationFromSessionStorage: jest.fn(),
  saveClientInformationToSessionStorage: jest.fn(),
  discoverScopes: jest.fn(),
}));

const mockAuth = auth as jest.MockedFunction<typeof auth>;
const mockDiscoverScopes = discoverScopes as jest.MockedFunction<
  typeof discoverScopes
>;

describe("useConnection", () => {
  const defaultProps = {
    transportType: "sse" as const,
    command: "",
    args: "",
    sseUrl: "http://localhost:8080",
    env: {},
    config: DEFAULT_INSPECTOR_CONFIG,
  };

  describe("Request Configuration", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test("uses the default config values in makeRequest", async () => {
      const { result } = renderHook(() => useConnection(defaultProps));

      // Connect the client
      await act(async () => {
        await result.current.connect();
      });

      // Wait for state update
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const mockRequest: ClientRequest = {
        method: "ping",
        params: {},
      };

      const mockSchema = z.object({
        test: z.string(),
      });

      await act(async () => {
        await result.current.makeRequest(mockRequest, mockSchema);
      });

      expect(mockClient.request).toHaveBeenCalledWith(
        mockRequest,
        mockSchema,
        expect.objectContaining({
          timeout: DEFAULT_INSPECTOR_CONFIG.MCP_SERVER_REQUEST_TIMEOUT.value,
          maxTotalTimeout:
            DEFAULT_INSPECTOR_CONFIG.MCP_REQUEST_MAX_TOTAL_TIMEOUT.value,
          resetTimeoutOnProgress:
            DEFAULT_INSPECTOR_CONFIG.MCP_REQUEST_TIMEOUT_RESET_ON_PROGRESS
              .value,
        }),
      );
    });

    test("overrides the default config values when passed in options in makeRequest", async () => {
      const { result } = renderHook(() => useConnection(defaultProps));

      // Connect the client
      await act(async () => {
        await result.current.connect();
      });

      // Wait for state update
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const mockRequest: ClientRequest = {
        method: "ping",
        params: {},
      };

      const mockSchema = z.object({
        test: z.string(),
      });

      await act(async () => {
        await result.current.makeRequest(mockRequest, mockSchema, {
          timeout: 1000,
          maxTotalTimeout: 2000,
          resetTimeoutOnProgress: false,
        });
      });

      expect(mockClient.request).toHaveBeenCalledWith(
        mockRequest,
        mockSchema,
        expect.objectContaining({
          timeout: 1000,
          maxTotalTimeout: 2000,
          resetTimeoutOnProgress: false,
        }),
      );
    });
  });

  test("throws error when mcpClient is not connected", async () => {
    const { result } = renderHook(() => useConnection(defaultProps));

    const mockRequest: ClientRequest = {
      method: "ping",
      params: {},
    };

    const mockSchema = z.object({
      test: z.string(),
    });

    await expect(
      result.current.makeRequest(mockRequest, mockSchema),
    ).rejects.toThrow("MCP client not connected");
  });

  describe("Elicitation Support", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test("declares elicitation capability during client initialization", async () => {
      const Client = jest.requireMock(
        "@modelcontextprotocol/sdk/client/index.js",
      ).Client;

      const { result } = renderHook(() => useConnection(defaultProps));

      await act(async () => {
        await result.current.connect();
      });

      expect(Client).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "mcp-inspector",
          version: expect.any(String),
        }),
        expect.objectContaining({
          capabilities: expect.objectContaining({
            elicitation: {},
          }),
        }),
      );
    });

    test("sets up elicitation request handler when onElicitationRequest is provided", async () => {
      const mockOnElicitationRequest = jest.fn();
      const propsWithElicitation = {
        ...defaultProps,
        onElicitationRequest: mockOnElicitationRequest,
      };

      const { result } = renderHook(() => useConnection(propsWithElicitation));

      await act(async () => {
        await result.current.connect();
      });

      const elicitRequestHandlerCall =
        mockClient.setRequestHandler.mock.calls.find((call) => {
          try {
            const schema = call[0];
            const testRequest = {
              method: "elicitation/create",
              params: {
                message: "test message",
                requestedSchema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                  },
                },
              },
            };
            const parseResult =
              schema.safeParse && schema.safeParse(testRequest);
            return parseResult?.success;
          } catch {
            return false;
          }
        });

      expect(elicitRequestHandlerCall).toBeDefined();
      expect(mockClient.setRequestHandler).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Function),
      );
    });

    test("does not set up elicitation request handler when onElicitationRequest is not provided", async () => {
      const { result } = renderHook(() => useConnection(defaultProps));

      await act(async () => {
        await result.current.connect();
      });

      const elicitRequestHandlerCall =
        mockClient.setRequestHandler.mock.calls.find((call) => {
          try {
            const schema = call[0];
            const testRequest = {
              method: "elicitation/create",
              params: {
                message: "test message",
                requestedSchema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                  },
                },
              },
            };
            const parseResult =
              schema.safeParse && schema.safeParse(testRequest);
            return parseResult?.success;
          } catch {
            return false;
          }
        });

      expect(elicitRequestHandlerCall).toBeUndefined();
    });

    test("elicitation request handler calls onElicitationRequest callback", async () => {
      const mockOnElicitationRequest = jest.fn();
      const propsWithElicitation = {
        ...defaultProps,
        onElicitationRequest: mockOnElicitationRequest,
      };

      const { result } = renderHook(() => useConnection(propsWithElicitation));

      await act(async () => {
        await result.current.connect();
      });

      const elicitRequestHandlerCall =
        mockClient.setRequestHandler.mock.calls.find((call) => {
          try {
            const schema = call[0];
            const testRequest = {
              method: "elicitation/create",
              params: {
                message: "test message",
                requestedSchema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                  },
                },
              },
            };
            const parseResult =
              schema.safeParse && schema.safeParse(testRequest);
            return parseResult?.success;
          } catch {
            return false;
          }
        });

      expect(elicitRequestHandlerCall).toBeDefined();
      const [, handler] = elicitRequestHandlerCall;

      const mockElicitationRequest: ElicitRequest = {
        method: "elicitation/create",
        params: {
          message: "Please provide your name",
          requestedSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
      };

      mockOnElicitationRequest.mockImplementation((_request, resolve) => {
        resolve({ action: "accept", content: { name: "test" } });
      });

      await act(async () => {
        await handler(mockElicitationRequest);
      });

      expect(mockOnElicitationRequest).toHaveBeenCalledWith(
        mockElicitationRequest,
        expect.any(Function),
      );
    });

    test("elicitation request handler returns a promise that resolves with the callback result", async () => {
      const mockOnElicitationRequest = jest.fn();
      const propsWithElicitation = {
        ...defaultProps,
        onElicitationRequest: mockOnElicitationRequest,
      };

      const { result } = renderHook(() => useConnection(propsWithElicitation));

      await act(async () => {
        await result.current.connect();
      });

      const elicitRequestHandlerCall =
        mockClient.setRequestHandler.mock.calls.find((call) => {
          try {
            const schema = call[0];
            const testRequest = {
              method: "elicitation/create",
              params: {
                message: "test message",
                requestedSchema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                  },
                },
              },
            };
            const parseResult =
              schema.safeParse && schema.safeParse(testRequest);
            return parseResult?.success;
          } catch {
            return false;
          }
        });

      const [, handler] = elicitRequestHandlerCall;

      const mockElicitationRequest: ElicitRequest = {
        method: "elicitation/create",
        params: {
          message: "Please provide your name",
          requestedSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
      };

      const mockResponse: ElicitResult = {
        action: "accept",
        content: { name: "John Doe" },
      };

      mockOnElicitationRequest.mockImplementation((_request, resolve) => {
        resolve(mockResponse);
      });

      let handlerResult;
      await act(async () => {
        handlerResult = await handler(mockElicitationRequest);
      });

      expect(handlerResult).toEqual(mockResponse);
    });
  });

  describe("URL Port Handling", () => {
    const SSEClientTransport = jest.requireMock(
      "@modelcontextprotocol/sdk/client/sse.js",
    ).SSEClientTransport;
    const StreamableHTTPClientTransport = jest.requireMock(
      "@modelcontextprotocol/sdk/client/streamableHttp.js",
    ).StreamableHTTPClientTransport;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test("preserves HTTPS port number when connecting", async () => {
      const props = {
        ...defaultProps,
        sseUrl: "https://example.com:8443/api",
        transportType: "sse" as const,
      };

      const { result } = renderHook(() => useConnection(props));

      await act(async () => {
        await result.current.connect();
      });

      const call = SSEClientTransport.mock.calls[0][0];
      expect(call.toString()).toContain(
        "url=https%3A%2F%2Fexample.com%3A8443%2Fapi",
      );
    });

    test("preserves HTTP port number when connecting", async () => {
      const props = {
        ...defaultProps,
        sseUrl: "http://localhost:3000/api",
        transportType: "sse" as const,
      };

      const { result } = renderHook(() => useConnection(props));

      await act(async () => {
        await result.current.connect();
      });

      const call = SSEClientTransport.mock.calls[0][0];
      expect(call.toString()).toContain(
        "url=http%3A%2F%2Flocalhost%3A3000%2Fapi",
      );
    });

    test("uses default port for HTTPS when not specified", async () => {
      const props = {
        ...defaultProps,
        sseUrl: "https://example.com/api",
        transportType: "sse" as const,
      };

      const { result } = renderHook(() => useConnection(props));

      await act(async () => {
        await result.current.connect();
      });

      const call = SSEClientTransport.mock.calls[0][0];
      expect(call.toString()).toContain("url=https%3A%2F%2Fexample.com%2Fapi");
      expect(call.toString()).not.toContain("%3A443");
    });

    test("preserves port number in streamable-http transport", async () => {
      const props = {
        ...defaultProps,
        sseUrl: "https://example.com:8443/api",
        transportType: "streamable-http" as const,
      };

      const { result } = renderHook(() => useConnection(props));

      await act(async () => {
        await result.current.connect();
      });

      const call = StreamableHTTPClientTransport.mock.calls[0][0];
      expect(call.toString()).toContain(
        "url=https%3A%2F%2Fexample.com%3A8443%2Fapi",
      );
    });
  });

  describe("Proxy Authentication Headers", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Reset the mock transport objects
      mockSSETransport.url = undefined;
      mockSSETransport.options = undefined;
      mockStreamableHTTPTransport.url = undefined;
      mockStreamableHTTPTransport.options = undefined;
    });

    test("sends X-MCP-Proxy-Auth header when proxy auth token is configured for proxy connectionType", async () => {
      const propsWithProxyAuth = {
        ...defaultProps,
        connectionType: "proxy" as const,
        config: {
          ...DEFAULT_INSPECTOR_CONFIG,
          MCP_PROXY_AUTH_TOKEN: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
            value: "test-proxy-token",
          },
        },
      };

      const { result } = renderHook(() => useConnection(propsWithProxyAuth));

      await act(async () => {
        await result.current.connect();
      });

      // Check that the transport was created with the correct headers
      expect(mockSSETransport.options).toBeDefined();
      expect(mockSSETransport.options?.requestInit).toBeDefined();

      expect(mockSSETransport.options?.requestInit?.headers).toHaveProperty(
        "X-MCP-Proxy-Auth",
        "Bearer test-proxy-token",
      );
      expect(mockSSETransport?.options?.eventSourceInit?.fetch).toBeDefined();

      // Verify the fetch function includes the proxy auth header
      const mockFetch = mockSSETransport.options?.eventSourceInit?.fetch;
      const testUrl = "http://test.com";
      await mockFetch?.(testUrl, {
        headers: {
          Accept: "text/event-stream",
        },
        cache: "no-store",
        mode: "cors",
        signal: new AbortController().signal,
        redirect: "follow",
        credentials: "include",
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(
        (global.fetch as jest.Mock).mock.calls[0][1].headers,
      ).toHaveProperty("X-MCP-Proxy-Auth", "Bearer test-proxy-token");
      expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(testUrl);
      expect(
        (global.fetch as jest.Mock).mock.calls[1][1].headers,
      ).toHaveProperty("X-MCP-Proxy-Auth", "Bearer test-proxy-token");
    });

    test("does NOT send X-MCP-Proxy-Auth header when proxy auth token is configured for direct connectionType", async () => {
      const propsWithProxyAuth = {
        ...defaultProps,
        connectionType: "direct" as const,
        config: {
          ...DEFAULT_INSPECTOR_CONFIG,
          MCP_PROXY_AUTH_TOKEN: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
            value: "test-proxy-token",
          },
        },
      };

      const { result } = renderHook(() => useConnection(propsWithProxyAuth));

      await act(async () => {
        await result.current.connect();
      });

      // Check that the transport was created with the correct headers
      expect(mockSSETransport.options).toBeDefined();
      expect(mockSSETransport.options?.requestInit).toBeDefined();

      // Verify that X-MCP-Proxy-Auth header is NOT present for direct connections
      expect(mockSSETransport.options?.requestInit?.headers).not.toHaveProperty(
        "X-MCP-Proxy-Auth",
      );
      expect(mockSSETransport?.options?.fetch).toBeDefined();

      // Verify the fetch function does NOT include the proxy auth header
      const mockFetch = mockSSETransport.options?.fetch;
      const testUrl = "http://test.com";
      await mockFetch?.(testUrl, {
        headers: {
          Accept: "text/event-stream",
        },
        cache: "no-store",
        mode: "cors",
        signal: new AbortController().signal,
        redirect: "follow",
        credentials: "include",
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(testUrl);
      expect(
        (global.fetch as jest.Mock).mock.calls[0][1].headers,
      ).not.toHaveProperty("X-MCP-Proxy-Auth");
    });

    test("does NOT send Authorization header for proxy auth", async () => {
      const propsWithProxyAuth = {
        ...defaultProps,
        config: {
          ...DEFAULT_INSPECTOR_CONFIG,
          proxyAuthToken: "test-proxy-token",
        },
      };

      const { result } = renderHook(() => useConnection(propsWithProxyAuth));

      await act(async () => {
        await result.current.connect();
      });

      // Check that Authorization header is NOT used for proxy auth
      expect(mockSSETransport.options?.requestInit?.headers).not.toHaveProperty(
        "Authorization",
        "Bearer test-proxy-token",
      );
    });

    test("preserves server Authorization header when proxy auth is configured", async () => {
      const customHeaders: CustomHeaders = [
        {
          name: "Authorization",
          value: "Bearer server-auth-token",
          enabled: true,
        },
      ];

      const propsWithBothAuth = {
        ...defaultProps,
        customHeaders,
        config: {
          ...DEFAULT_INSPECTOR_CONFIG,
          MCP_PROXY_AUTH_TOKEN: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
            value: "test-proxy-token",
          },
        },
      };

      const { result } = renderHook(() => useConnection(propsWithBothAuth));

      await act(async () => {
        await result.current.connect();
      });

      // Check that both headers are present and distinct
      const headers = mockSSETransport.options?.requestInit?.headers;
      expect(headers).toHaveProperty(
        "Authorization",
        "Bearer server-auth-token",
      );
      expect(headers).toHaveProperty(
        "X-MCP-Proxy-Auth",
        "Bearer test-proxy-token",
      );
    });

    test("sends X-MCP-Proxy-Auth in health check requests", async () => {
      const fetchMock = global.fetch as jest.Mock;
      fetchMock.mockClear();

      const propsWithProxyAuth = {
        ...defaultProps,
        config: {
          ...DEFAULT_INSPECTOR_CONFIG,
          MCP_PROXY_AUTH_TOKEN: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
            value: "test-proxy-token",
          },
        },
      };

      const { result } = renderHook(() => useConnection(propsWithProxyAuth));

      await act(async () => {
        await result.current.connect();
      });

      // Find the health check call
      const healthCheckCall = fetchMock.mock.calls.find(
        (call) => call[0].pathname === "/health",
      );

      expect(healthCheckCall).toBeDefined();
      expect(healthCheckCall[1].headers).toHaveProperty(
        "X-MCP-Proxy-Auth",
        "Bearer test-proxy-token",
      );
    });

    test("works correctly with streamable-http transport", async () => {
      const propsWithStreamableHttp = {
        ...defaultProps,
        transportType: "streamable-http" as const,
        config: {
          ...DEFAULT_INSPECTOR_CONFIG,
          MCP_PROXY_AUTH_TOKEN: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_AUTH_TOKEN,
            value: "test-proxy-token",
          },
        },
      };

      const { result } = renderHook(() =>
        useConnection(propsWithStreamableHttp),
      );

      await act(async () => {
        await result.current.connect();
      });

      // Check that the streamable HTTP transport was created with the correct headers
      expect(mockStreamableHTTPTransport.options).toBeDefined();
      expect(
        mockStreamableHTTPTransport.options?.requestInit?.headers,
      ).toHaveProperty("X-MCP-Proxy-Auth", "Bearer test-proxy-token");
    });
  });

  describe("Custom Headers", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Reset the mock transport objects
      mockSSETransport.url = undefined;
      mockSSETransport.options = undefined;
      mockStreamableHTTPTransport.url = undefined;
      mockStreamableHTTPTransport.options = undefined;
    });

    test("sends multiple custom headers correctly", async () => {
      const customHeaders: CustomHeaders = [
        { name: "Authorization", value: "Bearer token123", enabled: true },
        { name: "X-Tenant-ID", value: "acme-inc", enabled: true },
        { name: "X-Environment", value: "staging", enabled: true },
      ];

      const propsWithCustomHeaders = {
        ...defaultProps,
        customHeaders,
      };

      const { result } = renderHook(() =>
        useConnection(propsWithCustomHeaders),
      );

      await act(async () => {
        await result.current.connect();
      });

      // Check that the transport was created with the correct headers
      expect(mockSSETransport.options).toBeDefined();
      expect(mockSSETransport.options?.requestInit?.headers).toBeDefined();

      const headers = mockSSETransport.options?.requestInit?.headers;
      expect(headers).toHaveProperty("Authorization", "Bearer token123");
      expect(headers).toHaveProperty("X-Tenant-ID", "acme-inc");
      expect(headers).toHaveProperty("X-Environment", "staging");
      expect(headers).toHaveProperty(
        "x-custom-auth-headers",
        JSON.stringify(["X-Tenant-ID", "X-Environment"]),
      );
    });

    test("ignores disabled custom headers", async () => {
      const customHeaders: CustomHeaders = [
        { name: "Authorization", value: "Bearer token123", enabled: true },
        { name: "X-Disabled", value: "should-not-appear", enabled: false },
        { name: "X-Enabled", value: "should-appear", enabled: true },
      ];

      const propsWithCustomHeaders = {
        ...defaultProps,
        customHeaders,
      };

      const { result } = renderHook(() =>
        useConnection(propsWithCustomHeaders),
      );

      await act(async () => {
        await result.current.connect();
      });

      const headers = mockSSETransport.options?.requestInit?.headers;
      expect(headers).toHaveProperty("Authorization", "Bearer token123");
      expect(headers).toHaveProperty("X-Enabled", "should-appear");
      expect(headers).not.toHaveProperty("X-Disabled");
    });

    test("handles migrated legacy auth via custom headers", async () => {
      // Simulate what App.tsx would do - migrate legacy auth to custom headers
      const customHeaders: CustomHeaders = [
        { name: "X-Custom-Auth", value: "legacy-token", enabled: true },
      ];

      const propsWithMigratedAuth = {
        ...defaultProps,
        customHeaders,
      };

      const { result } = renderHook(() => useConnection(propsWithMigratedAuth));

      await act(async () => {
        await result.current.connect();
      });

      const headers = mockSSETransport.options?.requestInit?.headers;
      expect(headers).toHaveProperty("X-Custom-Auth", "legacy-token");
      expect(headers).toHaveProperty(
        "x-custom-auth-headers",
        JSON.stringify(["X-Custom-Auth"]),
      );
    });

    test("uses OAuth token when no custom headers or legacy auth provided", async () => {
      const propsWithoutAuth = {
        ...defaultProps,
      };

      const { result } = renderHook(() => useConnection(propsWithoutAuth));

      await act(async () => {
        await result.current.connect();
      });

      const headers = mockSSETransport.options?.requestInit?.headers;
      expect(headers).toHaveProperty("Authorization", "Bearer mock-token");
    });

    test("prioritizes custom headers over legacy auth", async () => {
      const customHeaders: CustomHeaders = [
        { name: "Authorization", value: "Bearer custom-token", enabled: true },
      ];

      const propsWithBothAuth = {
        ...defaultProps,
        customHeaders,
        bearerToken: "legacy-token",
        headerName: "Authorization",
      };

      const { result } = renderHook(() => useConnection(propsWithBothAuth));

      await act(async () => {
        await result.current.connect();
      });

      const headers = mockSSETransport.options?.requestInit?.headers;
      expect(headers).toHaveProperty("Authorization", "Bearer custom-token");
    });
  });

  describe("Connection URL Verification", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Reset the mock transport objects
      mockSSETransport.url = undefined;
      mockSSETransport.options = undefined;
      mockStreamableHTTPTransport.url = undefined;
      mockStreamableHTTPTransport.options = undefined;
    });

    test("uses server URL directly when connectionType is 'direct'", async () => {
      const directProps = {
        ...defaultProps,
        connectionType: "direct" as const,
      };

      const { result } = renderHook(() => useConnection(directProps));

      await act(async () => {
        await result.current.connect();
      });

      // Verify the transport was created with the direct server URL
      expect(mockSSETransport.url).toBeDefined();
      expect(mockSSETransport.url?.toString()).toBe("http://localhost:8080/");
    });

    test("uses proxy server URL when connectionType is 'proxy'", async () => {
      const proxyProps = {
        ...defaultProps,
        connectionType: "proxy" as const,
      };

      const { result } = renderHook(() => useConnection(proxyProps));

      await act(async () => {
        await result.current.connect();
      });

      // Verify the transport was created with a proxy server URL
      expect(mockSSETransport.url).toBeDefined();
      expect(mockSSETransport.url?.pathname).toBe("/sse");
      expect(mockSSETransport.url?.searchParams.get("url")).toBe(
        "http://localhost:8080",
      );
      expect(mockSSETransport.url?.searchParams.get("transportType")).toBe(
        "sse",
      );
    });
  });

  describe("OAuth Error Handling with Scope Discovery", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockAuth.mockResolvedValue("AUTHORIZED");
      mockDiscoverScopes.mockResolvedValue(undefined);
    });

    const setup401Error = () => {
      const mockErrorEvent = new ErrorEvent("error", {
        message: "Mock error event",
      });
      mockClient.connect.mockRejectedValueOnce(
        new SseError(401, "Unauthorized", mockErrorEvent),
      );
    };

    const attemptConnection = async (props = defaultProps) => {
      const { result } = renderHook(() => useConnection(props));
      await act(async () => {
        try {
          await result.current.connect();
        } catch {
          // Expected error from auth handling
        }
      });
    };

    const testCases = [
      [
        "discovers and includes scopes in auth call",
        {
          discoveredScope: "read write admin",
          oauthScope: undefined,
          expectScopeCall: true,
          expectedAuthScope: "read write admin",
          authResult: "AUTHORIZED",
        },
      ],
      [
        "handles scope discovery failure gracefully",
        {
          discoveredScope: undefined,
          oauthScope: undefined,
          expectScopeCall: true,
          expectedAuthScope: undefined,
          authResult: "AUTHORIZED",
        },
      ],
      [
        "uses manual oauthScope override instead of discovered scopes",
        {
          discoveredScope: "discovered:scope",
          oauthScope: "manual:scope",
          expectScopeCall: false,
          expectedAuthScope: "manual:scope",
          authResult: "AUTHORIZED",
        },
      ],
      [
        "triggers scope discovery when oauthScope is whitespace",
        {
          discoveredScope: "discovered:scope",
          oauthScope: "   ",
          expectScopeCall: true,
          expectedAuthScope: "discovered:scope",
          authResult: "AUTHORIZED",
        },
      ],
      [
        "handles auth failure after scope discovery",
        {
          discoveredScope: "read write",
          oauthScope: undefined,
          expectScopeCall: true,
          expectedAuthScope: "read write",
          authResult: "UNAUTHORIZED",
        },
      ],
    ] as const;

    test.each(testCases)(
      "should %s",
      async (
        _,
        {
          discoveredScope,
          oauthScope,
          expectScopeCall,
          expectedAuthScope,
          authResult = "AUTHORIZED",
        },
      ) => {
        mockDiscoverScopes.mockResolvedValue(discoveredScope);
        mockAuth.mockResolvedValue(authResult as never);
        setup401Error();

        const props =
          oauthScope !== undefined
            ? { ...defaultProps, oauthScope }
            : defaultProps;
        await attemptConnection(props);

        if (expectScopeCall) {
          expect(mockDiscoverScopes).toHaveBeenCalledWith(
            defaultProps.sseUrl,
            undefined,
          );
        } else {
          expect(mockDiscoverScopes).not.toHaveBeenCalled();
        }

        expect(mockAuth).toHaveBeenCalledWith(expect.any(Object), {
          serverUrl: defaultProps.sseUrl,
          scope: expectedAuthScope,
        });
      },
    );

    it("should handle slow scope discovery gracefully", async () => {
      mockDiscoverScopes.mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve(undefined), 100)),
      );

      setup401Error();
      await attemptConnection();

      expect(mockDiscoverScopes).toHaveBeenCalledWith(
        defaultProps.sseUrl,
        undefined,
      );
      expect(mockAuth).toHaveBeenCalledWith(expect.any(Object), {
        serverUrl: defaultProps.sseUrl,
        scope: undefined,
      });
    });
  });

  describe("MCP_PROXY_FULL_ADDRESS Configuration", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Reset the mock transport objects
      mockSSETransport.url = undefined;
      mockSSETransport.options = undefined;
      mockStreamableHTTPTransport.url = undefined;
      mockStreamableHTTPTransport.options = undefined;
    });

    test("sends proxyFullAddress query parameter for stdio transport when configured", async () => {
      const propsWithProxyFullAddress = {
        ...defaultProps,
        transportType: "stdio" as const,
        command: "test-command",
        args: "test-args",
        env: {},
        config: {
          ...DEFAULT_INSPECTOR_CONFIG,
          MCP_PROXY_FULL_ADDRESS: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_FULL_ADDRESS,
            value: "https://example.com/inspector/mcp_proxy",
          },
        },
      };

      const { result } = renderHook(() =>
        useConnection(propsWithProxyFullAddress),
      );

      await act(async () => {
        await result.current.connect();
      });

      // Check that the URL contains the proxyFullAddress parameter
      expect(mockSSETransport.url?.searchParams.get("proxyFullAddress")).toBe(
        "https://example.com/inspector/mcp_proxy",
      );
    });

    test("sends proxyFullAddress query parameter for sse transport when configured", async () => {
      const propsWithProxyFullAddress = {
        ...defaultProps,
        transportType: "sse" as const,
        sseUrl: "http://localhost:8080",
        config: {
          ...DEFAULT_INSPECTOR_CONFIG,
          MCP_PROXY_FULL_ADDRESS: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_FULL_ADDRESS,
            value: "https://example.com/inspector/mcp_proxy",
          },
        },
      };

      const { result } = renderHook(() =>
        useConnection(propsWithProxyFullAddress),
      );

      await act(async () => {
        await result.current.connect();
      });

      // Check that the URL contains the proxyFullAddress parameter
      expect(mockSSETransport.url?.searchParams.get("proxyFullAddress")).toBe(
        "https://example.com/inspector/mcp_proxy",
      );
    });

    test("does not send proxyFullAddress parameter when MCP_PROXY_FULL_ADDRESS is empty", async () => {
      const propsWithEmptyProxy = {
        ...defaultProps,
        transportType: "stdio" as const,
        command: "test-command",
        args: "test-args",
        env: {},
        config: {
          ...DEFAULT_INSPECTOR_CONFIG,
          MCP_PROXY_FULL_ADDRESS: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_FULL_ADDRESS,
            value: "",
          },
        },
      };

      const { result } = renderHook(() => useConnection(propsWithEmptyProxy));

      await act(async () => {
        await result.current.connect();
      });

      // Check that the URL does not contain the proxyFullAddress parameter
      expect(
        mockSSETransport.url?.searchParams.get("proxyFullAddress"),
      ).toBeNull();
    });

    test("does not send proxyFullAddress parameter for streamable-http transport", async () => {
      const propsWithStreamableHttp = {
        ...defaultProps,
        transportType: "streamable-http" as const,
        sseUrl: "http://localhost:8080",
        config: {
          ...DEFAULT_INSPECTOR_CONFIG,
          MCP_PROXY_FULL_ADDRESS: {
            ...DEFAULT_INSPECTOR_CONFIG.MCP_PROXY_FULL_ADDRESS,
            value: "https://example.com/inspector/mcp_proxy",
          },
        },
      };

      const { result } = renderHook(() =>
        useConnection(propsWithStreamableHttp),
      );

      await act(async () => {
        await result.current.connect();
      });

      // Check that streamable-http transport doesn't get proxyFullAddress parameter
      expect(
        mockStreamableHTTPTransport.url?.searchParams.get("proxyFullAddress"),
      ).toBeNull();
    });
  });
});
