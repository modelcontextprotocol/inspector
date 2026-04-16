import {
  generateOAuthErrorDescription,
  parseOAuthCallbackParams,
  generateOAuthState,
  getAuthorizationServerMetadataDiscoveryUrl,
  getResourceMetadataDiscoveryUrl,
} from "@/utils/oauthUtils.ts";

describe("parseOAuthCallbackParams", () => {
  it("Returns successful: true and code when present", () => {
    expect(parseOAuthCallbackParams("?code=fake-code")).toEqual({
      successful: true,
      code: "fake-code",
    });
  });
  it("Returns successful: false and error when error is present", () => {
    expect(parseOAuthCallbackParams("?error=access_denied")).toEqual({
      successful: false,
      error: "access_denied",
      error_description: null,
      error_uri: null,
    });
  });
  it("Returns optional error metadata fields when present", () => {
    const search =
      "?error=access_denied&" +
      "error_description=User%20Denied%20Request&" +
      "error_uri=https%3A%2F%2Fexample.com%2Ferror-docs";
    expect(parseOAuthCallbackParams(search)).toEqual({
      successful: false,
      error: "access_denied",
      error_description: "User Denied Request",
      error_uri: "https://example.com/error-docs",
    });
  });
  it("Returns error when nothing present", () => {
    expect(parseOAuthCallbackParams("?")).toEqual({
      successful: false,
      error: "invalid_request",
      error_description: "Missing code or error in response",
      error_uri: null,
    });
  });
});

describe("generateOAuthErrorDescription", () => {
  it("When only error is present", () => {
    expect(
      generateOAuthErrorDescription({
        successful: false,
        error: "invalid_request",
        error_description: null,
        error_uri: null,
      }),
    ).toBe("Error: invalid_request.");
  });
  it("When error description is present", () => {
    expect(
      generateOAuthErrorDescription({
        successful: false,
        error: "invalid_request",
        error_description: "The request could not be completed as dialed",
        error_uri: null,
      }),
    ).toEqual(
      "Error: invalid_request.\nDetails: The request could not be completed as dialed.",
    );
  });
  it("When all fields present", () => {
    expect(
      generateOAuthErrorDescription({
        successful: false,
        error: "invalid_request",
        error_description: "The request could not be completed as dialed",
        error_uri: "https://example.com/error-docs",
      }),
    ).toEqual(
      "Error: invalid_request.\nDetails: The request could not be completed as dialed.\nMore info: https://example.com/error-docs.",
    );
  });

  describe("generateOAuthState", () => {
    it("Returns a string", () => {
      expect(generateOAuthState()).toBeDefined();
      expect(generateOAuthState()).toHaveLength(64);
    });
  });
});

describe("getAuthorizationServerMetadataDiscoveryUrl", () => {
  it("uses root discovery URL for root authorization server URL", () => {
    expect(
      getAuthorizationServerMetadataDiscoveryUrl("https://example.com"),
    ).toBe("https://example.com/.well-known/oauth-authorization-server");
  });

  it("inserts tenant path for non-root authorization server URL", () => {
    expect(
      getAuthorizationServerMetadataDiscoveryUrl("https://example.com/tenant1"),
    ).toBe(
      "https://example.com/.well-known/oauth-authorization-server/tenant1",
    );
  });

  it("strips trailing slash before appending tenant path", () => {
    expect(
      getAuthorizationServerMetadataDiscoveryUrl(
        "https://example.com/tenant1/",
      ),
    ).toBe(
      "https://example.com/.well-known/oauth-authorization-server/tenant1",
    );
  });
});

describe("getResourceMetadataDiscoveryUrl", () => {
  it("uses root discovery URL for root server URL", () => {
    expect(getResourceMetadataDiscoveryUrl("https://example.com")).toBe(
      "https://example.com/.well-known/oauth-protected-resource",
    );
  });

  it("appends server path for non-root server URL", () => {
    expect(getResourceMetadataDiscoveryUrl("https://example.com/mcp")).toBe(
      "https://example.com/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("strips trailing slash before appending path", () => {
    expect(getResourceMetadataDiscoveryUrl("https://example.com/mcp/")).toBe(
      "https://example.com/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("handles deeper paths", () => {
    expect(
      getResourceMetadataDiscoveryUrl("https://example.com/api/v1/mcp"),
    ).toBe(
      "https://example.com/.well-known/oauth-protected-resource/api/v1/mcp",
    );
  });
});
