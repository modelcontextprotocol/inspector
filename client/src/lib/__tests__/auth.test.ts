import {
  clearOAuthStateFromSessionStorage,
  discoverScopes,
  getOAuthStateFromSessionStorage,
  InspectorOAuthClientProvider,
} from "../auth";
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";

jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  discoverAuthorizationServerMetadata: jest.fn(),
}));

const mockDiscoverAuth =
  discoverAuthorizationServerMetadata as jest.MockedFunction<
    typeof discoverAuthorizationServerMetadata
  >;

const baseMetadata = {
  issuer: "https://test.com",
  authorization_endpoint: "https://test.com/authorize",
  token_endpoint: "https://test.com/token",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  scopes_supported: ["read", "write"],
};

describe("discoverScopes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const testCases = [
    {
      name: "returns joined scopes from OAuth metadata",
      mockResolves: baseMetadata,
      serverUrl: "https://example.com",
      expected: "read write",
      expectedCallUrl: "https://example.com/",
    },
    {
      name: "prefers resource metadata over OAuth metadata",
      mockResolves: baseMetadata,
      serverUrl: "https://example.com",
      resourceMetadata: {
        resource: "https://example.com",
        scopes_supported: ["admin", "full"],
      },
      expected: "admin full",
    },
    {
      name: "falls back to OAuth when resource has empty scopes",
      mockResolves: baseMetadata,
      serverUrl: "https://example.com",
      resourceMetadata: {
        resource: "https://example.com",
        scopes_supported: [],
      },
      expected: "read write",
    },
    {
      name: "normalizes URL with port and path",
      mockResolves: baseMetadata,
      serverUrl: "https://example.com:8080/some/path",
      expected: "read write",
      expectedCallUrl: "https://example.com:8080/",
    },
    {
      name: "normalizes URL with trailing slash",
      mockResolves: baseMetadata,
      serverUrl: "https://example.com/",
      expected: "read write",
      expectedCallUrl: "https://example.com/",
    },
    {
      name: "handles single scope",
      mockResolves: { ...baseMetadata, scopes_supported: ["admin"] },
      serverUrl: "https://example.com",
      expected: "admin",
    },
    {
      name: "prefers resource metadata even with fewer scopes",
      mockResolves: {
        ...baseMetadata,
        scopes_supported: ["read", "write", "admin", "full"],
      },
      serverUrl: "https://example.com",
      resourceMetadata: {
        resource: "https://example.com",
        scopes_supported: ["read"],
      },
      expected: "read",
    },
  ];

  const undefinedCases = [
    {
      name: "returns undefined when OAuth discovery fails",
      mockRejects: new Error("Discovery failed"),
      serverUrl: "https://example.com",
    },
    {
      name: "returns undefined when OAuth has no scopes",
      mockResolves: { ...baseMetadata, scopes_supported: [] },
      serverUrl: "https://example.com",
    },
    {
      name: "returns undefined when scopes_supported missing",
      mockResolves: (() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { scopes_supported, ...rest } = baseMetadata;
        return rest;
      })(),
      serverUrl: "https://example.com",
    },
    {
      name: "returns undefined with resource metadata but OAuth fails",
      mockRejects: new Error("No OAuth metadata"),
      serverUrl: "https://example.com",
      resourceMetadata: {
        resource: "https://example.com",
        scopes_supported: ["read", "write"],
      },
    },
  ];

  test.each(testCases)(
    "$name",
    async ({
      mockResolves,
      serverUrl,
      resourceMetadata,
      expected,
      expectedCallUrl,
    }) => {
      mockDiscoverAuth.mockResolvedValue(mockResolves);

      const result = await discoverScopes(serverUrl, resourceMetadata);

      expect(result).toBe(expected);
      if (expectedCallUrl) {
        expect(mockDiscoverAuth).toHaveBeenCalledWith(
          new URL(expectedCallUrl),
          { fetchFn: undefined },
        );
      }
    },
  );

  test.each(undefinedCases)(
    "$name",
    async ({ mockResolves, mockRejects, serverUrl, resourceMetadata }) => {
      if (mockRejects) {
        mockDiscoverAuth.mockRejectedValue(mockRejects);
      } else {
        mockDiscoverAuth.mockResolvedValue(mockResolves);
      }

      const result = await discoverScopes(serverUrl, resourceMetadata);

      expect(result).toBeUndefined();
    },
  );
});

describe("InspectorOAuthClientProvider state", () => {
  const serverUrl = "https://example.com/mcp";

  beforeEach(() => {
    sessionStorage.clear();
  });

  it("persists the generated state under a server-specific key", () => {
    const provider = new InspectorOAuthClientProvider(serverUrl);
    const state = provider.state();

    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(getOAuthStateFromSessionStorage(serverUrl)).toBe(state);
  });

  it("scopes the stored state to the server URL", () => {
    const provider = new InspectorOAuthClientProvider(serverUrl);
    const state = provider.state();

    expect(getOAuthStateFromSessionStorage("https://other.com/mcp")).toBe(
      undefined,
    );
    expect(getOAuthStateFromSessionStorage(serverUrl)).toBe(state);
  });

  it("overwrites the stored state on each new authorization request", () => {
    const provider = new InspectorOAuthClientProvider(serverUrl);
    const first = provider.state();
    const second = provider.state();

    expect(second).not.toBe(first);
    expect(getOAuthStateFromSessionStorage(serverUrl)).toBe(second);
  });

  it("clearOAuthStateFromSessionStorage removes the stored state", () => {
    const provider = new InspectorOAuthClientProvider(serverUrl);
    provider.state();

    clearOAuthStateFromSessionStorage(serverUrl);

    expect(getOAuthStateFromSessionStorage(serverUrl)).toBe(undefined);
  });

  it("clear() drops the stored state along with the other session data", () => {
    const provider = new InspectorOAuthClientProvider(serverUrl);
    provider.state();

    provider.clear();

    expect(getOAuthStateFromSessionStorage(serverUrl)).toBe(undefined);
  });
});
