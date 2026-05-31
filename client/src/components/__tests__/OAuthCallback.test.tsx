import { render, waitFor } from "@testing-library/react";
import OAuthCallback from "../OAuthCallback";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { getServerSpecificKey, SESSION_KEYS } from "../../lib/constants";

jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: jest.fn(),
  extractWWWAuthenticateParams: jest.fn(() => ({})),
}));

jest.mock("../../lib/auth", () => ({
  InspectorOAuthClientProvider: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@/lib/hooks/useToast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

const mockAuth = auth as jest.MockedFunction<typeof auth>;

describe("OAuthCallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue("AUTHORIZED");

    sessionStorage.clear();
    sessionStorage.setItem(
      SESSION_KEYS.SERVER_URL,
      "http://localhost:8080/jenkins/mcp-server/mcp",
    );
    sessionStorage.setItem(
      getServerSpecificKey(
        SESSION_KEYS.RESOURCE_METADATA_URL,
        "http://localhost:8080/jenkins/mcp-server/mcp",
      ),
      "http://localhost:8080/jenkins/.well-known/oauth-protected-resource/mcp-server/mcp",
    );

    window.history.pushState({}, "", "/oauth/callback?code=test-code");
    jest.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("passes persisted resource metadata URL when exchanging authorization code", async () => {
    render(<OAuthCallback onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(mockAuth).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          serverUrl: "http://localhost:8080/jenkins/mcp-server/mcp",
          authorizationCode: "test-code",
          resourceMetadataUrl: new URL(
            "http://localhost:8080/jenkins/.well-known/oauth-protected-resource/mcp-server/mcp",
          ),
        }),
      );
    });
  });

  it("continues without resource metadata URL when none was persisted", async () => {
    sessionStorage.removeItem(
      getServerSpecificKey(
        SESSION_KEYS.RESOURCE_METADATA_URL,
        "http://localhost:8080/jenkins/mcp-server/mcp",
      ),
    );

    render(<OAuthCallback onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(mockAuth).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          serverUrl: "http://localhost:8080/jenkins/mcp-server/mcp",
          authorizationCode: "test-code",
          resourceMetadataUrl: undefined,
        }),
      );
    });
  });
});
