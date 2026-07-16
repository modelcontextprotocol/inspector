import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthTokens } from "@modelcontextprotocol/client";
import type { BaseOAuthClientProvider } from "@inspector/core/auth/providers.js";
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
  clearCapturedAuthUrl: ReturnType<typeof vi.fn>;
  saveCodeVerifier: ReturnType<typeof vi.fn>;
  codeVerifier: ReturnType<typeof vi.fn>;
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
    clearCapturedAuthUrl: vi.fn(),
    saveCodeVerifier: vi.fn(),
    codeVerifier: vi.fn(() => "verifier-xyz"),
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

    provider.saveClientInformation({ client_id: "new" } as never);
    expect(inner.saveClientInformation).toHaveBeenCalledWith({
      client_id: "new",
    });

    provider.saveCodeVerifier("cv");
    expect(inner.saveCodeVerifier).toHaveBeenCalledWith("cv");
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
    expect(inner.redirectToAuthorization).toHaveBeenCalledWith(idpUrl);
  });
});
