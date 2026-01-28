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
});
