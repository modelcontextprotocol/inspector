import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverScopes } from "../../auth/discovery.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

// Mock SDK functions
vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  discoverAuthorizationServerMetadata: vi.fn(),
}));

describe("OAuth Scope Discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return scopes from resource metadata when available", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/authorize",
      token_endpoint: "http://localhost:3000/token",
      response_types_supported: ["code"],
      scopes_supported: ["read", "write"],
    });

    const resourceMetadata: OAuthProtectedResourceMetadata = {
      resource: "http://localhost:3000",
      authorization_servers: ["http://localhost:3000"],
      scopes_supported: ["read", "write", "admin"],
    };

    const scopes = await discoverScopes(
      "http://localhost:3000",
      resourceMetadata,
    );

    expect(scopes).toBe("read write admin");
  });

  it("should fall back to OAuth metadata scopes when resource metadata has no scopes", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/authorize",
      token_endpoint: "http://localhost:3000/token",
      response_types_supported: ["code"],
      scopes_supported: ["read", "write"],
    });

    const resourceMetadata: OAuthProtectedResourceMetadata = {
      resource: "http://localhost:3000",
      authorization_servers: ["http://localhost:3000"],
      scopes_supported: [],
    };

    const scopes = await discoverScopes(
      "http://localhost:3000",
      resourceMetadata,
    );

    expect(scopes).toBe("read write");
  });

  it("should fall back to OAuth metadata scopes when resource metadata is not provided", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/authorize",
      token_endpoint: "http://localhost:3000/token",
      response_types_supported: ["code"],
      scopes_supported: ["read", "write"],
    });

    const scopes = await discoverScopes("http://localhost:3000");

    expect(scopes).toBe("read write");
  });

  it("should return undefined when no scopes are available", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/authorize",
      token_endpoint: "http://localhost:3000/token",
      response_types_supported: ["code"],
      scopes_supported: [],
    });

    const scopes = await discoverScopes("http://localhost:3000");

    expect(scopes).toBeUndefined();
  });

  it("should return undefined when discovery fails", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockRejectedValue(
      new Error("Discovery failed"),
    );

    const scopes = await discoverScopes("http://localhost:3000");

    expect(scopes).toBeUndefined();
  });

  it("should return undefined when metadata is undefined", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue(undefined);

    const scopes = await discoverScopes("http://localhost:3000");

    expect(scopes).toBeUndefined();
  });

  it("should use OAuth metadata scopes when resource has scopes_supported undefined", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/authorize",
      token_endpoint: "http://localhost:3000/token",
      response_types_supported: ["code"],
      scopes_supported: ["read", "write"],
    });

    const resourceMetadata: OAuthProtectedResourceMetadata = {
      resource: "http://localhost:3000",
      authorization_servers: ["http://localhost:3000"],
      scopes_supported: undefined as unknown as string[],
    };

    const scopes = await discoverScopes(
      "http://localhost:3000",
      resourceMetadata,
    );

    expect(scopes).toBe("read write");
  });

  it("should return single scope when only one scope is supported", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/authorize",
      token_endpoint: "http://localhost:3000/token",
      response_types_supported: ["code"],
      scopes_supported: ["openid"],
    });

    const scopes = await discoverScopes("http://localhost:3000");

    expect(scopes).toBe("openid");
  });

  it("should pass fetchFn to discoverAuthorizationServerMetadata when provided", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    const mockFetchFn = vi.fn();
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/authorize",
      token_endpoint: "http://localhost:3000/token",
      response_types_supported: ["code"],
      scopes_supported: ["read", "write"],
    });

    await discoverScopes("http://localhost:3000", undefined, mockFetchFn);

    expect(discoverAuthorizationServerMetadata).toHaveBeenCalledWith(
      new URL("/", "http://localhost:3000"),
      { fetchFn: mockFetchFn },
    );
  });

  it("should use authorization_servers URL from resource metadata for discovery (different domain)", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: "https://auth-server.com",
      authorization_endpoint: "https://auth-server.com/authorize",
      token_endpoint: "https://auth-server.com/token",
      response_types_supported: ["code"],
      scopes_supported: ["read", "write"],
    });

    const resourceMetadata: OAuthProtectedResourceMetadata = {
      resource: "https://mcp-server.com",
      authorization_servers: ["https://auth-server.com/"],
      scopes_supported: ["read", "write"],
    };

    const scopes = await discoverScopes(
      "https://mcp-server.com",
      resourceMetadata,
    );

    expect(scopes).toBe("read write");
    expect(discoverAuthorizationServerMetadata).toHaveBeenCalledWith(
      new URL("https://auth-server.com/"),
      { fetchFn: undefined },
    );
  });

  it("should preserve full path in authorization_servers URL", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: "https://auth-server.com/realms/my-realm",
      authorization_endpoint:
        "https://auth-server.com/realms/my-realm/authorize",
      token_endpoint: "https://auth-server.com/realms/my-realm/token",
      response_types_supported: ["code"],
      scopes_supported: ["read", "write"],
    });

    const resourceMetadata: OAuthProtectedResourceMetadata = {
      resource: "https://mcp-server.com",
      authorization_servers: ["https://auth-server.com/realms/my-realm/"],
      scopes_supported: ["read", "write"],
    };

    const scopes = await discoverScopes(
      "https://mcp-server.com",
      resourceMetadata,
    );

    expect(scopes).toBe("read write");
    expect(discoverAuthorizationServerMetadata).toHaveBeenCalledWith(
      new URL("https://auth-server.com/realms/my-realm/"),
      { fetchFn: undefined },
    );
  });

  it("should fall back to serverUrl when authorization_servers is empty", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/sdk/client/auth.js");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: "https://mcp-server.com",
      authorization_endpoint: "https://mcp-server.com/authorize",
      token_endpoint: "https://mcp-server.com/token",
      response_types_supported: ["code"],
      scopes_supported: ["read", "write"],
    });

    const resourceMetadata: OAuthProtectedResourceMetadata = {
      resource: "https://mcp-server.com",
      authorization_servers: [],
      scopes_supported: ["read", "write"],
    };

    const scopes = await discoverScopes(
      "https://mcp-server.com",
      resourceMetadata,
    );

    expect(scopes).toBe("read write");
    expect(discoverAuthorizationServerMetadata).toHaveBeenCalledWith(
      new URL("/", "https://mcp-server.com"),
      { fetchFn: undefined },
    );
  });
});
