import { describe, it, expect } from "vitest";
import { createTokenAuthProvider } from "@inspector/core/mcp/remote/node/tokenAuthProvider.js";

describe("createTokenAuthProvider", () => {
  it("returns undefined when tokens are not provided", () => {
    expect(createTokenAuthProvider(undefined)).toBeUndefined();
  });

  it("returns a provider whose tokens() resolves with the supplied tokens", async () => {
    const tokens = { access_token: "abc", token_type: "Bearer" };
    const provider = createTokenAuthProvider(tokens);
    expect(provider).toBeDefined();
    await expect(provider!.tokens()).resolves.toEqual(tokens);
  });

  it("exposes no-op stubs for the auxiliary OAuthClientProvider methods", async () => {
    const provider = createTokenAuthProvider({
      access_token: "abc",
      token_type: "Bearer",
    });
    expect(provider).toBeDefined();
    // The aux methods are no-op stubs that satisfy the OAuthClientProvider
    // surface; the underlying object type widens via the `as unknown as`
    // cast in the source, so we narrow here for the test assertions.
    const p = provider! as unknown as {
      clientInformation: () => Promise<undefined>;
      saveTokens: (t: {
        access_token: string;
        token_type: string;
      }) => Promise<void>;
      codeVerifier: () => string | undefined;
      saveCodeVerifier: (v: string) => Promise<void>;
      clear: () => void;
      redirectToAuthorization: (url: URL) => void;
      state: () => string;
    };

    await expect(p.clientInformation()).resolves.toBeUndefined();
    await expect(
      p.saveTokens({ access_token: "noop", token_type: "Bearer" }),
    ).resolves.toBeUndefined();
    expect(p.codeVerifier()).toBeUndefined();
    await expect(p.saveCodeVerifier("v")).resolves.toBeUndefined();
    expect(() => p.clear()).not.toThrow();
    expect(() =>
      p.redirectToAuthorization(new URL("https://example.com/")),
    ).not.toThrow();
    expect(p.state()).toBe("");
  });
});
