import { describe, it, expect, vi } from "vitest";
import { createAuthChallengeInterceptFetch } from "@inspector/core/mcp/node/authChallengeFetch.js";
import { AuthChallengeError } from "@inspector/core/auth/challenge.js";

describe("createAuthChallengeInterceptFetch", () => {
  it("passes through successful responses", async () => {
    const baseFetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const fetchFn = createAuthChallengeInterceptFetch(baseFetch);
    const res = await fetchFn("https://example.com/mcp");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("throws AuthChallengeError on 401", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Bearer error="invalid_token"',
          },
        }),
    );
    const fetchFn = createAuthChallengeInterceptFetch(baseFetch);
    await expect(fetchFn("https://example.com/mcp")).rejects.toBeInstanceOf(
      AuthChallengeError,
    );
  });

  it("throws AuthChallengeError on 403 insufficient_scope", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 403,
          headers: {
            "WWW-Authenticate":
              'Bearer error="insufficient_scope", scope="weather:read"',
          },
        }),
    );
    const fetchFn = createAuthChallengeInterceptFetch(baseFetch);
    try {
      await fetchFn("https://example.com/mcp");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthChallengeError);
      expect((err as AuthChallengeError).authChallenge.reason).toBe(
        "insufficient_scope",
      );
    }
  });
});
