import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import { BaseOAuthClientProvider } from "@inspector/core/auth/providers.js";
import { ensureCimdClientRegistration } from "@inspector/core/auth/cimd.js";

const SERVER_URL = "http://127.0.0.1:9999/mcp";
const METADATA_URL = "http://127.0.0.1:8888/client-metadata.json";

function createProvider(storage: OAuthStorage): BaseOAuthClientProvider {
  return new BaseOAuthClientProvider(SERVER_URL, {
    storage,
    redirectUrlProvider: {
      getRedirectUrl: () => "http://127.0.0.1:3000/oauth/callback",
    },
    navigation: { navigateToAuthorization: vi.fn() },
    clientMetadataUrl: METADATA_URL,
  });
}

/** Discovery that advertises CIMD support for the default AS location. */
function cimdDiscoveryFetch(): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/.well-known/oauth-protected-resource")) {
      return new Response(JSON.stringify({ resource: SERVER_URL }));
    }
    if (url.includes("/.well-known/oauth-authorization-server")) {
      return new Response(
        JSON.stringify({
          issuer: "http://127.0.0.1:9999",
          authorization_endpoint: "http://127.0.0.1:9999/oauth/authorize",
          token_endpoint: "http://127.0.0.1:9999/oauth/token",
          response_types_supported: ["code"],
          client_id_metadata_document_supported: true,
        }),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

describe("ensureCimdClientRegistration", () => {
  let storage: OAuthStorage;

  beforeEach(() => {
    storage = {
      getClientInformation: vi.fn(async () => undefined),
      saveClientInformation: vi.fn(async () => {}),
      getDiscoveryState: vi.fn(async () => undefined),
      getCimdClientMetadataUrl: vi.fn(async () => undefined),
      saveCimdClientMetadataUrl: vi.fn(async () => {}),
      getScope: vi.fn().mockResolvedValue(undefined),
      getTokens: vi.fn(async () => undefined),
      saveTokens: vi.fn(async () => {}),
      clear: vi.fn(),
    } as unknown as OAuthStorage;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pre-registers URL-based client id when AS supports CIMD", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/oauth-protected-resource")) {
        return new Response(JSON.stringify({ resource: SERVER_URL }));
      }
      if (url.includes("/.well-known/oauth-authorization-server")) {
        return new Response(
          JSON.stringify({
            issuer: "http://127.0.0.1:9999",
            authorization_endpoint: "http://127.0.0.1:9999/oauth/authorize",
            token_endpoint: "http://127.0.0.1:9999/oauth/token",
            response_types_supported: ["code"],
            client_id_metadata_document_supported: true,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const provider = createProvider(storage);
    await ensureCimdClientRegistration({
      serverUrl: SERVER_URL,
      provider,
      fetchFn,
    });

    // #2242: the record is bound to the issuer just discovered, so a second AS
    // behind the same resource gets its own CIMD determination rather than
    // inheriting this one.
    expect(storage.saveClientInformation).toHaveBeenCalledWith(
      SERVER_URL,
      {
        client_id: METADATA_URL,
      },
      { registrationKind: "cimd", issuer: "http://127.0.0.1:9999" },
    );
    // The provenance marker for this AS, which outlives the credential.
    expect(storage.saveCimdClientMetadataUrl).toHaveBeenCalledWith(
      SERVER_URL,
      "http://127.0.0.1:9999",
      METADATA_URL,
    );
  });

  it("does not register when the AS metadata omits CIMD support", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/oauth-protected-resource")) {
        return new Response(JSON.stringify({ resource: SERVER_URL }));
      }
      if (url.includes("/.well-known/oauth-authorization-server")) {
        return new Response(
          JSON.stringify({
            issuer: "http://127.0.0.1:9999",
            authorization_endpoint: "http://127.0.0.1:9999/oauth/authorize",
            token_endpoint: "http://127.0.0.1:9999/oauth/token",
            response_types_supported: ["code"],
            // client_id_metadata_document_supported intentionally absent.
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const provider = createProvider(storage);
    await ensureCimdClientRegistration({
      serverUrl: SERVER_URL,
      provider,
      fetchFn,
    });

    expect(storage.saveClientInformation).not.toHaveBeenCalled();
    // The marker is actively withdrawn, not merely left unwritten, so an AS that
    // stops advertising CIMD stops being treated as one.
    expect(storage.saveCimdClientMetadataUrl).toHaveBeenCalledWith(
      SERVER_URL,
      "http://127.0.0.1:9999",
      undefined,
    );
  });

  it("discovers protected-resource metadata at the challenge-advertised URL (#2071)", async () => {
    const metadataUrl = new URL(
      "http://127.0.0.1:9999/custom/protected-resource",
    );
    // Both discovery legs must run through the configured fetch — on web that
    // is the backend proxy, so a leg that fell back to the global would fail
    // on CORS and be swallowed.
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === metadataUrl.href) {
        return new Response(
          JSON.stringify({
            resource: SERVER_URL,
            authorization_servers: ["http://127.0.0.1:9999"],
          }),
        );
      }
      if (url.includes("/.well-known/oauth-authorization-server")) {
        return new Response(
          JSON.stringify({
            issuer: "http://127.0.0.1:9999",
            authorization_endpoint: "http://127.0.0.1:9999/oauth/authorize",
            token_endpoint: "http://127.0.0.1:9999/oauth/token",
            response_types_supported: ["code"],
            client_id_metadata_document_supported: true,
          }),
        );
      }
      return new Response(null, { status: 404 });
    });
    // Nothing may reach the network directly; a call here means a leg fell
    // back to the global fetch.
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);

    await ensureCimdClientRegistration({
      serverUrl: SERVER_URL,
      provider: createProvider(storage),
      fetchFn,
      resourceMetadataUrl: metadataUrl,
    });

    expect(globalFetch).not.toHaveBeenCalled();
    const requested = fetchFn.mock.calls.map(([input]) => String(input));
    expect(requested).toContain(metadataUrl.href);
    expect(
      requested.filter((url) =>
        url.includes("/.well-known/oauth-protected-resource"),
      ),
    ).toEqual([]);
    expect(storage.saveClientInformation).toHaveBeenCalledWith(
      SERVER_URL,
      { client_id: METADATA_URL },
      { registrationKind: "cimd", issuer: "http://127.0.0.1:9999" },
    );
  });

  // #2242 (Copilot): the existing-client check moved after discovery, so this
  // helper must not turn a well-known outage into a failed reconnect. It reuses
  // the discovery state SDK `auth()` persists, and treats a discovery failure as
  // "skip pre-registration" rather than an error.
  it("reuses persisted discovery state instead of re-fetching", async () => {
    storage.getDiscoveryState = vi.fn(async () => ({
      authorizationServerUrl: "http://127.0.0.1:9999",
      authorizationServerMetadata: {
        issuer: "http://127.0.0.1:9999",
        authorization_endpoint: "http://127.0.0.1:9999/oauth/authorize",
        token_endpoint: "http://127.0.0.1:9999/oauth/token",
        response_types_supported: ["code"],
        client_id_metadata_document_supported: true,
      },
    }));
    const fetchFn = vi.fn(async () => {
      throw new Error("discovery must not run when state is cached");
    });

    await ensureCimdClientRegistration({
      serverUrl: SERVER_URL,
      provider: createProvider(storage),
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(storage.saveClientInformation).toHaveBeenCalledWith(
      SERVER_URL,
      { client_id: METADATA_URL },
      { registrationKind: "cimd", issuer: "http://127.0.0.1:9999" },
    );
  });

  it("skips pre-registration when discovery fails, rather than throwing", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("well-known endpoint is down");
    });

    await expect(
      ensureCimdClientRegistration({
        serverUrl: SERVER_URL,
        provider: createProvider(storage),
        fetchFn,
      }),
    ).resolves.toBeUndefined();

    expect(storage.saveClientInformation).not.toHaveBeenCalled();
    // No marker is invented either — nothing was learned about the AS.
    expect(storage.saveCimdClientMetadataUrl).not.toHaveBeenCalled();
  });

  // #2242 (Copilot): an AS advertising CIMD is not on its own evidence that the
  // registration standing for it is a CIMD one. RFC 7591 §3.2 leaves a
  // dynamically issued `client_id` opaque, so a real DCR may carry this very
  // URL — marking it would relabel it.
  it("withdraws the marker when an existing DCR happens to use the metadata URL as its client_id", async () => {
    storage.getClientInformation = vi.fn(
      async (_url: string, preregistered?: boolean) =>
        preregistered ? undefined : { client_id: METADATA_URL },
    );
    storage.getClientRegistrationKind = vi.fn(
      async (): Promise<"dcr"> => "dcr",
    );
    const fetchFn = cimdDiscoveryFetch();

    await ensureCimdClientRegistration({
      serverUrl: SERVER_URL,
      provider: createProvider(storage),
      fetchFn,
    });

    expect(storage.saveClientInformation).not.toHaveBeenCalled();
    expect(storage.saveCimdClientMetadataUrl).toHaveBeenCalledWith(
      SERVER_URL,
      "http://127.0.0.1:9999",
      undefined,
    );
  });

  it("reaffirms the marker for an existing registration already recorded as cimd", async () => {
    storage.getClientInformation = vi.fn(
      async (_url: string, preregistered?: boolean) =>
        preregistered ? undefined : { client_id: METADATA_URL },
    );
    storage.getClientRegistrationKind = vi.fn(
      async (): Promise<"cimd"> => "cimd",
    );
    const fetchFn = cimdDiscoveryFetch();

    await ensureCimdClientRegistration({
      serverUrl: SERVER_URL,
      provider: createProvider(storage),
      fetchFn,
    });

    expect(storage.saveClientInformation).not.toHaveBeenCalled();
    expect(storage.saveCimdClientMetadataUrl).toHaveBeenCalledWith(
      SERVER_URL,
      "http://127.0.0.1:9999",
      METADATA_URL,
    );
  });

  it("no-ops when client information is already stored for the discovered issuer", async () => {
    // Dynamic slot only — a preregistered hit would short-circuit
    // `clientInformation()` before it ever reaches the issuer-keyed read.
    storage.getClientInformation = vi.fn(
      async (_url: string, preregistered?: boolean) =>
        preregistered ? undefined : { client_id: "existing-client" },
    );
    storage.getClientRegistrationKind = vi.fn(
      async (): Promise<"dcr"> => "dcr",
    );

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/oauth-protected-resource")) {
        return new Response(JSON.stringify({ resource: SERVER_URL }));
      }
      if (url.includes("/.well-known/oauth-authorization-server")) {
        return new Response(
          JSON.stringify({
            issuer: "http://127.0.0.1:9999",
            authorization_endpoint: "http://127.0.0.1:9999/oauth/authorize",
            token_endpoint: "http://127.0.0.1:9999/oauth/token",
            response_types_supported: ["code"],
            client_id_metadata_document_supported: true,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const provider = createProvider(storage);
    await ensureCimdClientRegistration({
      serverUrl: SERVER_URL,
      provider,
      fetchFn,
    });

    expect(storage.saveClientInformation).not.toHaveBeenCalled();
    // #2242: the existing-client check is keyed by the issuer discovery just
    // resolved, not read ctx-less — a ctx-less read resolves through the
    // *active* issuer and would early-return for every later issuer.
    expect(storage.getClientInformation).toHaveBeenCalledWith(
      SERVER_URL,
      false,
      "http://127.0.0.1:9999",
    );
  });
});
