import { EMPTY_DEBUGGER_STATE } from "../auth-types";
import { oauthTransitions, StateMachineContext } from "../oauth-state-machine";
import { DebugInspectorOAuthClientProvider } from "../auth";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";

jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  discoverAuthorizationServerMetadata: jest.fn(),
  discoverOAuthProtectedResourceMetadata: jest.fn(),
  selectResourceURL: jest.fn(),
  registerClient: jest.fn(),
  startAuthorization: jest.fn(),
  exchangeAuthorization: jest.fn(),
}));

jest.mock("@modelcontextprotocol/sdk/shared/auth.js", () => ({
  OAuthMetadataSchema: { parseAsync: jest.fn() },
  OAuthProtectedResourceMetadata: {},
}));

jest.mock("../auth", () => ({
  DebugInspectorOAuthClientProvider: jest.fn().mockImplementation(() => ({
    clientMetadata: {},
    clientInformation: jest.fn().mockResolvedValue(null),
    saveClientInformation: jest.fn(),
    saveServerMetadata: jest.fn(),
    getServerMetadata: jest.fn().mockReturnValue(null),
    saveCodeVerifier: jest.fn(),
    codeVerifier: jest.fn().mockReturnValue("verifier"),
    saveTokens: jest.fn(),
    tokens: jest.fn().mockResolvedValue(undefined),
    scope: undefined,
    redirectUrl: "http://localhost:6274/oauth/callback/debug",
    clear: jest.fn(),
  })),
  discoverScopes: jest.fn().mockResolvedValue(undefined),
}));

const mockDiscoverAuthorizationServerMetadata =
  discoverAuthorizationServerMetadata as jest.MockedFunction<
    typeof discoverAuthorizationServerMetadata
  >;
const mockDiscoverOAuthProtectedResourceMetadata =
  discoverOAuthProtectedResourceMetadata as jest.MockedFunction<
    typeof discoverOAuthProtectedResourceMetadata
  >;
const mockSelectResourceURL = selectResourceURL as jest.MockedFunction<
  typeof selectResourceURL
>;
const mockParseAsync = OAuthMetadataSchema.parseAsync as jest.MockedFunction<
  typeof OAuthMetadataSchema.parseAsync
>;
const MockDebugInspectorOAuthClientProvider =
  DebugInspectorOAuthClientProvider as jest.MockedClass<
    typeof DebugInspectorOAuthClientProvider
  >;

const baseOAuthMetadata = {
  issuer: "http://localhost:8000",
  authorization_endpoint: "http://localhost:8000/oauth/authorize",
  token_endpoint: "http://localhost:8000/oauth/token",
  response_types_supported: ["code"] as string[],
};

function makeContext(serverUrl: string): StateMachineContext {
  return {
    serverUrl,
    state: { ...EMPTY_DEBUGGER_STATE, oauthStep: "metadata_discovery" },
    provider: new MockDebugInspectorOAuthClientProvider(serverUrl),
    updateState: jest.fn(),
  };
}

describe("oauthTransitions.metadata_discovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectResourceURL.mockResolvedValue(undefined);
    mockParseAsync.mockResolvedValue(baseOAuthMetadata);
    mockDiscoverAuthorizationServerMetadata.mockResolvedValue(
      baseOAuthMetadata,
    );
  });

  describe("when RFC 9728 protected resource metadata is unavailable", () => {
    beforeEach(() => {
      mockDiscoverOAuthProtectedResourceMetadata.mockRejectedValue(
        new Error(
          "Resource server does not implement OAuth 2.0 Protected Resource Metadata.",
        ),
      );
    });

    it("preserves the sub-path when calling discoverAuthorizationServerMetadata (RFC 8414)", async () => {
      const serverUrl = "http://localhost:8000/api/mcp/github/mcp";
      const context = makeContext(serverUrl);

      await oauthTransitions.metadata_discovery.execute(context);

      const [calledUrl] = mockDiscoverAuthorizationServerMetadata.mock.calls[0];
      // Full path preserved so the SDK builds the path-scoped /.well-known/oauth-authorization-server/<path> URL (RFC 8414 §3).
      expect((calledUrl as URL).pathname).toBe("/api/mcp/github/mcp");
    });

    it("uses bare origin for root-mounted servers", async () => {
      const serverUrl = "http://localhost:8000";
      const context = makeContext(serverUrl);

      await oauthTransitions.metadata_discovery.execute(context);

      const [calledUrl] = mockDiscoverAuthorizationServerMetadata.mock.calls[0];
      expect((calledUrl as URL).pathname).toBe("/");
    });
  });

  describe("mount-relative protected resource metadata fallback", () => {
    it("tries {serverUrl}/.well-known/oauth-protected-resource for sub-path servers when RFC 9728 fails", async () => {
      const serverUrl = "http://localhost:8000/api/mcp/github/mcp";
      const authServer = "http://localhost:4444";

      mockDiscoverOAuthProtectedResourceMetadata
        .mockRejectedValueOnce(
          new Error(
            "Resource server does not implement OAuth 2.0 Protected Resource Metadata.",
          ),
        )
        .mockResolvedValueOnce({
          resource: serverUrl,
          authorization_servers: [authServer],
        });

      const context = makeContext(serverUrl);
      await oauthTransitions.metadata_discovery.execute(context);

      const secondCallOpts =
        mockDiscoverOAuthProtectedResourceMetadata.mock.calls[1][1];
      expect(secondCallOpts?.resourceMetadataUrl).toBe(
        "http://localhost:8000/api/mcp/github/mcp/.well-known/oauth-protected-resource",
      );

      // Auth server comes from resource metadata, not from the MCP server URL.
      const [calledUrl] = mockDiscoverAuthorizationServerMetadata.mock.calls[0];
      expect((calledUrl as URL).href).toBe(`${authServer}/`);
    });

    it("does not attempt mount-relative fallback for root-mounted servers", async () => {
      const serverUrl = "http://localhost:8000";

      mockDiscoverOAuthProtectedResourceMetadata.mockRejectedValue(
        new Error(
          "Resource server does not implement OAuth 2.0 Protected Resource Metadata.",
        ),
      );

      const context = makeContext(serverUrl);
      await oauthTransitions.metadata_discovery.execute(context);

      expect(mockDiscoverOAuthProtectedResourceMetadata).toHaveBeenCalledTimes(
        1,
      );
    });

    it("strips trailing slash from server path before constructing mount-relative URL", async () => {
      const serverUrl = "http://localhost:8000/api/mcp/github/mcp/";

      mockDiscoverOAuthProtectedResourceMetadata
        .mockRejectedValueOnce(new Error("not found"))
        .mockResolvedValueOnce({
          resource: serverUrl,
          authorization_servers: ["http://localhost:4444"],
        });

      const context = makeContext(serverUrl);
      await oauthTransitions.metadata_discovery.execute(context);

      const secondCallOpts =
        mockDiscoverOAuthProtectedResourceMetadata.mock.calls[1][1];
      expect(secondCallOpts?.resourceMetadataUrl).toBe(
        "http://localhost:8000/api/mcp/github/mcp/.well-known/oauth-protected-resource",
      );
    });
  });

  describe("when protected resource metadata is available via RFC 9728", () => {
    it("uses the authorization server from resource metadata", async () => {
      const serverUrl = "http://localhost:8000/api/mcp/github/mcp";
      const authServer = "http://localhost:4444";

      mockDiscoverOAuthProtectedResourceMetadata.mockResolvedValue({
        resource: serverUrl,
        authorization_servers: [authServer],
      });

      const context = makeContext(serverUrl);
      await oauthTransitions.metadata_discovery.execute(context);

      const [calledUrl] = mockDiscoverAuthorizationServerMetadata.mock.calls[0];
      expect((calledUrl as URL).href).toBe(`${authServer}/`);
    });
  });
});
