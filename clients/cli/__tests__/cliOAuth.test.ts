import { describe, it, expect, vi, afterEach } from "vitest";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { MutableRedirectUrlProvider } from "@inspector/core/auth/index.js";
import * as runnerInteractive from "@inspector/core/auth/node/runner-interactive-oauth.js";
import {
  connectInspectorWithOAuth,
  handleCliAuthRecoveryRequired,
  isStandardOAuthStepUp,
  runCliInteractiveOAuth,
  assertInteractiveOAuthAllowed,
  assertStepUpPromptAllowed,
  withCliAuthRecoveryRetry,
} from "../src/cliOAuth.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { createInterface } from "node:readline/promises";

// `confirmStepUpFromStdin` (the default step-up confirmer) reads a line from
// stdin via node:readline/promises. Mock the module so the default path can be
// exercised deterministically without real TTY input. Minimal once/removeListener
// surface covers the EOF/close race in the confirmer.
const { mockQuestion, mockClose } = vi.hoisted(() => ({
  mockQuestion: vi.fn(),
  mockClose: vi.fn(),
}));
vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(() => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const rl = {
      question: mockQuestion,
      close: mockClose,
      once(event: string, cb: (...args: unknown[]) => void) {
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        set.add(cb);
        return rl;
      },
      removeListener(event: string, cb: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(cb);
        return rl;
      },
    };
    return rl;
  }),
}));

const CALLBACK_URL_CONFIG = {
  hostname: "127.0.0.1",
  port: 6276,
  pathname: "/oauth/callback",
};

const OAUTH_HTTP_CONFIG = {
  type: "streamable-http",
  url: "https://as.example/mcp",
} as MCPServerConfig;

const STDIO_CONFIG = {
  type: "stdio",
  command: "x",
} as MCPServerConfig;

/** Unit tests run without a TTY; opt into interactive OAuth explicitly. */
const INTERACTIVE = { isTTY: true as const };

describe("cliOAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockQuestion.mockReset();
    mockClose.mockReset();
  });

  describe("isStandardOAuthStepUp", () => {
    it("returns true for insufficient_scope on non-EMA servers", () => {
      expect(
        isStandardOAuthStepUp(
          { reason: "insufficient_scope", requiredScopes: ["weather:read"] },
          {},
        ),
      ).toBe(true);
    });

    it("returns false for EMA servers", () => {
      expect(
        isStandardOAuthStepUp(
          { reason: "insufficient_scope", requiredScopes: ["weather:read"] },
          { enterpriseManaged: true },
        ),
      ).toBe(false);
    });
  });

  it("runCliInteractiveOAuth writes success to stderr", async () => {
    vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth").mockResolvedValue({
      kind: "success",
    });
    const client = {
      authenticate: vi.fn(),
      beginInteractiveAuthorization: vi.fn(),
      completeOAuthFlow: vi.fn(),
      checkAuthChallengeSatisfied: vi.fn(),
    };
    const redirectUrlProvider = new MutableRedirectUrlProvider();
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await runCliInteractiveOAuth(client, redirectUrlProvider, {
      hostname: "127.0.0.1",
      port: 6276,
      pathname: "/oauth/callback",
    });

    expect(stderrSpy).toHaveBeenCalledWith("Authorization complete.\n");
  });

  it("runCliInteractiveOAuth arms autoOpenControl only for the interactive flow", async () => {
    const autoOpenControl = { armed: false };
    let armedDuringCall = false;
    vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth").mockImplementation(
      async () => {
        armedDuringCall = autoOpenControl.armed;
        return { kind: "success" };
      },
    );
    const client = {
      authenticate: vi.fn(),
      beginInteractiveAuthorization: vi.fn(),
      completeOAuthFlow: vi.fn(),
      checkAuthChallengeSatisfied: vi.fn(),
    };
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await runCliInteractiveOAuth(
      client,
      new MutableRedirectUrlProvider(),
      { hostname: "127.0.0.1", port: 6276, pathname: "/oauth/callback" },
      { autoOpenControl },
    );

    expect(armedDuringCall).toBe(true);
    expect(autoOpenControl.armed).toBe(false);
    expect(stderrSpy).toHaveBeenCalledWith("Authorization complete.\n");
  });

  it("runCliInteractiveOAuth throws when scopes remain insufficient", async () => {
    const challenge = {
      reason: "insufficient_scope" as const,
      requiredScopes: ["weather:read"],
    };
    vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth").mockResolvedValue({
      kind: "insufficient_scope",
      challenge,
    });
    const client = {
      authenticate: vi.fn(),
      beginInteractiveAuthorization: vi.fn(),
      completeOAuthFlow: vi.fn(),
      checkAuthChallengeSatisfied: vi.fn(),
    };

    await expect(
      runCliInteractiveOAuth(
        client,
        new MutableRedirectUrlProvider(),
        { hostname: "127.0.0.1", port: 6276, pathname: "/oauth/callback" },
        { authChallenge: challenge },
      ),
    ).rejects.toThrow(/required scopes were not granted/);
  });

  it("handleCliAuthRecoveryRequired declines standard step-up when user says no", async () => {
    const runSpy = vi
      .spyOn(runnerInteractive, "runRunnerInteractiveOAuth")
      .mockResolvedValue({ kind: "success" });
    const client = {
      authenticate: vi.fn(),
      beginInteractiveAuthorization: vi.fn(),
      completeOAuthFlow: vi.fn(),
      checkAuthChallengeSatisfied: vi.fn(),
    };
    const error = new AuthRecoveryRequiredError(
      new URL("https://as.example/authorize"),
      { reason: "insufficient_scope", requiredScopes: ["weather:read"] },
    );

    await expect(
      handleCliAuthRecoveryRequired(
        client,
        error,
        new MutableRedirectUrlProvider(),
        { hostname: "127.0.0.1", port: 6276, pathname: "/oauth/callback" },
        {},
        { confirmStepUp: async () => false, isTTY: true },
      ),
    ).rejects.toThrow("Step-up authorization declined.");

    expect(runSpy).not.toHaveBeenCalled();
  });

  it("handleCliAuthRecoveryRequired runs OAuth after step-up confirm", async () => {
    const runSpy = vi
      .spyOn(runnerInteractive, "runRunnerInteractiveOAuth")
      .mockResolvedValue({ kind: "success" });
    const client = {
      authenticate: vi.fn(),
      beginInteractiveAuthorization: vi.fn(),
      completeOAuthFlow: vi.fn(),
      checkAuthChallengeSatisfied: vi.fn(),
    };
    const authorizationUrl = new URL("https://as.example/authorize");
    const challenge = {
      reason: "insufficient_scope" as const,
      requiredScopes: ["weather:read"],
    };
    const error = new AuthRecoveryRequiredError(authorizationUrl, challenge);

    await handleCliAuthRecoveryRequired(
      client,
      error,
      new MutableRedirectUrlProvider(),
      { hostname: "127.0.0.1", port: 6276, pathname: "/oauth/callback" },
      {},
      { confirmStepUp: async () => true, isTTY: true },
    );

    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationUrl,
        authChallenge: challenge,
      }),
    );
  });

  it("handleCliAuthRecoveryRequired skips step-up when storage already satisfies", async () => {
    const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
    const client = {
      authenticate: vi.fn(),
      beginInteractiveAuthorization: vi.fn(),
      completeOAuthFlow: vi.fn(),
      checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(true),
    };
    const error = new AuthRecoveryRequiredError(
      new URL("https://as.example/authorize"),
      {
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
      },
    );

    await handleCliAuthRecoveryRequired(
      client,
      error,
      new MutableRedirectUrlProvider(),
      { hostname: "127.0.0.1", port: 6276, pathname: "/oauth/callback" },
    );

    expect(runSpy).not.toHaveBeenCalled();
  });

  it("handleCliAuthRecoveryRequired skips OAuth when storage already satisfies reauth", async () => {
    const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
    const client = {
      authenticate: vi.fn(),
      beginInteractiveAuthorization: vi.fn(),
      completeOAuthFlow: vi.fn(),
      checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(true),
    };
    const error = new AuthRecoveryRequiredError(
      new URL("https://as.example/authorize"),
      { reason: "token_expired" },
    );

    await handleCliAuthRecoveryRequired(
      client,
      error,
      new MutableRedirectUrlProvider(),
      { hostname: "127.0.0.1", port: 6276, pathname: "/oauth/callback" },
    );

    expect(runSpy).not.toHaveBeenCalled();
  });

  it("withCliAuthRecoveryRetry reruns the operation after interactive recovery", async () => {
    vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth").mockResolvedValue({
      kind: "success",
    });
    const connect = vi.fn().mockResolvedValue(undefined);
    const client = {
      connect,
      disconnect: vi.fn(),
      authenticate: vi.fn(),
      beginInteractiveAuthorization: vi.fn(),
      completeOAuthFlow: vi.fn(),
      checkAuthChallengeSatisfied: vi.fn(),
    };
    const fn = vi
      .fn()
      .mockRejectedValueOnce(
        new AuthRecoveryRequiredError(new URL("https://as.example/authorize"), {
          reason: "unauthorized",
        }),
      )
      .mockResolvedValueOnce("ok");

    const result = await withCliAuthRecoveryRetry(
      client,
      OAUTH_HTTP_CONFIG,
      new MutableRedirectUrlProvider(),
      { hostname: "127.0.0.1", port: 6276, pathname: "/oauth/callback" },
      { enterpriseManaged: true },
      fn,
      { confirmStepUp: async () => true, isTTY: true },
    );

    expect(result).toBe("ok");
    expect(connect).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  describe("confirmStepUpFromStdin (default stdin confirmer)", () => {
    const standardStepUpError = () =>
      new AuthRecoveryRequiredError(new URL("https://as.example/authorize"), {
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
      });

    const clientNeedingStepUp = () => ({
      authenticate: vi.fn(),
      beginInteractiveAuthorization: vi.fn(),
      completeOAuthFlow: vi.fn(),
      checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(false),
    });

    it("proceeds with OAuth when the user answers y (no confirmStepUp arg)", async () => {
      mockQuestion.mockResolvedValue("y");
      const runSpy = vi
        .spyOn(runnerInteractive, "runRunnerInteractiveOAuth")
        .mockResolvedValue({ kind: "success" });

      // Omitting confirmStepUp exercises the default confirmStepUpFromStdin,
      // which reads from the mocked readline interface.
      await handleCliAuthRecoveryRequired(
        clientNeedingStepUp(),
        standardStepUpError(),
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        {},
        INTERACTIVE,
      );

      expect(mockQuestion).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
      expect(runSpy).toHaveBeenCalled();
    });

    it("accepts a whitespace-padded, upper-case 'YES'", async () => {
      mockQuestion.mockResolvedValue("  YES  ");
      const runSpy = vi
        .spyOn(runnerInteractive, "runRunnerInteractiveOAuth")
        .mockResolvedValue({ kind: "success" });

      await handleCliAuthRecoveryRequired(
        clientNeedingStepUp(),
        standardStepUpError(),
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        {},
        INTERACTIVE,
      );

      expect(runSpy).toHaveBeenCalled();
    });

    it("declines (throws) when the user answers n", async () => {
      mockQuestion.mockResolvedValue("n");
      const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");

      await expect(
        handleCliAuthRecoveryRequired(
          clientNeedingStepUp(),
          standardStepUpError(),
          new MutableRedirectUrlProvider(),
          CALLBACK_URL_CONFIG,
          {},
          INTERACTIVE,
        ),
      ).rejects.toThrow("Step-up authorization declined.");

      expect(mockClose).toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();
    });

    it("declines when readline question rejects", async () => {
      mockQuestion.mockRejectedValue(new Error("stdin closed"));
      const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");

      await expect(
        handleCliAuthRecoveryRequired(
          clientNeedingStepUp(),
          standardStepUpError(),
          new MutableRedirectUrlProvider(),
          CALLBACK_URL_CONFIG,
          {},
          INTERACTIVE,
        ),
      ).rejects.toThrow("Step-up authorization declined.");

      expect(runSpy).not.toHaveBeenCalled();
    });

    it("declines when stdin EOF closes the readline interface before an answer", async () => {
      const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
      vi.mocked(createInterface).mockImplementationOnce(() => {
        const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
        const rl = {
          question: vi.fn(() => new Promise<string>(() => {})),
          close: mockClose,
          once(event: string, cb: (...args: unknown[]) => void) {
            let set = listeners.get(event);
            if (!set) {
              set = new Set();
              listeners.set(event, set);
            }
            set.add(cb);
            return rl;
          },
          removeListener(event: string, cb: (...args: unknown[]) => void) {
            listeners.get(event)?.delete(cb);
            return rl;
          },
        };
        queueMicrotask(() => {
          for (const cb of listeners.get("close") ?? []) cb();
        });
        return rl as unknown as ReturnType<typeof createInterface>;
      });

      await expect(
        handleCliAuthRecoveryRequired(
          clientNeedingStepUp(),
          standardStepUpError(),
          new MutableRedirectUrlProvider(),
          CALLBACK_URL_CONFIG,
          {},
          INTERACTIVE,
        ),
      ).rejects.toThrow("Step-up authorization declined.");

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  it("assertStepUpPromptAllowed fails without a stdin TTY when using the default confirmer", () => {
    expect(() => assertStepUpPromptAllowed({ isTTY: false })).toThrow(
      /Step-up authorization requires a TTY on stdin/,
    );
  });

  it("assertStepUpPromptAllowed skips the stdin gate when confirmStepUp is provided", () => {
    expect(() =>
      assertStepUpPromptAllowed({
        isTTY: false,
        confirmStepUp: async () => true,
      }),
    ).not.toThrow();
  });

  it("step-up fails fast without stdin even when interactive OAuth is force-admitted", async () => {
    // MCP_AUTO_OPEN_ENABLED=true admits the interactive-OAuth gate, but the
    // [y/N] prompt still needs stdin — otherwise CI hangs forever.
    vi.stubEnv("MCP_AUTO_OPEN_ENABLED", "true");
    const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
    try {
      await expect(
        handleCliAuthRecoveryRequired(
          {
            authenticate: vi.fn(),
            beginInteractiveAuthorization: vi.fn(),
            completeOAuthFlow: vi.fn(),
            checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(false),
          },
          new AuthRecoveryRequiredError(
            new URL("https://as.example/authorize"),
            {
              reason: "insufficient_scope",
              requiredScopes: ["weather:read"],
            },
          ),
          new MutableRedirectUrlProvider(),
          CALLBACK_URL_CONFIG,
          {},
          { isTTY: false },
        ),
      ).rejects.toMatchObject({
        exitCode: 3,
        message: expect.stringMatching(
          /Step-up authorization requires a TTY on stdin/,
        ),
      });
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  describe("connectInspectorWithOAuth recovery branch", () => {
    const oauthServerConfig = OAUTH_HTTP_CONFIG;

    it("resumes without re-auth when storage already satisfies the challenge", async () => {
      const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
      const connect = vi
        .fn()
        .mockRejectedValueOnce(
          new AuthRecoveryRequiredError(
            new URL("https://as.example/authorize"),
            { reason: "insufficient_scope", requiredScopes: ["weather:read"] },
          ),
        )
        .mockResolvedValueOnce(undefined);
      const client = {
        connect,
        disconnect: vi.fn(),
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(true),
      };

      await connectInspectorWithOAuth(
        client,
        oauthServerConfig,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
      );

      expect(connect).toHaveBeenCalledTimes(2);
      expect(runSpy).not.toHaveBeenCalled();
    });

    it("runs interactive recovery when storage does not satisfy the challenge", async () => {
      const runSpy = vi
        .spyOn(runnerInteractive, "runRunnerInteractiveOAuth")
        .mockResolvedValue({ kind: "success" });
      const connect = vi
        .fn()
        .mockRejectedValueOnce(
          new AuthRecoveryRequiredError(
            new URL("https://as.example/authorize"),
            { reason: "token_expired" },
          ),
        )
        .mockResolvedValueOnce(undefined);
      const client = {
        connect,
        disconnect: vi.fn(),
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(false),
      };

      await connectInspectorWithOAuth(
        client,
        oauthServerConfig,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        INTERACTIVE,
      );

      expect(connect).toHaveBeenCalledTimes(2);
      expect(runSpy).toHaveBeenCalled();
    });

    it("runs interactive OAuth on a plain unauthorized error (disconnect failure is swallowed)", async () => {
      const runSpy = vi
        .spyOn(runnerInteractive, "runRunnerInteractiveOAuth")
        .mockResolvedValue({ kind: "success" });
      const connect = vi
        .fn()
        .mockRejectedValueOnce(new Error("Connection failed for server (401)"))
        .mockResolvedValueOnce(undefined);
      // A rejecting disconnect exercises the `.catch(() => {})` guard.
      const client = {
        connect,
        disconnect: vi.fn().mockRejectedValue(new Error("disconnect failed")),
        checkAuthChallengeSatisfied: vi.fn(),
      };

      await connectInspectorWithOAuth(
        client,
        oauthServerConfig,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        INTERACTIVE,
      );

      expect(client.disconnect).toHaveBeenCalled();
      expect(runSpy).toHaveBeenCalled();
      expect(connect).toHaveBeenCalledTimes(2);
    });

    it("rethrows a non-OAuth error unchanged", async () => {
      const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
      const connect = vi
        .fn()
        .mockRejectedValue(new Error("some unrelated failure"));
      const client = {
        connect,
        disconnect: vi.fn(),
        checkAuthChallengeSatisfied: vi.fn(),
      };

      await expect(
        connectInspectorWithOAuth(
          client,
          oauthServerConfig,
          new MutableRedirectUrlProvider(),
          CALLBACK_URL_CONFIG,
        ),
      ).rejects.toThrow("some unrelated failure");
      expect(runSpy).not.toHaveBeenCalled();
    });

    it("rethrows when the server config is not OAuth-capable", async () => {
      const connect = vi.fn().mockRejectedValue(new Error("nope (401)"));
      const client = {
        connect,
        disconnect: vi.fn(),
        checkAuthChallengeSatisfied: vi.fn(),
      };

      await expect(
        connectInspectorWithOAuth(
          client,
          { type: "stdio", command: "x" } as MCPServerConfig,
          new MutableRedirectUrlProvider(),
          CALLBACK_URL_CONFIG,
        ),
      ).rejects.toThrow("nope (401)");
    });

    it("fails with AUTH_REQUIRED under --stored-auth-only without interactive OAuth", async () => {
      const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
      const connect = vi.fn().mockRejectedValue(
        new AuthRecoveryRequiredError(new URL("https://as.example/authorize"), {
          reason: "token_expired",
        }),
      );
      const client = {
        connect,
        disconnect: vi.fn(),
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(false),
      };

      await expect(
        connectInspectorWithOAuth(
          client,
          oauthServerConfig,
          new MutableRedirectUrlProvider(),
          CALLBACK_URL_CONFIG,
          undefined,
          { storedAuthOnly: true },
        ),
      ).rejects.toMatchObject({ exitCode: 3 });
      expect(runSpy).not.toHaveBeenCalled();
    });

    it("under --stored-auth-only reconnects when the store already satisfies", async () => {
      const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
      const connect = vi
        .fn()
        .mockRejectedValueOnce(
          new AuthRecoveryRequiredError(
            new URL("https://as.example/authorize"),
            { reason: "token_expired" },
          ),
        )
        .mockResolvedValueOnce(undefined);
      const client = {
        connect,
        disconnect: vi.fn(),
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(true),
      };

      await connectInspectorWithOAuth(
        client,
        oauthServerConfig,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        { storedAuthOnly: true },
      );

      expect(connect).toHaveBeenCalledTimes(2);
      expect(runSpy).not.toHaveBeenCalled();
    });

    it("fails stored-auth-only on plain unauthorized errors", async () => {
      const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
      const connect = vi
        .fn()
        .mockRejectedValue(new Error("Connection failed for server (401)"));
      const client = {
        connect,
        disconnect: vi.fn(),
        checkAuthChallengeSatisfied: vi.fn(),
      };

      await expect(
        connectInspectorWithOAuth(
          client,
          oauthServerConfig,
          new MutableRedirectUrlProvider(),
          CALLBACK_URL_CONFIG,
          undefined,
          { storedAuthOnly: true },
        ),
      ).rejects.toMatchObject({ exitCode: 3 });
      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  it("withCliAuthRecoveryRetry respects storedAuthOnly", async () => {
    const checkAuthChallengeSatisfied = vi.fn().mockResolvedValue(false);
    const fn = vi.fn().mockRejectedValue(
      new AuthRecoveryRequiredError(new URL("https://as.example/authorize"), {
        reason: "token_expired",
      }),
    );
    await expect(
      withCliAuthRecoveryRetry(
        {
          connect: vi.fn(),
          disconnect: vi.fn(),
          authenticate: vi.fn(),
          beginInteractiveAuthorization: vi.fn(),
          completeOAuthFlow: vi.fn(),
          checkAuthChallengeSatisfied,
        },
        OAUTH_HTTP_CONFIG,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        fn,
        { storedAuthOnly: true },
      ),
    ).rejects.toMatchObject({ exitCode: 3 });
    expect(checkAuthChallengeSatisfied).toHaveBeenCalledOnce();
  });

  it("withCliAuthRecoveryRetry under storedAuthOnly retries when the store satisfies the challenge", async () => {
    const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
    const challenge = {
      reason: "token_expired" as const,
    };
    const fn = vi
      .fn()
      .mockRejectedValueOnce(
        new AuthRecoveryRequiredError(
          new URL("https://as.example/authorize"),
          challenge,
        ),
      )
      .mockResolvedValueOnce("ok");
    const checkAuthChallengeSatisfied = vi.fn().mockResolvedValue(true);

    const result = await withCliAuthRecoveryRetry(
      {
        connect: vi.fn(),
        disconnect: vi.fn(),
        authenticate: vi.fn(),
        beginInteractiveAuthorization: vi.fn(),
        completeOAuthFlow: vi.fn(),
        checkAuthChallengeSatisfied,
      },
      OAUTH_HTTP_CONFIG,
      new MutableRedirectUrlProvider(),
      CALLBACK_URL_CONFIG,
      undefined,
      fn,
      { storedAuthOnly: true },
    );

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(checkAuthChallengeSatisfied).toHaveBeenCalledWith(challenge);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("withCliAuthRecoveryRetry recovers plain unauthorized errors like connect", async () => {
    const runSpy = vi
      .spyOn(runnerInteractive, "runRunnerInteractiveOAuth")
      .mockResolvedValue({ kind: "success" });
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const callOrder: string[] = [];
    connect.mockImplementation(async () => {
      callOrder.push("connect");
    });
    const fn = vi
      .fn()
      .mockImplementationOnce(async () => {
        callOrder.push("fn1");
        throw new Error("RPC failed (401)");
      })
      .mockImplementationOnce(async () => {
        callOrder.push("fn2");
        return "ok";
      });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await withCliAuthRecoveryRetry(
      {
        connect,
        disconnect,
        authenticate: vi.fn(),
        beginInteractiveAuthorization: vi.fn(),
        completeOAuthFlow: vi.fn(),
        checkAuthChallengeSatisfied: vi.fn(),
      },
      OAUTH_HTTP_CONFIG,
      new MutableRedirectUrlProvider(),
      CALLBACK_URL_CONFIG,
      undefined,
      fn,
      INTERACTIVE,
    );

    expect(result).toBe("ok");
    expect(disconnect).toHaveBeenCalledOnce();
    expect(runSpy).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(["fn1", "connect", "fn2"]);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Authorization complete. Retrying…\n",
    );
  });

  it("withCliAuthRecoveryRetry fails stored-auth-only on plain unauthorized errors", async () => {
    const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
    const fn = vi.fn().mockRejectedValue(new Error("RPC failed (401)"));

    await expect(
      withCliAuthRecoveryRetry(
        {
          connect: vi.fn(),
          disconnect: vi.fn(),
          authenticate: vi.fn(),
          beginInteractiveAuthorization: vi.fn(),
          completeOAuthFlow: vi.fn(),
          checkAuthChallengeSatisfied: vi.fn(),
        },
        OAUTH_HTTP_CONFIG,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        fn,
        { storedAuthOnly: true },
      ),
    ).rejects.toMatchObject({ exitCode: 3 });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("withCliAuthRecoveryRetry rethrows unauthorized errors for non-OAuth configs", async () => {
    const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
    const err = new Error("proxied backend failed with status (401)");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(
      withCliAuthRecoveryRetry(
        {
          connect: vi.fn(),
          disconnect: vi.fn(),
          authenticate: vi.fn(),
          beginInteractiveAuthorization: vi.fn(),
          completeOAuthFlow: vi.fn(),
          checkAuthChallengeSatisfied: vi.fn(),
        },
        STDIO_CONFIG,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        fn,
      ),
    ).rejects.toBe(err);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("withCliAuthRecoveryRetry rethrows unrelated errors unchanged", async () => {
    const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
    const err = new Error("something else went wrong");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(
      withCliAuthRecoveryRetry(
        {
          connect: vi.fn(),
          disconnect: vi.fn(),
          authenticate: vi.fn(),
          beginInteractiveAuthorization: vi.fn(),
          completeOAuthFlow: vi.fn(),
          checkAuthChallengeSatisfied: vi.fn(),
        },
        OAUTH_HTTP_CONFIG,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        fn,
      ),
    ).rejects.toBe(err);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("withCliAuthRecoveryRetry stored-auth-only uses a fallback message for non-Error 401s", async () => {
    const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
    const fn = vi.fn().mockRejectedValue({ status: 401 });

    await expect(
      withCliAuthRecoveryRetry(
        {
          connect: vi.fn(),
          disconnect: vi.fn(),
          authenticate: vi.fn(),
          beginInteractiveAuthorization: vi.fn(),
          completeOAuthFlow: vi.fn(),
          checkAuthChallengeSatisfied: vi.fn(),
        },
        OAUTH_HTTP_CONFIG,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        fn,
        { storedAuthOnly: true },
      ),
    ).rejects.toMatchObject({
      exitCode: 3,
      message: expect.stringMatching(/--stored-auth-only/),
    });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("assertInteractiveOAuthAllowed fails fast when neither stream is a TTY", () => {
    expect(() => assertInteractiveOAuthAllowed({ isTTY: false })).toThrow(
      /Interactive OAuth requires a TTY on stdin or stderr/,
    );
  });

  it("assertInteractiveOAuthAllowed admits when isTTY override is true (stdin||stderr path)", () => {
    expect(() => assertInteractiveOAuthAllowed({ isTTY: true })).not.toThrow();
  });

  it("assertInteractiveOAuthAllowed admits when stdin is a TTY even if stderr is not", () => {
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stderrDesc = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      get: () => false,
    });
    try {
      expect(() => assertInteractiveOAuthAllowed()).not.toThrow();
    } finally {
      if (stdinDesc) Object.defineProperty(process.stdin, "isTTY", stdinDesc);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
      if (stderrDesc)
        Object.defineProperty(process.stderr, "isTTY", stderrDesc);
      else delete (process.stderr as { isTTY?: boolean }).isTTY;
    }
  });

  it("assertInteractiveOAuthAllowed fails when both stdin and stderr are non-TTY", () => {
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stderrDesc = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      get: () => false,
    });
    try {
      expect(() => assertInteractiveOAuthAllowed()).toThrow(
        /Interactive OAuth requires a TTY on stdin or stderr/,
      );
    } finally {
      if (stdinDesc) Object.defineProperty(process.stdin, "isTTY", stdinDesc);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
      if (stderrDesc)
        Object.defineProperty(process.stderr, "isTTY", stderrDesc);
      else delete (process.stderr as { isTTY?: boolean }).isTTY;
    }
  });

  it("runCliInteractiveOAuth is quiet on already_authorized", async () => {
    vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth").mockResolvedValue({
      kind: "already_authorized",
    });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await runCliInteractiveOAuth(
      {
        authenticate: vi.fn(),
        beginInteractiveAuthorization: vi.fn(),
        completeOAuthFlow: vi.fn(),
        checkAuthChallengeSatisfied: vi.fn(),
      },
      new MutableRedirectUrlProvider(),
      CALLBACK_URL_CONFIG,
    );
    expect(stderrSpy).not.toHaveBeenCalledWith("Authorization complete.\n");
  });

  it("connectInspectorWithOAuth stored-auth-only uses fallback when AuthRecovery message is empty", async () => {
    const err = new AuthRecoveryRequiredError(
      new URL("https://as.example/authorize"),
      { reason: "token_expired" },
    );
    Object.defineProperty(err, "message", { value: "" });
    const connect = vi.fn().mockRejectedValue(err);
    await expect(
      connectInspectorWithOAuth(
        {
          connect,
          disconnect: vi.fn(),
          checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(false),
        },
        OAUTH_HTTP_CONFIG,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        { storedAuthOnly: true },
      ),
    ).rejects.toMatchObject({
      exitCode: 3,
      message: expect.stringMatching(/--stored-auth-only/),
    });
  });

  it("withCliAuthRecoveryRetry refuses interactive OAuth on a non-TTY", async () => {
    const runSpy = vi.spyOn(runnerInteractive, "runRunnerInteractiveOAuth");
    const fn = vi.fn().mockRejectedValue(new Error("RPC failed (401)"));

    await expect(
      withCliAuthRecoveryRetry(
        {
          connect: vi.fn(),
          disconnect: vi.fn(),
          authenticate: vi.fn(),
          beginInteractiveAuthorization: vi.fn(),
          completeOAuthFlow: vi.fn(),
          checkAuthChallengeSatisfied: vi.fn(),
        },
        OAUTH_HTTP_CONFIG,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        fn,
        { isTTY: false },
      ),
    ).rejects.toMatchObject({
      exitCode: 3,
      message: expect.stringMatching(/--stored-auth-only/),
    });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("withCliAuthRecoveryRetry allows non-TTY interactive OAuth when MCP_AUTO_OPEN_ENABLED=true", async () => {
    const prev = process.env.MCP_AUTO_OPEN_ENABLED;
    process.env.MCP_AUTO_OPEN_ENABLED = "true";
    try {
      const runSpy = vi
        .spyOn(runnerInteractive, "runRunnerInteractiveOAuth")
        .mockResolvedValue({ kind: "success" });
      const connect = vi.fn().mockResolvedValue(undefined);
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("RPC failed (401)"))
        .mockResolvedValueOnce("ok");
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const result = await withCliAuthRecoveryRetry(
        {
          connect,
          disconnect: vi.fn().mockResolvedValue(undefined),
          authenticate: vi.fn(),
          beginInteractiveAuthorization: vi.fn(),
          completeOAuthFlow: vi.fn(),
          checkAuthChallengeSatisfied: vi.fn(),
        },
        OAUTH_HTTP_CONFIG,
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        undefined,
        fn,
        { isTTY: false },
      );

      expect(result).toBe("ok");
      expect(runSpy).toHaveBeenCalledOnce();
      expect(connect).toHaveBeenCalledOnce();
    } finally {
      if (prev === undefined) {
        delete process.env.MCP_AUTO_OPEN_ENABLED;
      } else {
        process.env.MCP_AUTO_OPEN_ENABLED = prev;
      }
    }
  });
});
