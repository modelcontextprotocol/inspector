import { describe, it, expect } from "vitest";
import { createRemoteAuthProvider } from "@inspector/core/mcp/remote/node/tokenAuthProvider.js";

describe("createRemoteAuthProvider", () => {
  it("returns undefined when no auth state is provided", () => {
    expect(createRemoteAuthProvider(undefined)).toBeUndefined();
    expect(createRemoteAuthProvider({})).toBeUndefined();
  });

  it("returns a provider whose tokens() resolves with the supplied tokens", async () => {
    const tokens = { access_token: "abc", token_type: "Bearer" };
    const handle = createRemoteAuthProvider({ oauthTokens: tokens });
    expect(handle).toBeDefined();
    await expect(handle!.provider.tokens()).resolves.toEqual(tokens);
  });

  it("updates tokens via setAuthState without replacing the provider", async () => {
    const handle = createRemoteAuthProvider({
      oauthTokens: { access_token: "old", token_type: "Bearer" },
    });
    handle!.setAuthState({
      oauthTokens: {
        access_token: "new",
        token_type: "Bearer",
        refresh_token: "rt",
      },
    });
    await expect(handle!.provider.tokens()).resolves.toEqual({
      access_token: "new",
      token_type: "Bearer",
      refresh_token: "rt",
    });
    expect(handle!.getAuthState().oauthTokens?.access_token).toBe("new");
  });

  it("exposes clientInformation when oauthClient is set", async () => {
    const handle = createRemoteAuthProvider({
      oauthClient: { client_id: "cid", client_secret: "sec" },
    });
    await expect(handle!.provider.clientInformation()).resolves.toEqual({
      client_id: "cid",
      client_secret: "sec",
    });
  });

  it("exposes no-op stubs for auxiliary OAuthClientProvider methods", async () => {
    const handle = createRemoteAuthProvider({
      oauthTokens: { access_token: "abc", token_type: "Bearer" },
    });
    const p = handle!.provider as unknown as {
      clientInformation: () => Promise<undefined>;
      saveTokens: (t: {
        access_token: string;
        token_type: string;
      }) => Promise<void>;
      codeVerifier: () => string | undefined;
      saveCodeVerifier: (v: string) => Promise<void>;
      clear: () => void;
      redirectToAuthorization: (url: URL) => Promise<void>;
      state: () => string;
    };

    await expect(p.clientInformation()).resolves.toBeUndefined();
    await expect(
      p.saveTokens({ access_token: "saved", token_type: "Bearer" }),
    ).resolves.toBeUndefined();
    await expect(handle!.provider.tokens()).resolves.toEqual({
      access_token: "saved",
      token_type: "Bearer",
    });
    expect(p.codeVerifier()).toBeUndefined();
    await expect(p.saveCodeVerifier("v")).resolves.toBeUndefined();
    expect(() => p.clear()).not.toThrow();
    await expect(
      p.redirectToAuthorization(new URL("https://example.com/")),
    ).rejects.toThrow(/remote server cannot complete OAuth flows/);
    expect(p.state()).toBe("");
  });

  it("exposes clientMetadata so SDK auth() does not throw on 401 retry", () => {
    const handle = createRemoteAuthProvider({
      oauthTokens: { access_token: "abc", token_type: "Bearer" },
    });
    expect(handle!.provider.clientMetadata.scope).toBe("");
  });
});
