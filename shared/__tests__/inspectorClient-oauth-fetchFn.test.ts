import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InspectorClient } from "../mcp/inspectorClient.js";
import { createTransportNode } from "../mcp/node/transport.js";
import type { MCPServerConfig } from "../mcp/types.js";
import { createOAuthClientConfig } from "../test/test-server-fixtures.js";
import type {
  InspectorClientOptions,
  InspectorClientEnvironment,
} from "../mcp/inspectorClient.js";

const mockAuth = vi.fn();
vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

describe("InspectorClient OAuth fetchFn", () => {
  let client: InspectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});

    mockAuth.mockImplementation(
      async (provider: { redirectToAuthorization: (url: URL) => void }) => {
        provider.redirectToAuthorization(
          new URL("http://example.com/oauth/authorize"),
        );
        return "REDIRECT";
      },
    );
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    vi.restoreAllMocks();
  });

  it("should pass fetchFn to auth() when provided", async () => {
    const mockFetchFn = vi.fn();
    const oauthConfig = createOAuthClientConfig({
      mode: "static",
      clientId: "test-client",
      redirectUrl: "http://localhost:3000/callback",
    });

    client = new InspectorClient(
      { type: "sse", url: "http://localhost:3000/sse" } as MCPServerConfig,
      {
        environment: {
          transport: createTransportNode,
          fetch: mockFetchFn,
          oauth: {
            storage: oauthConfig.storage,
            navigation: oauthConfig.navigation,
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        autoSyncLists: false,
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          clientMetadataUrl: oauthConfig.clientMetadataUrl,
          scope: oauthConfig.scope,
        },
      },
    );

    const url = await client.authenticate();

    expect(url).toBeInstanceOf(URL);
    expect(mockAuth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fetchFn: expect.any(Function),
      }),
    );
  });

  it("should pass fetchFn to auth() when not provided (uses default fetch)", async () => {
    const oauthConfig = createOAuthClientConfig({
      mode: "static",
      clientId: "test-client",
      redirectUrl: "http://localhost:3000/callback",
    });

    client = new InspectorClient(
      { type: "sse", url: "http://localhost:3000/sse" } as MCPServerConfig,
      {
        environment: {
          transport: createTransportNode,
          oauth: {
            storage: oauthConfig.storage,
            navigation: oauthConfig.navigation,
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        autoSyncLists: false,
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          clientMetadataUrl: oauthConfig.clientMetadataUrl,
          scope: oauthConfig.scope,
        },
      } as InspectorClientOptions,
    );

    await client.authenticate();

    expect(mockAuth).toHaveBeenCalled();
    const callArgs = mockAuth.mock.calls[0]!;
    const options = callArgs[1];
    expect(options).toHaveProperty("fetchFn");
    expect(typeof options.fetchFn).toBe("function");
  });

  it("should pass fetchFn to auth() in completeOAuthFlow when provided", async () => {
    const mockFetchFn = vi.fn();
    mockAuth.mockImplementation(
      async (provider: { saveTokens: (tokens: unknown) => void }) => {
        provider.saveTokens({
          access_token: "test-token",
          token_type: "Bearer",
        });
        return "AUTHORIZED";
      },
    );

    const oauthConfig = createOAuthClientConfig({
      mode: "static",
      clientId: "test-client",
      redirectUrl: "http://localhost:3000/callback",
    });

    client = new InspectorClient(
      { type: "sse", url: "http://localhost:3000/sse" } as MCPServerConfig,
      {
        environment: {
          transport: createTransportNode,
          fetch: mockFetchFn,
          oauth: {
            storage: oauthConfig.storage,
            navigation: oauthConfig.navigation,
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        autoSyncLists: false,
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          clientMetadataUrl: oauthConfig.clientMetadataUrl,
          scope: oauthConfig.scope,
        },
      },
    );

    await client.completeOAuthFlow("test-authorization-code");

    expect(mockAuth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        authorizationCode: "test-authorization-code",
        fetchFn: expect.any(Function),
      }),
    );
  });
});
