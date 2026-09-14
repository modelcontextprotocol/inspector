import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverAuthorizationServerMetadataForServer,
  discoverScopes,
  getAuthorizationServerUrl,
  getAuthorizationServerUrlCandidates,
} from "@inspector/core/auth/discovery.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/client";

// Mock SDK functions
vi.mock("@modelcontextprotocol/client", () => ({
  discoverAuthorizationServerMetadata: vi.fn(),
}));

describe("OAuth Scope Discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return scopes from resource metadata when available", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/client");
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
      await import("@modelcontextprotocol/client");
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
      await import("@modelcontextprotocol/client");
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
      await import("@modelcontextprotocol/client");
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
      await import("@modelcontextprotocol/client");
    vi.mocked(discoverAuthorizationServerMetadata).mockRejectedValue(
      new Error("Discovery failed"),
    );

    const scopes = await discoverScopes("http://localhost:3000");

    expect(scopes).toBeUndefined();
  });

  it("should return undefined when metadata is undefined", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/client");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue(undefined);

    const scopes = await discoverScopes("http://localhost:3000");

    expect(scopes).toBeUndefined();
  });

  it("should use OAuth metadata scopes when resource has scopes_supported undefined", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/client");
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
      await import("@modelcontextprotocol/client");
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
      await import("@modelcontextprotocol/client");
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
      await import("@modelcontextprotocol/client");
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
      await import("@modelcontextprotocol/client");
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
      await import("@modelcontextprotocol/client");
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

describe("getAuthorizationServerUrl", () => {
  const serverUrl = "https://mcp.example.com";

  it("returns server URL when resourceMetadata is null", () => {
    expect(getAuthorizationServerUrl(serverUrl, null)).toEqual(
      new URL("/", serverUrl),
    );
  });

  it("returns server URL when resourceMetadata is undefined", () => {
    expect(getAuthorizationServerUrl(serverUrl)).toEqual(
      new URL("/", serverUrl),
    );
  });

  it("returns server URL when authorization_servers is empty array", () => {
    const resourceMetadata: OAuthProtectedResourceMetadata = {
      resource: serverUrl,
      authorization_servers: [],
    };
    expect(getAuthorizationServerUrl(serverUrl, resourceMetadata)).toEqual(
      new URL("/", serverUrl),
    );
  });

  it("falls back to server URL when authorization_servers[0] is empty string", () => {
    const resourceMetadata: OAuthProtectedResourceMetadata = {
      resource: serverUrl,
      authorization_servers: [""],
    };
    expect(getAuthorizationServerUrl(serverUrl, resourceMetadata)).toEqual(
      new URL("/", serverUrl),
    );
  });

  it("returns authorization_servers[0] when present and truthy", () => {
    const authUrl = "https://auth.example.com/";
    const resourceMetadata: OAuthProtectedResourceMetadata = {
      resource: serverUrl,
      authorization_servers: [authUrl],
    };
    expect(getAuthorizationServerUrl(serverUrl, resourceMetadata)).toEqual(
      new URL(authUrl),
    );
  });

  it("throws a descriptive error when the MCP server URL is invalid", () => {
    // "not a url" cannot be parsed by `new URL("/", serverUrl)`, exercising the
    // catch block that wraps the underlying parse failure (discovery.ts 21-22).
    expect(() => getAuthorizationServerUrl("not a url")).toThrow(
      /Invalid MCP server URL: "not a url"/,
    );
  });

  it("includes the underlying error detail in the thrown message", () => {
    let captured: Error | undefined;
    try {
      getAuthorizationServerUrl("");
    } catch (err) {
      captured = err instanceof Error ? err : undefined;
    }
    expect(captured).toBeInstanceOf(Error);
    // The wrapped message carries the parenthesised detail from the parse failure.
    expect(captured?.message).toMatch(/Invalid MCP server URL: "" \(.+\)/);
  });
});

// #2110: an MCP server hosted under a path (Moodle, a WordPress plugin, any
// PHP endpoint) publishes its OAuth metadata under that same path. Reducing the
// fallback authorization-server URL to the origin threw that path away, so
// discovery could only ever probe the domain root and 404'd.
describe("path-hosted MCP servers (#2110)", () => {
  const pathServerUrl = "https://misc.example.com/mod/minilesson/mcp.php";

  describe("getAuthorizationServerUrl", () => {
    it("keeps the server's path in the fallback URL", () => {
      expect(getAuthorizationServerUrl(pathServerUrl)).toEqual(
        new URL(pathServerUrl),
      );
    });

    it("strips query and fragment, which an RFC 8414 issuer never carries", () => {
      expect(
        getAuthorizationServerUrl(`${pathServerUrl}?session=abc#frag`),
      ).toEqual(new URL(pathServerUrl));
    });
  });

  describe("getAuthorizationServerUrlCandidates", () => {
    it("tries the path-scoped URL before the bare origin", () => {
      expect(getAuthorizationServerUrlCandidates(pathServerUrl)).toEqual([
        new URL(pathServerUrl),
        new URL("https://misc.example.com/"),
      ]);
    });

    it("offers a single candidate for a root-hosted server", () => {
      expect(
        getAuthorizationServerUrlCandidates("https://mcp.example.com"),
      ).toEqual([new URL("https://mcp.example.com/")]);
    });

    it("does not probe past an authorization server named by resource metadata", () => {
      const resourceMetadata: OAuthProtectedResourceMetadata = {
        resource: pathServerUrl,
        authorization_servers: ["https://auth.example.com/realms/r"],
      };
      expect(
        getAuthorizationServerUrlCandidates(pathServerUrl, resourceMetadata),
      ).toEqual([new URL("https://auth.example.com/realms/r")]);
    });
  });

  describe("discoverAuthorizationServerMetadataForServer", () => {
    const metadata = {
      issuer: pathServerUrl,
      authorization_endpoint: "https://misc.example.com/mod/authorize.php",
      token_endpoint: "https://misc.example.com/mod/token.php",
      response_types_supported: ["code"],
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns the path-scoped result without probing the origin", async () => {
      const { discoverAuthorizationServerMetadata } =
        await import("@modelcontextprotocol/client");
      vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue(
        metadata,
      );

      await expect(
        discoverAuthorizationServerMetadataForServer(pathServerUrl),
      ).resolves.toEqual(metadata);
      expect(discoverAuthorizationServerMetadata).toHaveBeenCalledTimes(1);
      expect(discoverAuthorizationServerMetadata).toHaveBeenCalledWith(
        new URL(pathServerUrl),
        { fetchFn: undefined },
      );
    });

    it("falls back to the origin when the path-scoped candidate has no metadata", async () => {
      const { discoverAuthorizationServerMetadata } =
        await import("@modelcontextprotocol/client");
      vi.mocked(discoverAuthorizationServerMetadata)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(metadata);

      await expect(
        discoverAuthorizationServerMetadataForServer(pathServerUrl),
      ).resolves.toEqual(metadata);
      expect(discoverAuthorizationServerMetadata).toHaveBeenNthCalledWith(
        2,
        new URL("https://misc.example.com/"),
        { fetchFn: undefined },
      );
    });

    it("survives a throwing candidate while another remains", async () => {
      const { discoverAuthorizationServerMetadata } =
        await import("@modelcontextprotocol/client");
      vi.mocked(discoverAuthorizationServerMetadata)
        .mockRejectedValueOnce(new Error("issuer mismatch"))
        .mockResolvedValueOnce(metadata);

      await expect(
        discoverAuthorizationServerMetadataForServer(pathServerUrl),
      ).resolves.toEqual(metadata);
    });

    it("rethrows the first error when every candidate fails", async () => {
      const { discoverAuthorizationServerMetadata } =
        await import("@modelcontextprotocol/client");
      vi.mocked(discoverAuthorizationServerMetadata)
        .mockRejectedValueOnce(new Error("path-scoped failed"))
        .mockRejectedValueOnce(new Error("origin failed"));

      await expect(
        discoverAuthorizationServerMetadataForServer(pathServerUrl),
      ).rejects.toThrow("path-scoped failed");
    });

    it("resolves undefined when every candidate answers with no metadata", async () => {
      const { discoverAuthorizationServerMetadata } =
        await import("@modelcontextprotocol/client");
      vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue(
        undefined,
      );

      await expect(
        discoverAuthorizationServerMetadataForServer(pathServerUrl),
      ).resolves.toBeUndefined();
      expect(discoverAuthorizationServerMetadata).toHaveBeenCalledTimes(2);
    });

    it("passes the caller's fetch through to every candidate", async () => {
      const { discoverAuthorizationServerMetadata } =
        await import("@modelcontextprotocol/client");
      vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue(
        undefined,
      );
      const fetchFn = vi.fn<typeof fetch>();

      await discoverAuthorizationServerMetadataForServer(
        pathServerUrl,
        undefined,
        fetchFn,
      );

      expect(discoverAuthorizationServerMetadata).toHaveBeenCalledWith(
        new URL(pathServerUrl),
        { fetchFn },
      );
    });
  });

  it("discoverScopes reaches a path-hosted authorization server", async () => {
    const { discoverAuthorizationServerMetadata } =
      await import("@modelcontextprotocol/client");
    vi.mocked(discoverAuthorizationServerMetadata).mockResolvedValue({
      issuer: pathServerUrl,
      authorization_endpoint: "https://misc.example.com/mod/authorize.php",
      token_endpoint: "https://misc.example.com/mod/token.php",
      response_types_supported: ["code"],
      scopes_supported: ["read"],
    });

    await expect(discoverScopes(pathServerUrl)).resolves.toBe("read");
    expect(discoverAuthorizationServerMetadata).toHaveBeenCalledWith(
      new URL(pathServerUrl),
      { fetchFn: undefined },
    );
  });
});
