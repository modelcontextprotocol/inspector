import { describe, it, expect, vi } from "vitest";
import {
  createAuthChallengeInterceptFetch,
  createAuthChallengeObserverFetch,
} from "@inspector/core/mcp/node/authChallengeFetch.js";
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

  it("cancels a present response body before throwing", async () => {
    const response = new Response("challenge body", {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' },
    });
    const cancelSpy = vi.spyOn(response.body!, "cancel");
    const baseFetch = vi.fn(async () => response);
    const fetchFn = createAuthChallengeInterceptFetch(baseFetch);

    await expect(fetchFn("https://example.com/mcp")).rejects.toBeInstanceOf(
      AuthChallengeError,
    );
    expect(cancelSpy).toHaveBeenCalled();
  });

  it("swallows a body.cancel() rejection and still throws the challenge", async () => {
    const response = new Response("challenge body", {
      status: 403,
      headers: {
        "WWW-Authenticate":
          'Bearer error="insufficient_scope", scope="weather:read"',
      },
    });
    vi.spyOn(response.body!, "cancel").mockRejectedValue(
      new Error("cancel failed"),
    );
    const baseFetch = vi.fn(async () => response);
    const fetchFn = createAuthChallengeInterceptFetch(baseFetch);

    await expect(fetchFn("https://example.com/mcp")).rejects.toBeInstanceOf(
      AuthChallengeError,
    );
  });
});

describe("createAuthChallengeObserverFetch", () => {
  const METADATA_URL = "http://127.0.0.1:3001/custom/protected-resource";

  it("reports a challenge without altering the response or its body", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response("payload", {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="${METADATA_URL}"`,
          },
        }),
    );
    const onChallenge = vi.fn();
    const fetchFn = createAuthChallengeObserverFetch(baseFetch, onChallenge);

    const res = await fetchFn("https://example.com/mcp");

    expect(res.status).toBe(401);
    // The body must survive for the transport (or the interceptor above).
    expect(await res.text()).toBe("payload");
    expect(onChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ resourceMetadataUrl: METADATA_URL }),
    );
  });

  it("reports a 403 challenge too", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 403,
          headers: { "WWW-Authenticate": 'Bearer error="insufficient_scope"' },
        }),
    );
    const onChallenge = vi.fn();

    await createAuthChallengeObserverFetch(
      baseFetch,
      onChallenge,
    )("https://example.com/mcp");

    expect(onChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "insufficient_scope" }),
    );
  });

  it("stays silent on a non-challenge response", async () => {
    const baseFetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const onChallenge = vi.fn();

    const res = await createAuthChallengeObserverFetch(
      baseFetch,
      onChallenge,
    )("https://example.com/mcp");

    expect(res.status).toBe(200);
    expect(onChallenge).not.toHaveBeenCalled();
  });
});
