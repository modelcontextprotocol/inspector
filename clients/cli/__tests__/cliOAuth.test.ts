import { describe, it, expect, vi, afterEach } from "vitest";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { MutableRedirectUrlProvider } from "@inspector/core/auth/index.js";
import * as runnerInteractive from "@inspector/core/auth/node/runner-interactive-oauth.js";
import {
  connectInspectorWithOAuth,
  handleCliAuthRecoveryRequired,
  isStandardOAuthStepUp,
  runCliInteractiveOAuth,
  withCliAuthRecoveryRetry,
} from "../src/cliOAuth.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

// `confirmStepUpFromStdin` (the default step-up confirmer) reads a line from
// stdin via node:readline/promises. Mock the module so the default path can be
// exercised deterministically without real TTY input.
const { mockQuestion, mockClose } = vi.hoisted(() => ({
  mockQuestion: vi.fn(),
  mockClose: vi.fn(),
}));
vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockClose,
  })),
}));

const CALLBACK_URL_CONFIG = {
  hostname: "127.0.0.1",
  port: 6276,
  pathname: "/oauth/callback",
};

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
        async () => false,
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
      async () => true,
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
    const client = {
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
      new MutableRedirectUrlProvider(),
      { hostname: "127.0.0.1", port: 6276, pathname: "/oauth/callback" },
      { enterpriseManaged: true },
      fn,
      async () => true,
    );

    expect(result).toBe("ok");
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

      // Omitting the confirmStepUp argument exercises the default
      // confirmStepUpFromStdin, which reads from the mocked readline interface.
      await handleCliAuthRecoveryRequired(
        clientNeedingStepUp(),
        standardStepUpError(),
        new MutableRedirectUrlProvider(),
        CALLBACK_URL_CONFIG,
        {},
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
        ),
      ).rejects.toThrow("Step-up authorization declined.");

      expect(mockClose).toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("connectInspectorWithOAuth recovery branch", () => {
    const oauthServerConfig = {
      type: "streamable-http",
      url: "https://as.example/mcp",
    } as MCPServerConfig;

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
  });
});
