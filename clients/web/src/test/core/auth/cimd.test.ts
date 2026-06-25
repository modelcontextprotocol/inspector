import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import { BaseOAuthClientProvider } from "@inspector/core/auth/providers.js";
import { ensureCimdClientRegistration } from "@inspector/core/auth/cimd.js";

const SERVER_URL = "http://127.0.0.1:9999/mcp";
const METADATA_URL = "http://127.0.0.1:8888/client-metadata.json";

function createProvider(storage: OAuthStorage): BaseOAuthClientProvider {
  return new BaseOAuthClientProvider(
    SERVER_URL,
    {
      storage,
      redirectUrlProvider: {
        getRedirectUrl: () => "http://127.0.0.1:3000/oauth/callback",
      },
      navigation: { navigateToAuthorization: vi.fn() },
      clientMetadataUrl: METADATA_URL,
    },
    "quick",
  );
}

describe("ensureCimdClientRegistration", () => {
  let storage: OAuthStorage;

  beforeEach(() => {
    storage = {
      getClientInformation: vi.fn(async () => undefined),
      saveClientInformation: vi.fn(async () => {}),
      getScope: vi.fn(() => undefined),
      getTokens: vi.fn(async () => undefined),
      saveTokens: vi.fn(async () => {}),
      clear: vi.fn(),
    } as unknown as OAuthStorage;
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

    expect(storage.saveClientInformation).toHaveBeenCalledWith(SERVER_URL, {
      client_id: METADATA_URL,
    });
  });

  it("no-ops when client information is already stored", async () => {
    storage.getClientInformation = vi.fn(async () => ({
      client_id: "existing-client",
    }));

    const provider = createProvider(storage);
    await ensureCimdClientRegistration({
      serverUrl: SERVER_URL,
      provider,
      fetchFn: vi.fn(),
    });

    expect(storage.saveClientInformation).not.toHaveBeenCalled();
  });
});
