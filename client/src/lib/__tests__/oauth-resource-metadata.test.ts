import {
  clearResourceMetadataUrlFromSessionStorage,
  discoverResourceMetadataUrlFromServer,
  extractResourceMetadataUrlFromAuthError,
  extractResourceMetadataUrlFromWWWAuthenticate,
  getResourceMetadataUrlFromSessionStorage,
  saveResourceMetadataUrlToSessionStorage,
} from "../oauth-resource-metadata";

// The SDK auth module imports PKCE generation eagerly, but these tests only
// exercise its WWW-Authenticate parser.
jest.mock("pkce-challenge", () => jest.fn(), { virtual: true });

describe("oauth-resource-metadata", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("extracts resource_metadata from WWW-Authenticate", () => {
    expect(
      extractResourceMetadataUrlFromWWWAuthenticate(
        'Bearer realm="mcp", resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp"',
      ),
    ).toEqual(
      new URL("https://example.com/.well-known/oauth-protected-resource/mcp"),
    );
  });

  it("extracts resource_metadata alongside other Bearer challenge parameters", () => {
    expect(
      extractResourceMetadataUrlFromWWWAuthenticate(
        'Bearer realm="mcp", resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp", scope="read write"',
      ),
    ).toEqual(
      new URL("https://example.com/.well-known/oauth-protected-resource/mcp"),
    );
  });

  it.each([
    ["a missing resource_metadata parameter", 'Bearer realm="mcp"'],
    [
      "an invalid resource_metadata URL",
      'Bearer resource_metadata="not a URL"',
    ],
    [
      "a non-Bearer challenge",
      'Basic resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp"',
    ],
  ])("ignores %s", (_description, wwwAuthenticate) => {
    expect(
      extractResourceMetadataUrlFromWWWAuthenticate(wwwAuthenticate),
    ).toBeUndefined();
  });

  it("extracts resource_metadata from a proxy upstream401 snapshot", () => {
    expect(
      extractResourceMetadataUrlFromAuthError({
        data: {
          upstream401: {
            wwwAuthenticate:
              'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp"',
          },
        },
      }),
    ).toEqual(
      new URL("https://example.com/.well-known/oauth-protected-resource/mcp"),
    );
  });

  it.each([
    ["missing data", {}],
    ["null data", { data: null }],
    ["array data", { data: [] }],
    ["missing upstream401", { data: {} }],
    ["null upstream401", { data: { upstream401: null } }],
    [
      "non-string WWW-Authenticate",
      { data: { upstream401: { wwwAuthenticate: 123 } } },
    ],
    [
      "invalid resource_metadata URL",
      {
        data: {
          upstream401: {
            wwwAuthenticate: 'Bearer resource_metadata="not a URL"',
          },
        },
      },
    ],
  ])("ignores proxy upstream401 snapshot with %s", (_description, error) => {
    expect(extractResourceMetadataUrlFromAuthError(error)).toBeUndefined();
  });

  it("persists and clears resource metadata URL by server", () => {
    const serverUrl = "https://example.com/tenant-a/mcp";
    const resourceMetadataUrl = new URL(
      "https://example.com/tenant-a/.well-known/oauth-protected-resource/mcp",
    );

    saveResourceMetadataUrlToSessionStorage(serverUrl, resourceMetadataUrl);

    expect(getResourceMetadataUrlFromSessionStorage(serverUrl)).toEqual(
      resourceMetadataUrl,
    );
    expect(
      getResourceMetadataUrlFromSessionStorage(
        "https://example.com/tenant-b/mcp",
      ),
    ).toBeUndefined();

    clearResourceMetadataUrlFromSessionStorage(serverUrl);

    expect(getResourceMetadataUrlFromSessionStorage(serverUrl)).toBeUndefined();
  });

  it("ignores invalid stored URLs", () => {
    sessionStorage.setItem(
      "[https://example.com/mcp] mcp_resource_metadata_url",
      "not a URL",
    );

    expect(
      getResourceMetadataUrlFromSessionStorage("https://example.com/mcp"),
    ).toBeUndefined();
  });

  it("discovers resource metadata URL from a 401 challenge", async () => {
    const resourceMetadataUrl = new URL(
      "https://example.com/.well-known/oauth-protected-resource/mcp",
    );
    const fetchFn = jest.fn().mockResolvedValue(
      new Response("{}", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl.href}"`,
        },
      }),
    ) as jest.MockedFunction<typeof fetch>;

    await expect(
      discoverResourceMetadataUrlFromServer("https://example.com/mcp", fetchFn),
    ).resolves.toEqual(resourceMetadataUrl);
    expect(fetchFn).toHaveBeenCalledWith("https://example.com/mcp", {
      headers: { Accept: "application/json, text/event-stream" },
    });
  });

  it("discovers resource metadata URL from a 403 challenge", async () => {
    const resourceMetadataUrl = new URL(
      "https://example.com/.well-known/oauth-protected-resource/mcp",
    );
    const fetchFn = jest.fn().mockResolvedValue(
      new Response("{}", {
        status: 403,
        headers: {
          "WWW-Authenticate": `Bearer error="insufficient_scope", resource_metadata="${resourceMetadataUrl.href}"`,
        },
      }),
    ) as jest.MockedFunction<typeof fetch>;

    await expect(
      discoverResourceMetadataUrlFromServer("https://example.com/mcp", fetchFn),
    ).resolves.toEqual(resourceMetadataUrl);
  });

  it("ignores resource metadata URL on non-401/403 responses", async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "WWW-Authenticate":
            'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp"',
        },
      }),
    ) as jest.MockedFunction<typeof fetch>;

    await expect(
      discoverResourceMetadataUrlFromServer("https://example.com/mcp", fetchFn),
    ).resolves.toBeUndefined();
  });

  it("ignores network failures during resource metadata discovery", async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValue(new Error("network failed")) as jest.MockedFunction<
      typeof fetch
    >;

    await expect(
      discoverResourceMetadataUrlFromServer("https://example.com/mcp", fetchFn),
    ).resolves.toBeUndefined();
  });

  it("keeps discovered resource metadata URL when response body cancellation fails", async () => {
    const resourceMetadataUrl = new URL(
      "https://example.com/.well-known/oauth-protected-resource/mcp",
    );
    const fetchFn = jest.fn().mockResolvedValue({
      status: 401,
      headers: new Headers({
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl.href}"`,
      }),
      body: {
        cancel: jest.fn().mockRejectedValue(new Error("cancel failed")),
      },
    } as unknown as Response);

    await expect(
      discoverResourceMetadataUrlFromServer("https://example.com/mcp", fetchFn),
    ).resolves.toEqual(resourceMetadataUrl);
  });
});
