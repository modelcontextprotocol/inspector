import { describe, it, expect, vi, afterEach } from "vitest";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { MutableRedirectUrlProvider } from "@inspector/core/auth/index.js";
import * as runnerInteractive from "@inspector/core/auth/node/runner-interactive-oauth.js";
import {
  handleCliAuthRecoveryRequired,
  isStandardOAuthStepUp,
  runCliInteractiveOAuth,
  withCliAuthRecoveryRetry,
} from "../src/cliOAuth.js";

describe("cliOAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
