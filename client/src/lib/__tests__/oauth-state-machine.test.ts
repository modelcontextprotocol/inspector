import { OAuthStateMachine } from "../oauth-state-machine";
import { EMPTY_DEBUGGER_STATE } from "../auth-types";
import { getServerSpecificKey, SESSION_KEYS } from "../constants";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";

jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  discoverAuthorizationServerMetadata: jest.fn(),
  registerClient: jest.fn(),
  startAuthorization: jest.fn(),
  exchangeAuthorization: jest.fn(),
  discoverOAuthProtectedResourceMetadata: jest.fn(),
  extractWWWAuthenticateParams: jest.fn(),
  selectResourceURL: jest.fn(),
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
const mockExtractWWWAuthenticateParams =
  extractWWWAuthenticateParams as jest.MockedFunction<
    typeof extractWWWAuthenticateParams
  >;

describe("OAuthStateMachine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();

    mockDiscoverAuthorizationServerMetadata.mockResolvedValue({
      issuer: "https://auth.example.com",
      authorization_endpoint: "https://auth.example.com/authorize",
      token_endpoint: "https://auth.example.com/token",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
    });
    mockSelectResourceURL.mockResolvedValue(
      new URL("http://localhost:8080/jenkins/mcp-server/mcp"),
    );
    mockExtractWWWAuthenticateParams.mockReturnValue({});
  });

  it("uses resource_metadata from the current server challenge", async () => {
    const serverUrl = "http://localhost:8080/jenkins/mcp-server/mcp";
    const resourceMetadataUrl = new URL(
      "http://localhost:8080/jenkins/.well-known/oauth-protected-resource/mcp-server/mcp",
    );
    const resourceMetadata = {
      resource: serverUrl,
      authorization_servers: ["https://auth.example.com"],
    };
    const fetchFn = jest.fn().mockResolvedValue(
      new Response("{}", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl.href}"`,
        },
      }),
    ) as jest.MockedFunction<typeof fetch>;

    mockDiscoverOAuthProtectedResourceMetadata.mockResolvedValue(
      resourceMetadata,
    );
    mockExtractWWWAuthenticateParams.mockReturnValue({
      resourceMetadataUrl,
    });

    await new OAuthStateMachine(serverUrl, jest.fn(), fetchFn).executeStep({
      ...EMPTY_DEBUGGER_STATE,
      oauthStep: "metadata_discovery",
    });

    expect(fetchFn).toHaveBeenCalledWith(serverUrl, expect.any(Object));
    expect(mockDiscoverOAuthProtectedResourceMetadata).toHaveBeenCalledWith(
      serverUrl,
      { resourceMetadataUrl },
      fetchFn,
    );
    expect(
      sessionStorage.getItem(
        getServerSpecificKey(SESSION_KEYS.RESOURCE_METADATA_URL, serverUrl),
      ),
    ).toBe(resourceMetadataUrl.href);
  });

  it("does not reuse stored resource_metadata without a current challenge", async () => {
    const serverUrl = "http://localhost:8080/current/mcp";
    const storageKey = getServerSpecificKey(
      SESSION_KEYS.RESOURCE_METADATA_URL,
      serverUrl,
    );
    const fetchFn = jest.fn().mockResolvedValue(
      new Response("{}", {
        status: 401,
      }),
    ) as jest.MockedFunction<typeof fetch>;

    sessionStorage.setItem(
      storageKey,
      "http://localhost:8080/previous/.well-known/oauth-protected-resource",
    );
    mockDiscoverOAuthProtectedResourceMetadata.mockResolvedValue({
      resource: serverUrl,
      authorization_servers: ["https://auth.example.com"],
    });

    await new OAuthStateMachine(serverUrl, jest.fn(), fetchFn).executeStep({
      ...EMPTY_DEBUGGER_STATE,
      oauthStep: "metadata_discovery",
    });

    expect(mockDiscoverOAuthProtectedResourceMetadata).toHaveBeenCalledWith(
      serverUrl,
      {},
      fetchFn,
    );
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
});
