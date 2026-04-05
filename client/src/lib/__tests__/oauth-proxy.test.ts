/**
 * Tests for OAuth Proxy Utilities
 */

import {
  discoverAuthorizationServerMetadataViaProxy,
  discoverOAuthProtectedResourceMetadataViaProxy,
  registerClientViaProxy,
  exchangeAuthorizationViaProxy,
} from "../oauth-proxy";
import { InspectorConfig } from "../configurationTypes";

// Mock the config utils
jest.mock("@/utils/configUtils", () => ({
  getMCPProxyAddress: jest.fn(() => "http://localhost:6277"),
  getMCPProxyAuthToken: jest.fn(() => ({
    token: "test-token",
    header: "x-mcp-proxy-auth",
  })),
}));

// Mock global fetch
global.fetch = jest.fn();

const mockConfig: InspectorConfig = {
  MCP_SERVER_REQUEST_TIMEOUT: {
    label: "Request Timeout",
    description: "Timeout for MCP requests",
    value: 30000,
    is_session_item: false,
  },
  MCP_REQUEST_TIMEOUT_RESET_ON_PROGRESS: {
    label: "Reset Timeout on Progress",
    description: "Reset timeout on progress notifications",
    value: true,
    is_session_item: false,
  },
  MCP_REQUEST_MAX_TOTAL_TIMEOUT: {
    label: "Max Total Timeout",
    description: "Maximum total timeout",
    value: 300000,
    is_session_item: false,
  },
  MCP_PROXY_FULL_ADDRESS: {
    label: "Proxy Address",
    description: "Full address of the MCP proxy",
    value: "http://localhost:6277",
    is_session_item: false,
  },
  MCP_PROXY_AUTH_TOKEN: {
    label: "Proxy Auth Token",
    description: "Authentication token for the proxy",
    value: "test-token",
    is_session_item: false,
  },
};

describe("OAuth Proxy Utilities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("discoverAuthorizationServerMetadataViaProxy", () => {
    it("should successfully fetch metadata through proxy", async () => {
      const mockMetadata = {
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetadata,
      });

      const result = await discoverAuthorizationServerMetadataViaProxy(
        new URL("https://auth.example.com"),
        mockConfig,
      );

      expect(result).toEqual(mockMetadata);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:6277/oauth/metadata?url=https%3A%2F%2Fauth.example.com%2F.well-known%2Foauth-authorization-server",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-mcp-proxy-auth": "Bearer test-token",
          },
        },
      );
    });

    it("should handle network errors", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        discoverAuthorizationServerMetadataViaProxy(
          new URL("https://auth.example.com"),
          mockConfig,
        ),
      ).rejects.toThrow("Network error");
    });

    it("should handle non-ok responses", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "Metadata not found" }),
      });

      await expect(
        discoverAuthorizationServerMetadataViaProxy(
          new URL("https://auth.example.com"),
          mockConfig,
        ),
      ).rejects.toThrow(
        "Failed to discover OAuth metadata: Not found: Metadata not found",
      );
    });

    it("should handle responses without error details", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      await expect(
        discoverAuthorizationServerMetadataViaProxy(
          new URL("https://auth.example.com"),
          mockConfig,
        ),
      ).rejects.toThrow(
        "Failed to discover OAuth metadata: Server error (500): Internal Server Error",
      );
    });
  });

  describe("discoverOAuthProtectedResourceMetadataViaProxy", () => {
    it("should successfully fetch resource metadata through proxy", async () => {
      const mockMetadata = {
        resource: "https://api.example.com",
        authorization_servers: ["https://auth.example.com"],
        scopes_supported: ["read", "write"],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockMetadata,
      });

      const result = await discoverOAuthProtectedResourceMetadataViaProxy(
        "https://api.example.com",
        mockConfig,
      );

      expect(result).toEqual(mockMetadata);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:6277/oauth/resource-metadata?url=https%3A%2F%2Fapi.example.com%2F.well-known%2Foauth-protected-resource",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-mcp-proxy-auth": "Bearer test-token",
          },
        },
      );
    });

    it("should handle errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "Resource metadata not found" }),
      });

      await expect(
        discoverOAuthProtectedResourceMetadataViaProxy(
          "https://api.example.com",
          mockConfig,
        ),
      ).rejects.toThrow(
        "Failed to discover resource metadata: Not found: Resource metadata not found",
      );
    });
  });

  describe("registerClientViaProxy", () => {
    it("should successfully register client through proxy", async () => {
      const clientMetadata = {
        client_name: "Test Client",
        redirect_uris: ["http://localhost:6274/oauth/callback"],
        grant_types: ["authorization_code"],
      };

      const mockClientInformation = {
        client_id: "test-client-id",
        client_secret: "test-client-secret",
        ...clientMetadata,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockClientInformation,
      });

      const result = await registerClientViaProxy(
        "https://auth.example.com/register",
        clientMetadata,
        mockConfig,
      );

      expect(result).toEqual(mockClientInformation);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:6277/oauth/register",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mcp-proxy-auth": "Bearer test-token",
          },
          body: JSON.stringify({
            registrationEndpoint: "https://auth.example.com/register",
            clientMetadata,
          }),
        },
      );
    });

    it("should handle registration errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ error: "Invalid client metadata" }),
      });

      await expect(
        registerClientViaProxy(
          "https://auth.example.com/register",
          {
            client_name: "Test",
            redirect_uris: ["http://localhost:6274/oauth/callback"],
          },
          mockConfig,
        ),
      ).rejects.toThrow(
        "Failed to register client: Bad Request: Invalid client metadata",
      );
    });
  });

  describe("exchangeAuthorizationViaProxy", () => {
    it("should successfully exchange authorization code through proxy", async () => {
      const params = {
        grant_type: "authorization_code",
        code: "test-auth-code",
        redirect_uri: "http://localhost:6274/oauth/callback",
        code_verifier: "test-verifier",
        client_id: "test-client-id",
      };

      const mockTokens = {
        access_token: "test-access-token",
        token_type: "Bearer",
        expires_in: 3600,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokens,
      });

      const result = await exchangeAuthorizationViaProxy(
        "https://auth.example.com/token",
        params,
        mockConfig,
      );

      expect(result).toEqual(mockTokens);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:6277/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mcp-proxy-auth": "Bearer test-token",
          },
          body: JSON.stringify({
            tokenEndpoint: "https://auth.example.com/token",
            params,
          }),
        },
      );
    });

    it("should handle token exchange errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ error: "invalid_grant" }),
      });

      await expect(
        exchangeAuthorizationViaProxy(
          "https://auth.example.com/token",
          { grant_type: "authorization_code", code: "invalid" },
          mockConfig,
        ),
      ).rejects.toThrow(
        "Failed to exchange authorization code: Authentication failed: invalid_grant",
      );
    });

    it("should handle network failures", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      await expect(
        exchangeAuthorizationViaProxy(
          "https://auth.example.com/token",
          { grant_type: "authorization_code", code: "test" },
          mockConfig,
        ),
      ).rejects.toThrow("Connection refused");
    });
  });
});
