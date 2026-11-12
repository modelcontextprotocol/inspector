import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import type {
  CreateTransport,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import { NodeOAuthStorage } from "@inspector/core/auth/node/storage-node.js";
import { createOAuthClientConfig } from "../helpers/oauth-client-fixtures.js";
import type { InspectorClientOptions } from "@inspector/core/mcp/inspectorClient.js";
import { MAX_FETCH_REFUSALS } from "@inspector/core/mcp/inspectorClient.js";
import {
  FetchTargetError,
  type FetchRefusal,
} from "@inspector/core/auth/fetchRefusal.js";

const oauthTestStatePath = path.join(
  os.tmpdir(),
  `mcp-oauth-${process.pid}-inspectorClient-oauth-fetchFn.json`,
);

function createTestOAuthConfig(
  options: Parameters<typeof createOAuthClientConfig>[0],
) {
  return {
    ...createOAuthClientConfig(options),
    storage: new NodeOAuthStorage(oauthTestStatePath),
  };
}

const mockAuth = vi.fn();
// Partial mock: keep every real export (Client, transports, types, …) and
// override only `auth`. A full-replace factory would drop `Client`, which
// InspectorClient imports from the same module.
vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/client")>();
  return {
    ...actual,
    auth: (...args: unknown[]) => mockAuth(...args),
  };
});

describe("InspectorClient OAuth fetchFn", () => {
  let client: InspectorClient;

  afterAll(async () => {
    try {
      await fs.unlink(oauthTestStatePath);
    } catch {
      // Ignore if file does not exist or already removed
    }
  });

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
    const oauthConfig = createTestOAuthConfig({
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
    const oauthConfig = createTestOAuthConfig({
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

    const oauthConfig = createTestOAuthConfig({
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

  // #2749: `environment.oauthFetch` is the base for OAuth work only.
  describe("environment.oauthFetch", () => {
    function jsonResponse(): Response {
      return new Response("{}", {
        headers: { "content-type": "application/json" },
      });
    }

    function newClient(
      environment: Partial<InspectorClientOptions["environment"]>,
    ): InspectorClient {
      const oauthConfig = createTestOAuthConfig({
        mode: "static",
        clientId: "test-client",
        redirectUrl: "http://localhost:3000/callback",
      });
      return new InspectorClient(
        { type: "sse", url: "http://localhost:3000/sse" } as MCPServerConfig,
        {
          environment: {
            transport: createTransportNode,
            oauth: {
              storage: oauthConfig.storage,
              navigation: oauthConfig.navigation,
              redirectUrlProvider: oauthConfig.redirectUrlProvider,
            },
            ...environment,
          },
          oauth: { clientId: oauthConfig.clientId },
        },
      );
    }

    /** The fetch `InspectorClient` handed to the SDK's `auth()`. */
    function authFetchFromMockAuth(): typeof fetch {
      const options = mockAuth.mock.calls[0]?.[1] as
        | { fetchFn?: typeof fetch }
        | undefined;
      if (!options?.fetchFn) throw new Error("auth() got no fetchFn");
      return options.fetchFn;
    }

    it("is the auth chain's base when set", async () => {
      const plain = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
      const oauthFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse());
      client = newClient({ fetch: plain, oauthFetch });
      await client.authenticate();

      await authFetchFromMockAuth()("http://as.example/token");
      expect(oauthFetch).toHaveBeenCalledTimes(1);
      expect(plain).not.toHaveBeenCalled();
    });

    it("leaves the auth chain on environment.fetch when unset", async () => {
      const plain = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
      client = newClient({ fetch: plain });
      await client.authenticate();

      await authFetchFromMockAuth()("http://as.example/token");
      expect(plain).toHaveBeenCalledTimes(1);
    });

    it("takes the transport chain's non-MCP requests, not its MCP ones", async () => {
      const plain = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
      const oauthFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse());
      let transportFetch: typeof fetch | undefined;
      // Captures the chain the transport would be built on, then stops the
      // connect there; nothing past this point is under test.
      const capture: CreateTransport = (_config, options) => {
        transportFetch = options.fetchFn;
        throw new Error("captured");
      };
      client = newClient({ transport: capture, fetch: plain, oauthFetch });
      await expect(client.connect()).rejects.toThrow();
      if (!transportFetch) throw new Error("no transport fetch captured");

      // Legacy SSE: a JSON-RPC message anywhere on the origin is MCP traffic.
      await transportFetch("http://localhost:3000/messages?sessionId=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
      expect(plain).toHaveBeenCalledTimes(1);
      expect(oauthFetch).not.toHaveBeenCalled();

      // The SDK's own discovery from inside the transport.
      await transportFetch(
        "http://as.example/.well-known/oauth-authorization-server",
      );
      expect(oauthFetch).toHaveBeenCalledTimes(1);
      expect(plain).toHaveBeenCalledTimes(1);

      // Same-origin discovery is OAuth too, at a well-known or a custom path,
      // despite the origin-wide exemption (Copilot, #2796).
      await transportFetch(
        "http://localhost:3000/.well-known/oauth-protected-resource",
      );
      await transportFetch("http://localhost:3000/custom/protected-resource");
      expect(oauthFetch).toHaveBeenCalledTimes(3);
      expect(plain).toHaveBeenCalledTimes(1);
    });

    // #2846: a refusal is recorded before any wrapper above can swallow it.
    describe("destination-guard refusals", () => {
      function refusingFetch(): typeof fetch {
        return vi.fn<typeof fetch>((input) =>
          Promise.reject(
            new TypeError("fetch failed", {
              cause: new FetchTargetError(
                "Refusing to fetch from a link-local or metadata address (169.254.169.254)",
                String(input),
              ),
            }),
          ),
        );
      }

      it("records a refusal on the auth chain, fires once per distinct one, and rethrows", async () => {
        client = newClient({ fetch: vi.fn(), oauthFetch: refusingFetch() });
        const heard: FetchRefusal[] = [];
        client.addEventListener("fetchRefused", (e) => heard.push(e.detail));
        await client.authenticate();
        const authFetch = authFetchFromMockAuth();
        const url = "http://169.254.169.254/token";

        await expect(authFetch(url)).rejects.toThrow("fetch failed");
        await expect(authFetch(url)).rejects.toThrow("fetch failed");

        const expected = {
          url,
          reason:
            "Refusing to fetch from a link-local or metadata address (169.254.169.254)",
        };
        expect(client.getFetchRefusals()).toEqual([expected]);
        expect(heard).toEqual([expected]);
      });

      it("records a refusal on the transport base when there is no OAuth base", async () => {
        client = newClient({ fetch: refusingFetch() });
        await client.authenticate();
        await expect(
          authFetchFromMockAuth()("http://169.254.169.254/token"),
        ).rejects.toThrow();
        expect(client.getFetchRefusals()).toHaveLength(1);
      });

      it("ignores failures that are not refusals", async () => {
        client = newClient({
          fetch: vi.fn(),
          oauthFetch: vi
            .fn<typeof fetch>()
            .mockRejectedValue(new Error("ECONNREFUSED")),
        });
        await client.authenticate();
        await expect(
          authFetchFromMockAuth()("http://as.example/token"),
        ).rejects.toThrow("ECONNREFUSED");
        expect(client.getFetchRefusals()).toEqual([]);
      });

      it("keeps only the most recent refusals, and hands out copies", async () => {
        client = newClient({ fetch: vi.fn(), oauthFetch: refusingFetch() });
        await client.authenticate();
        const authFetch = authFetchFromMockAuth();
        for (let i = 0; i <= MAX_FETCH_REFUSALS; i++) {
          await expect(
            authFetch(`http://169.254.169.254/${i}`),
          ).rejects.toThrow();
        }
        const refusals = client.getFetchRefusals();
        expect(refusals).toHaveLength(MAX_FETCH_REFUSALS);
        expect(refusals[0]?.url).toBe("http://169.254.169.254/1");
        refusals.pop();
        expect(client.getFetchRefusals()).toHaveLength(MAX_FETCH_REFUSALS);
      });
    });
  });
});
