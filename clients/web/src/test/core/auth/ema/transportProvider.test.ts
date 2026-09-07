import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthTokens } from "@modelcontextprotocol/client";
import {
  BaseOAuthClientProvider,
  CallbackNavigation,
  MutableRedirectUrlProvider,
} from "@inspector/core/auth/providers.js";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import { OAuthStorageBase } from "@inspector/core/auth/oauth-storage.js";
import { OAuthMemoryStore } from "@inspector/core/auth/store.js";
import type { OAuthPersistBackend } from "@inspector/core/auth/oauth-persist.js";
import type { EmaFlowConfig } from "@inspector/core/auth/ema/emaFlow.js";
import { EmaTransportOAuthProvider } from "@inspector/core/auth/ema/transportProvider.js";
import {
  refreshEmaResourceTokens,
  startEmaIdpAuthorization,
} from "@inspector/core/auth/ema/emaFlow.js";

vi.mock("@inspector/core/auth/ema/emaFlow.js", () => ({
  refreshEmaResourceTokens: vi.fn(),
  startEmaIdpAuthorization: vi.fn(),
}));

const refreshMock = vi.mocked(refreshEmaResourceTokens);
const startIdpMock = vi.mocked(startEmaIdpAuthorization);

const SERVER_URL = "http://127.0.0.1:9999/mcp";

/**
 * A real `OAuthStorage` — in-memory state over a no-op persist backend — for the
 * one test below that drives an actual `BaseOAuthClientProvider`. Building the
 * genuine article costs two lines and avoids an `as unknown as` stub that would
 * stop type-checking against the interface the provider is handed.
 */
function makeRealStorage(): OAuthStorage {
  const backend: OAuthPersistBackend = {
    read: async () => null,
    write: async () => {},
  };
  return new OAuthStorageBase(new OAuthMemoryStore(), backend);
}

function jwtWithExp(expSec: number): string {
  const payload = btoa(JSON.stringify({ exp: expSec }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.sig`;
}

const VALID_ACCESS_TOKEN = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
const EXPIRED_ACCESS_TOKEN = jwtWithExp(Math.floor(Date.now() / 1000) - 60);

interface FakeInner {
  redirectUrl: string;
  clientMetadataUrl: string | undefined;
  clientMetadata: { redirect_uris: string[] };
  state: ReturnType<typeof vi.fn>;
  clientInformation: ReturnType<typeof vi.fn>;
  saveClientInformation: ReturnType<typeof vi.fn>;
  tokens: ReturnType<typeof vi.fn>;
  saveTokens: ReturnType<typeof vi.fn>;
  redirectToAuthorization: ReturnType<typeof vi.fn>;
  redirectToExternalAuthorization: ReturnType<typeof vi.fn>;
  clearCapturedAuthUrl: ReturnType<typeof vi.fn>;
  saveCodeVerifier: ReturnType<typeof vi.fn>;
  codeVerifier: ReturnType<typeof vi.fn>;
  saveDiscoveryState: ReturnType<typeof vi.fn>;
  discoveryState: ReturnType<typeof vi.fn>;
}

function createInner(): FakeInner {
  return {
    redirectUrl: "http://127.0.0.1:3000/oauth/callback",
    clientMetadataUrl: "http://127.0.0.1:3000/client.json",
    clientMetadata: { redirect_uris: ["http://127.0.0.1:3000/oauth/callback"] },
    state: vi.fn(() => "state-123"),
    clientInformation: vi.fn(() => ({ client_id: "abc" })),
    saveClientInformation: vi.fn(),
    tokens: vi.fn(),
    saveTokens: vi.fn(),
    redirectToAuthorization: vi.fn(),
    redirectToExternalAuthorization: vi.fn(),
    clearCapturedAuthUrl: vi.fn(),
    saveCodeVerifier: vi.fn(),
    codeVerifier: vi.fn(() => "verifier-xyz"),
    saveDiscoveryState: vi.fn(),
    discoveryState: vi.fn(),
  };
}

describe("EmaTransportOAuthProvider", () => {
  let inner: FakeInner;
  let emaConfig: EmaFlowConfig;
  let saveTokensSpy: ReturnType<typeof vi.fn>;
  let provider: EmaTransportOAuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    inner = createInner();
    saveTokensSpy = vi.fn();
    emaConfig = {
      serverUrl: SERVER_URL,
      idp: { issuer: "https://idp.test", clientId: "idp", clientSecret: "s" },
      redirectUrl: "http://127.0.0.1:3000/oauth/callback",
      storage: {
        saveTokens: saveTokensSpy,
      } as unknown as EmaFlowConfig["storage"],
    } as EmaFlowConfig;
    provider = new EmaTransportOAuthProvider(
      inner as unknown as BaseOAuthClientProvider,
      emaConfig,
    );
  });

  it("delegates pass-through getters and methods to the inner provider", async () => {
    expect(provider.redirectUrl).toBe(inner.redirectUrl);
    expect(provider.clientMetadataUrl).toBe(inner.clientMetadataUrl);
    expect(provider.clientMetadata).toBe(inner.clientMetadata);
    expect(await provider.state()).toBe("state-123");
    expect(await provider.clientInformation()).toEqual({ client_id: "abc" });
    expect(await provider.codeVerifier()).toBe("verifier-xyz");

    await provider.saveClientInformation({ client_id: "new" } as never);
    expect(inner.saveClientInformation).toHaveBeenCalledWith(
      { client_id: "new" },
      undefined,
    );

    await provider.saveCodeVerifier("cv");
    expect(inner.saveCodeVerifier).toHaveBeenCalledWith("cv");
  });

  // SEP-2352: the wrapper used to drop the SDK's `ctx`, so every EMA read and
  // write landed on the unkeyed slot — and, since #2242, the registration-kind
  // resolver had no issuer to check and recorded a CIMD registration made over
  // an EMA connection as DCR (Copilot).
  it("forwards the SDK issuer context on client-information reads and writes", async () => {
    const ctx = { issuer: "https://as.example.com" };

    await provider.clientInformation(ctx);
    expect(inner.clientInformation).toHaveBeenCalledWith(ctx);

    await provider.saveClientInformation({ client_id: "new" } as never, ctx);
    expect(inner.saveClientInformation).toHaveBeenCalledWith(
      { client_id: "new" },
      ctx,
    );
  });

  // Without these the SDK persists no discovery state for an EMA connection, so
  // it re-discovers every call, cannot run its callback-leg AS binding check,
  // and leaves the registration-kind resolver nothing to read back.
  it("delegates discovery state to the inner provider", async () => {
    const state = {
      authorizationServerUrl: "https://as.example.com",
      authorizationServerMetadata: {
        issuer: "https://as.example.com",
        authorization_endpoint: "https://as.example.com/authorize",
        token_endpoint: "https://as.example.com/token",
        response_types_supported: ["code"],
      },
    };

    await provider.saveDiscoveryState(state);
    expect(inner.saveDiscoveryState).toHaveBeenCalledWith(state);

    inner.discoveryState.mockReturnValue(state);
    expect(await provider.discoveryState()).toEqual(state);
    expect(inner.discoveryState).toHaveBeenCalled();
  });

  it("tokens() returns stored tokens when the access token is still usable", async () => {
    const stored: OAuthTokens = {
      access_token: VALID_ACCESS_TOKEN,
      token_type: "Bearer",
    };
    inner.tokens.mockResolvedValue(stored);

    const result = await provider.tokens();
    expect(result).toBe(stored);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("tokens() refreshes EMA resource tokens when stored tokens are expired", async () => {
    inner.tokens.mockResolvedValue({
      access_token: EXPIRED_ACCESS_TOKEN,
      token_type: "Bearer",
    });
    const refreshed: OAuthTokens = {
      access_token: VALID_ACCESS_TOKEN,
      token_type: "Bearer",
    };
    refreshMock.mockResolvedValue(refreshed);

    const result = await provider.tokens();
    expect(result).toBe(refreshed);
    expect(refreshMock).toHaveBeenCalledWith(emaConfig);
  });

  it("tokens() refreshes when there are no stored tokens", async () => {
    inner.tokens.mockResolvedValue(undefined);
    const refreshed: OAuthTokens = {
      access_token: VALID_ACCESS_TOKEN,
      token_type: "Bearer",
    };
    refreshMock.mockResolvedValue(refreshed);

    expect(await provider.tokens()).toBe(refreshed);
    expect(refreshMock).toHaveBeenCalledWith(emaConfig);
  });

  it("tokens() refreshes when stored tokens lack an access_token", async () => {
    inner.tokens.mockResolvedValue({ token_type: "Bearer" } as OAuthTokens);
    refreshMock.mockResolvedValue(undefined);

    expect(await provider.tokens()).toBeUndefined();
    expect(refreshMock).toHaveBeenCalledWith(emaConfig);
  });

  it("tokens() returns undefined when refresh yields nothing", async () => {
    inner.tokens.mockResolvedValue(undefined);
    refreshMock.mockResolvedValue(undefined);

    expect(await provider.tokens()).toBeUndefined();
  });

  it("saveTokens() persists via storage tagged as enterprise-managed", async () => {
    const tokens: OAuthTokens = {
      access_token: VALID_ACCESS_TOKEN,
      token_type: "Bearer",
    };
    await provider.saveTokens(tokens);
    expect(saveTokensSpy).toHaveBeenCalledWith(SERVER_URL, tokens, {
      enterpriseManaged: true,
    });
  });

  it("redirectToAuthorization() redirects to the IdP, ignoring the resource AS URL", async () => {
    const idpUrl = new URL("https://idp.test/authorize?state=abc");
    startIdpMock.mockResolvedValue(idpUrl);

    await provider.redirectToAuthorization(
      new URL("https://resource-as.test/authorize"),
    );

    expect(startIdpMock).toHaveBeenCalledWith(emaConfig);
    expect(inner.clearCapturedAuthUrl).toHaveBeenCalledTimes(1);
    expect(inner.redirectToExternalAuthorization).toHaveBeenCalledWith(idpUrl);
    // The custom-parameter merge lives on `redirectToAuthorization`, so the EMA
    // leg must never take that path.
    expect(inner.redirectToAuthorization).not.toHaveBeenCalled();
  });

  // #2018 — the inner provider carries the per-server custom authorization
  // parameters, which belong to the MCP server's authorization server. The EMA
  // leg sends the user to a *different* authorization server (the enterprise
  // IdP), so those parameters must not reach it. Driven against a real
  // BaseOAuthClientProvider rather than the fake inner above, since the defect
  // is precisely in what the real provider does with the URL it is handed.
  it("does not leak custom authorization params onto the IdP authorize URL", async () => {
    const navCallback = vi.fn();
    const realInner = new BaseOAuthClientProvider(SERVER_URL, {
      // A real OAuthStorage rather than a cast stub: the redirect path never
      // reads it, and a genuine implementation keeps this test honest if the
      // storage contract changes.
      storage: makeRealStorage(),
      redirectUrlProvider: new MutableRedirectUrlProvider(),
      navigation: new CallbackNavigation(navCallback),
      authorizationParams: { kc_idp_hint: "corp-idp", audience: "api://mcp" },
    });
    const emaProvider = new EmaTransportOAuthProvider(realInner, emaConfig);

    const idpUrl = new URL("https://idp.test/authorize?state=abc");
    startIdpMock.mockResolvedValue(idpUrl);

    await emaProvider.redirectToAuthorization(
      new URL("https://resource-as.test/authorize"),
    );

    const navigated = navCallback.mock.calls[0]?.[0] as URL;
    expect(navigated.searchParams.get("kc_idp_hint")).toBeNull();
    expect(navigated.searchParams.get("audience")).toBeNull();
    expect(navigated.href).toBe(idpUrl.href);
    // The captured URL (what the step-up UI shows) must agree.
    expect(realInner.getCapturedAuthUrl()?.href).toBe(idpUrl.href);
  });
});
