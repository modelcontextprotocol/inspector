import { describe, it, expect, vi, afterEach } from "vitest";
import {
  runRunnerInteractiveOAuth,
  type RunnerInteractiveOAuthClient,
} from "@inspector/core/auth/node/runner-interactive-oauth.js";
import {
  createOAuthCallbackServer,
  type OAuthCallbackServer,
  type OAuthCallbackServerStartOptions,
} from "@inspector/core/auth/node/oauth-callback-server.js";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";

vi.mock(
  "@inspector/core/auth/node/oauth-callback-server.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@inspector/core/auth/node/oauth-callback-server.js")
      >();
    return { ...actual, createOAuthCallbackServer: vi.fn() };
  },
);

function mockClient(
  overrides: Partial<RunnerInteractiveOAuthClient> = {},
): RunnerInteractiveOAuthClient {
  return {
    authenticate: vi.fn(async () => undefined),
    beginInteractiveAuthorization: vi.fn(async () => {}),
    completeOAuthFlow: vi.fn(async () => {}),
    checkAuthChallengeSatisfied: vi.fn(async () => true),
    ...overrides,
  };
}

interface MockCallbackHandlers {
  onCallback?: OAuthCallbackServerStartOptions["onCallback"];
  onError?: OAuthCallbackServerStartOptions["onError"];
}

function createMockCallbackServer(handlers: {
  current: MockCallbackHandlers;
}): OAuthCallbackServer {
  return {
    start: vi.fn(async (opts: OAuthCallbackServerStartOptions) => {
      handlers.current = {
        onCallback: opts.onCallback,
        onError: opts.onError,
      };
      return {
        port: 6276,
        redirectUrl: "http://127.0.0.1:6276/oauth/callback",
      };
    }),
    stop: vi.fn(async () => {}),
  } as unknown as OAuthCallbackServer;
}

/** Drive the loopback callback the way a browser redirect would. */
async function simulateCallback(
  handlers: MockCallbackHandlers,
  code = "auth-code-123",
): Promise<void> {
  if (!handlers.onCallback) {
    throw new Error("onCallback not registered");
  }
  await handlers.onCallback({ code });
}

describe("runRunnerInteractiveOAuth", () => {
  const handlers: { current: MockCallbackHandlers } = { current: {} };

  afterEach(() => {
    handlers.current = {};
    vi.restoreAllMocks();
  });

  it("returns already_authorized when authenticate yields no URL", async () => {
    const client = mockClient({
      authenticate: vi.fn(async () => undefined),
    });
    const redirectUrlProvider = { redirectUrl: "" };

    const result = await runRunnerInteractiveOAuth({
      client,
      redirectUrlProvider,
      callbackListen: {
        hostname: "127.0.0.1",
        port: 6276,
        pathname: "/oauth/callback",
      },
      createCallbackServer: () => createMockCallbackServer(handlers),
    });

    expect(result).toEqual({ kind: "already_authorized" });
    expect(client.completeOAuthFlow).not.toHaveBeenCalled();
  });

  it("clears the callback timeout on already_authorized", async () => {
    vi.useFakeTimers();
    try {
      const client = mockClient({
        authenticate: vi.fn(async () => undefined),
      });
      const redirectUrlProvider = { redirectUrl: "" };

      const result = await runRunnerInteractiveOAuth({
        client,
        redirectUrlProvider,
        callbackListen: {
          hostname: "127.0.0.1",
          port: 6276,
          pathname: "/oauth/callback",
        },
        callbackTimeoutMs: 60_000,
        createCallbackServer: () => createMockCallbackServer(handlers),
      });

      expect(result).toEqual({ kind: "already_authorized" });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes connect-time OAuth via authenticate and callback", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    const client = mockClient({
      authenticate: vi.fn(async () => {
        await simulateCallback(handlers.current);
        return new URL("https://as.example/authorize");
      }),
    });

    const result = await runRunnerInteractiveOAuth({
      client,
      redirectUrlProvider,
      callbackListen: {
        hostname: "127.0.0.1",
        port: 6276,
        pathname: "/oauth/callback",
      },
      createCallbackServer: () => createMockCallbackServer(handlers),
    });

    expect(result).toEqual({ kind: "success" });
    expect(client.completeOAuthFlow).toHaveBeenCalledWith("auth-code-123");
    expect(redirectUrlProvider.redirectUrl).toBe(
      "http://127.0.0.1:6276/oauth/callback",
    );
  });

  it("uses beginInteractiveAuthorization when authorizationUrl is provided", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    const authorizationUrl = new URL(
      "https://as.example/authorize?state=step-up",
    );
    const client = mockClient({
      beginInteractiveAuthorization: vi.fn(async () => {
        await simulateCallback(handlers.current, "step-up-code");
      }),
    });

    const result = await runRunnerInteractiveOAuth({
      client,
      redirectUrlProvider,
      callbackListen: {
        hostname: "127.0.0.1",
        port: 6276,
        pathname: "/oauth/callback",
      },
      authorizationUrl,
      createCallbackServer: () => createMockCallbackServer(handlers),
    });

    expect(result).toEqual({ kind: "success" });
    expect(client.beginInteractiveAuthorization).toHaveBeenCalledWith(
      authorizationUrl,
    );
    expect(client.authenticate).not.toHaveBeenCalled();
    expect(client.completeOAuthFlow).toHaveBeenCalledWith("step-up-code");
  });

  it("returns insufficient_scope when post-step-up check fails", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    const challenge: AuthChallenge = {
      reason: "insufficient_scope",
      requiredScopes: ["weather:read"],
    };
    const client = mockClient({
      beginInteractiveAuthorization: vi.fn(async () => {
        await simulateCallback(handlers.current);
      }),
      checkAuthChallengeSatisfied: vi.fn(async () => false),
    });

    const result = await runRunnerInteractiveOAuth({
      client,
      redirectUrlProvider,
      callbackListen: {
        hostname: "127.0.0.1",
        port: 6276,
        pathname: "/oauth/callback",
      },
      authorizationUrl: new URL("https://as.example/authorize"),
      authChallenge: challenge,
      createCallbackServer: () => createMockCallbackServer(handlers),
    });

    expect(result).toEqual({ kind: "insufficient_scope", challenge });
  });

  it("propagates completeOAuthFlow failures", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    const client = mockClient({
      authenticate: vi.fn(async () => {
        await simulateCallback(handlers.current);
        return new URL("https://as.example/authorize");
      }),
      completeOAuthFlow: vi.fn(async () => {
        throw new Error("token exchange failed");
      }),
    });

    await expect(
      runRunnerInteractiveOAuth({
        client,
        redirectUrlProvider,
        callbackListen: {
          hostname: "127.0.0.1",
          port: 6276,
          pathname: "/oauth/callback",
        },
        createCallbackServer: () => createMockCallbackServer(handlers),
      }),
    ).rejects.toThrow("token exchange failed");
  });

  it("propagates OAuth callback errors from the authorization server", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    const client = mockClient({
      authenticate: vi.fn(async () => {
        handlers.current.onError?.({
          error: "access_denied",
          error_description: "user cancelled",
        });
        return new URL("https://as.example/authorize");
      }),
    });

    await expect(
      runRunnerInteractiveOAuth({
        client,
        redirectUrlProvider,
        callbackListen: {
          hostname: "127.0.0.1",
          port: 6276,
          pathname: "/oauth/callback",
        },
        createCallbackServer: () => createMockCallbackServer(handlers),
      }),
    ).rejects.toThrow("user cancelled");
  });

  it("times out when the browser callback never arrives", async () => {
    vi.useFakeTimers();
    try {
      const redirectUrlProvider = { redirectUrl: "" };
      const client = mockClient({
        authenticate: vi.fn(
          async () => new URL("https://as.example/authorize"),
        ),
      });

      const promise = runRunnerInteractiveOAuth({
        client,
        redirectUrlProvider,
        callbackListen: {
          hostname: "127.0.0.1",
          port: 6276,
          pathname: "/oauth/callback",
        },
        callbackTimeoutMs: 1000,
        createCallbackServer: () => createMockCallbackServer(handlers),
      });

      const assertRejects =
        expect(promise).rejects.toThrow(/timed out after 1s/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertRejects;
    } finally {
      vi.useRealTimers();
    }
  });

  it("invokes onCallbackServer with the live listener", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    const onCallbackServer = vi.fn();
    const mockServer = createMockCallbackServer(handlers);
    const client = mockClient({
      authenticate: vi.fn(async () => {
        await simulateCallback(handlers.current);
        return new URL("https://as.example/authorize");
      }),
    });

    await runRunnerInteractiveOAuth({
      client,
      redirectUrlProvider,
      callbackListen: {
        hostname: "127.0.0.1",
        port: 6276,
        pathname: "/oauth/callback",
      },
      onCallbackServer,
      createCallbackServer: () => mockServer,
    });

    expect(onCallbackServer).toHaveBeenCalledTimes(1);
    expect(onCallbackServer).toHaveBeenCalledWith(mockServer);
  });

  it("wraps a non-Error completeOAuthFlow rejection", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    const client = mockClient({
      authenticate: vi.fn(async () => {
        await simulateCallback(handlers.current).catch(() => {});
        return new URL("https://as.example/authorize");
      }),
      completeOAuthFlow: vi.fn(async () => {
        throw "string failure";
      }),
    });

    await expect(
      runRunnerInteractiveOAuth({
        client,
        redirectUrlProvider,
        callbackListen: {
          hostname: "127.0.0.1",
          port: 6276,
          pathname: "/oauth/callback",
        },
        createCallbackServer: () => createMockCallbackServer(handlers),
      }),
    ).rejects.toThrow("string failure");
  });

  it("falls back to params.error when no error_description is present", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    const client = mockClient({
      authenticate: vi.fn(async () => {
        handlers.current.onError?.({ error: "access_denied" });
        return new URL("https://as.example/authorize");
      }),
    });

    await expect(
      runRunnerInteractiveOAuth({
        client,
        redirectUrlProvider,
        callbackListen: {
          hostname: "127.0.0.1",
          port: 6276,
          pathname: "/oauth/callback",
        },
        createCallbackServer: () => createMockCallbackServer(handlers),
      }),
    ).rejects.toThrow("access_denied");
  });

  it("defaults to createOAuthCallbackServer when none is provided", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    vi.mocked(createOAuthCallbackServer).mockReturnValue(
      createMockCallbackServer(handlers),
    );
    const client = mockClient({
      authenticate: vi.fn(async () => undefined),
    });

    const result = await runRunnerInteractiveOAuth({
      client,
      redirectUrlProvider,
      callbackListen: {
        hostname: "127.0.0.1",
        port: 6276,
        pathname: "/oauth/callback",
      },
    });

    expect(result).toEqual({ kind: "already_authorized" });
    expect(createOAuthCallbackServer).toHaveBeenCalled();
  });

  it("swallows a server.stop() rejection during cleanup", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    const mockServer = createMockCallbackServer(handlers);
    vi.mocked(mockServer.stop).mockRejectedValue(new Error("stop failed"));
    const client = mockClient({
      authenticate: vi.fn(async () => {
        await simulateCallback(handlers.current);
        return new URL("https://as.example/authorize");
      }),
    });

    const result = await runRunnerInteractiveOAuth({
      client,
      redirectUrlProvider,
      callbackListen: {
        hostname: "127.0.0.1",
        port: 6276,
        pathname: "/oauth/callback",
      },
      createCallbackServer: () => mockServer,
    });

    expect(result).toEqual({ kind: "success" });
    expect(mockServer.stop).toHaveBeenCalled();
  });

  it("cleans up when the callback server fails to start", async () => {
    const redirectUrlProvider = { redirectUrl: "" };
    const mockServer = createMockCallbackServer(handlers);
    vi.mocked(mockServer.start).mockRejectedValue(new Error("bind failed"));
    const client = mockClient();

    await expect(
      runRunnerInteractiveOAuth({
        client,
        redirectUrlProvider,
        callbackListen: {
          hostname: "127.0.0.1",
          port: 6276,
          pathname: "/oauth/callback",
        },
        createCallbackServer: () => mockServer,
      }),
    ).rejects.toThrow("bind failed");
    expect(mockServer.stop).toHaveBeenCalled();
  });
});
