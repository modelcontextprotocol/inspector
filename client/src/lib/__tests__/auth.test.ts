import { discoverScopes, revokeTokens } from "../auth";
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";
import { SESSION_KEYS, getServerSpecificKey } from "../constants";

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

describe("revokeTokens", () => {
  const serverUrl = "https://example.com";
  const revocationEndpoint = "https://test.com/revoke";
  const metadataWithRevocation = {
    ...baseMetadata,
    revocation_endpoint: revocationEndpoint,
  };

  const seedTokens = (tokens: {
    access_token: string;
    token_type?: string;
    refresh_token?: string;
  }) => {
    sessionStorage.setItem(
      getServerSpecificKey(SESSION_KEYS.TOKENS, serverUrl),
      JSON.stringify({ token_type: "Bearer", ...tokens }),
    );
  };

  const seedClientInfo = (
    client_id: string,
    { isPreregistered = false } = {},
  ) => {
    const key = getServerSpecificKey(
      isPreregistered
        ? SESSION_KEYS.PREREGISTERED_CLIENT_INFORMATION
        : SESSION_KEYS.CLIENT_INFORMATION,
      serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify({ client_id }));
  };

  const parseRevokeBody = (call: [unknown, RequestInit | undefined]) => {
    const init = call[1];
    return new URLSearchParams(init?.body as string);
  };

  let warnSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    debugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it("posts refresh_token to revocation_endpoint when available, includes client_id", async () => {
    mockDiscoverAuth.mockResolvedValue(metadataWithRevocation);
    seedTokens({ access_token: "at-123", refresh_token: "rt-456" });
    seedClientInfo("client-xyz");
    const fetchFn = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(new Response(null, { status: 200 }));

    await revokeTokens({ serverUrl, fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(revocationEndpoint);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = parseRevokeBody(fetchFn.mock.calls[0]);
    expect(body.get("token")).toBe("rt-456");
    expect(body.get("token_type_hint")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("client-xyz");
  });

  it("prefers preregistered client_id over dynamic", async () => {
    mockDiscoverAuth.mockResolvedValue(metadataWithRevocation);
    seedTokens({ access_token: "at-123", refresh_token: "rt-456" });
    seedClientInfo("dynamic-client");
    seedClientInfo("preregistered-client", { isPreregistered: true });
    const fetchFn = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(new Response(null, { status: 200 }));

    await revokeTokens({ serverUrl, fetchFn });

    const body = parseRevokeBody(fetchFn.mock.calls[0]);
    expect(body.get("client_id")).toBe("preregistered-client");
  });

  it("falls back to access_token when no refresh_token is present", async () => {
    mockDiscoverAuth.mockResolvedValue(metadataWithRevocation);
    seedTokens({ access_token: "at-only" });
    const fetchFn = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(new Response(null, { status: 200 }));

    await revokeTokens({ serverUrl, fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = parseRevokeBody(fetchFn.mock.calls[0]);
    expect(body.get("token")).toBe("at-only");
    expect(body.get("token_type_hint")).toBe("access_token");
    expect(body.get("client_id")).toBeNull();
  });

  it("no-ops when no tokens are stored", async () => {
    const fetchFn = jest.fn<
      Promise<Response>,
      [RequestInfo | URL, RequestInit?]
    >();

    await revokeTokens({ serverUrl, fetchFn });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(mockDiscoverAuth).not.toHaveBeenCalled();
  });

  it("no-ops when AS metadata has no revocation_endpoint", async () => {
    mockDiscoverAuth.mockResolvedValue(baseMetadata);
    seedTokens({ access_token: "at-123", refresh_token: "rt-456" });
    const fetchFn = jest.fn<
      Promise<Response>,
      [RequestInfo | URL, RequestInit?]
    >();

    await revokeTokens({ serverUrl, fetchFn });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("swallows fetch rejection and logs a warning", async () => {
    mockDiscoverAuth.mockResolvedValue(metadataWithRevocation);
    seedTokens({ access_token: "at-123", refresh_token: "rt-456" });
    const fetchFn = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockRejectedValue(new Error("network down"));

    await expect(revokeTokens({ serverUrl, fetchFn })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "Token revocation failed (best-effort):",
      expect.any(Error),
    );
  });

  it("treats non-2xx response as a soft failure without throwing", async () => {
    mockDiscoverAuth.mockResolvedValue(metadataWithRevocation);
    seedTokens({ access_token: "at-123", refresh_token: "rt-456" });
    const fetchFn = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(
        new Response("nope", { status: 400, statusText: "Bad Request" }),
      );

    await expect(revokeTokens({ serverUrl, fetchFn })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Token revocation responded 400"),
    );
  });

  it("uses the provided fetchFn, not the global fetch", async () => {
    mockDiscoverAuth.mockResolvedValue(metadataWithRevocation);
    seedTokens({ access_token: "at-123", refresh_token: "rt-456" });
    const globalFetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const fetchFn = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(new Response(null, { status: 200 }));

    try {
      await revokeTokens({ serverUrl, fetchFn });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(globalFetchSpy).not.toHaveBeenCalled();
    } finally {
      globalFetchSpy.mockRestore();
    }
  });
});
