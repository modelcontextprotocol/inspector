import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthChallengeError } from "@inspector/core/auth/challenge.js";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { RemoteClientTransport } from "@inspector/core/mcp/remote/remoteClientTransport.js";

/**
 * Additional branch coverage for the mid-session auth recovery paths
 * (`handleAmbientAuthChallenge` / `runAmbientAuthChallenge`, `withDirectAuthRecovery`,
 * `pushRemoteAuthState`, `resumeAfterOAuth`). Complements
 * inspectorClient-ambient-auth.test.ts and inspectorClient-direct-auth-recovery.test.ts,
 * which each cover a single "happy path" through these methods.
 *
 * Uses the same `Object.create(InspectorClient.prototype)` technique as the
 * sibling test files so each test can wire up only the private fields its
 * branch needs, without a live transport or a real OAuthManager.
 */

type FakeOAuthManager = {
  handleAuthChallenge: ReturnType<typeof vi.fn>;
  completeOAuthFlow?: ReturnType<typeof vi.fn>;
};

type Internals = {
  oauthManager: FakeOAuthManager | null;
  baseTransport: unknown;
  ambientAuthChallengeInFlight: Map<string, Promise<void>>;
  directAuthRecovery: boolean;
  directAuthRecoveryActive: boolean | null;
  activeToolCallAbortController?: AbortController;
  status: string;
  reconnectAfterAuthRecovery: () => Promise<void>;
  withDirectAuthRecovery: <T>(
    operation: () => Promise<T>,
    context?: { method?: string; toolName?: string },
    attempt?: number,
  ) => Promise<T>;
};

function makeClient(): InspectorClient {
  const client = Object.create(InspectorClient.prototype) as InspectorClient;
  (client as unknown as Internals).ambientAuthChallengeInFlight = new Map();
  return client;
}

function internalsOf(client: InspectorClient): Internals {
  return client as unknown as Internals;
}

describe("InspectorClient pushRemoteAuthState", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is a no-op when the base transport is not a RemoteClientTransport", async () => {
    const client = makeClient();
    internalsOf(client).baseTransport = null;

    await expect(client.pushRemoteAuthState()).resolves.toBeUndefined();
  });
});

describe("InspectorClient runAmbientAuthChallenge branches", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const challenge: AuthChallenge = { reason: "token_expired" };

  it("returns without dispatching a recovery outcome when no oauthManager is configured", async () => {
    const client = makeClient();
    internalsOf(client).oauthManager = null;
    const dispatch = vi
      .spyOn(client, "dispatchTypedEvent")
      .mockImplementation(() => {});

    await client.handleAmbientAuthChallenge(challenge);

    // Only the initial "ambient" announcement fires; the early return means no
    // outcome-specific event (recovered/interactive/oauthError) is dispatched.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("authChallengeAmbient", {
      challenge,
    });
  });

  it("reconnects (rather than pushing remote auth state) for a non-remote transport on a satisfied outcome", async () => {
    const client = makeClient();
    const handleAuthChallenge = vi
      .fn()
      .mockResolvedValue({ kind: "satisfied" });
    internalsOf(client).oauthManager = { handleAuthChallenge };
    internalsOf(client).baseTransport = {}; // not a RemoteClientTransport instance
    const reconnect = vi.fn().mockResolvedValue(undefined);
    internalsOf(client).reconnectAfterAuthRecovery = reconnect;
    const pushRemoteAuthState = vi
      .spyOn(client, "pushRemoteAuthState")
      .mockResolvedValue(undefined);
    const dispatch = vi
      .spyOn(client, "dispatchTypedEvent")
      .mockImplementation(() => {});

    await client.handleAmbientAuthChallenge(challenge);

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(pushRemoteAuthState).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith("authChallengeRecovered", {
      challenge,
    });
  });

  it("dispatches an interactive event with the EMA pending URL for a step_up_confirm outcome", async () => {
    const client = makeClient();
    const outcomeChallenge: AuthChallenge = {
      reason: "insufficient_scope",
      requiredScopes: ["weather:read"],
    };
    const handleAuthChallenge = vi.fn().mockResolvedValue({
      kind: "step_up_confirm",
      challenge: outcomeChallenge,
    });
    internalsOf(client).oauthManager = { handleAuthChallenge };
    const dispatch = vi
      .spyOn(client, "dispatchTypedEvent")
      .mockImplementation(() => {});

    await client.handleAmbientAuthChallenge(challenge);

    expect(dispatch).toHaveBeenCalledWith(
      "authChallengeInteractive",
      expect.objectContaining({ challenge: outcomeChallenge }),
    );
  });

  it("dispatches oauthError for a failed outcome", async () => {
    const client = makeClient();
    const error = new Error("recovery failed");
    const handleAuthChallenge = vi
      .fn()
      .mockResolvedValue({ kind: "failed", error });
    internalsOf(client).oauthManager = { handleAuthChallenge };
    const dispatch = vi
      .spyOn(client, "dispatchTypedEvent")
      .mockImplementation(() => {});

    await client.handleAmbientAuthChallenge(challenge);

    expect(dispatch).toHaveBeenCalledWith("oauthError", { error });
  });

  it("wraps a non-Error thrown from handleAuthChallenge before dispatching oauthError", async () => {
    const client = makeClient();
    const handleAuthChallenge = vi.fn().mockRejectedValue("boom-string");
    internalsOf(client).oauthManager = { handleAuthChallenge };
    const dispatch = vi
      .spyOn(client, "dispatchTypedEvent")
      .mockImplementation(() => {});

    await client.handleAmbientAuthChallenge(challenge);

    const call = dispatch.mock.calls.find(([name]) => name === "oauthError");
    expect(call).toBeDefined();
    const detail = call?.[1] as { error: Error };
    expect(detail.error).toBeInstanceOf(Error);
    expect(detail.error.message).toBe("boom-string");
  });

  it("passes through a real Error thrown from handleAuthChallenge unwrapped", async () => {
    const client = makeClient();
    const thrown = new Error("direct failure");
    const handleAuthChallenge = vi.fn().mockRejectedValue(thrown);
    internalsOf(client).oauthManager = { handleAuthChallenge };
    const dispatch = vi
      .spyOn(client, "dispatchTypedEvent")
      .mockImplementation(() => {});

    await client.handleAmbientAuthChallenge(challenge);

    const call = dispatch.mock.calls.find(([name]) => name === "oauthError");
    expect(call?.[1]).toEqual({ error: thrown });
  });
});

describe("InspectorClient withDirectAuthRecovery branches", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rethrows immediately without consulting handleAuthChallenge for a non-auth-challenge error", async () => {
    const client = makeClient();
    internalsOf(client).directAuthRecovery = true;
    internalsOf(client).directAuthRecoveryActive = true;
    const operation = vi.fn().mockRejectedValue(new Error("network down"));
    const handleAuthChallenge = vi.spyOn(client, "handleAuthChallenge");

    await expect(
      internalsOf(client).withDirectAuthRecovery.call(client, operation),
    ).rejects.toThrow("network down");

    expect(operation).toHaveBeenCalledTimes(1);
    expect(handleAuthChallenge).not.toHaveBeenCalled();
  });

  it("clears an active tool-call abort controller and retries after a satisfied recovery", async () => {
    const client = makeClient();
    internalsOf(client).directAuthRecovery = true;
    internalsOf(client).directAuthRecoveryActive = true;
    const abortController = new AbortController();
    internalsOf(client).activeToolCallAbortController = abortController;
    const reconnect = vi.fn().mockResolvedValue(undefined);
    internalsOf(client).reconnectAfterAuthRecovery = reconnect;

    const challenge = { reason: "token_expired" as const };
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new AuthChallengeError(challenge, 401))
      .mockResolvedValueOnce("ok");
    vi.spyOn(client, "handleAuthChallenge").mockResolvedValue({
      kind: "satisfied",
    });
    vi.spyOn(client, "dispatchTypedEvent").mockImplementation(() => {});

    const result = await internalsOf(client).withDirectAuthRecovery.call(
      client,
      operation,
    );

    expect(result).toBe("ok");
    expect(internalsOf(client).activeToolCallAbortController).toBeUndefined();
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("throws AuthRecoveryRequiredError with emaStepUpConfirm for a step_up_confirm outcome", async () => {
    const client = makeClient();
    internalsOf(client).directAuthRecovery = true;
    internalsOf(client).directAuthRecoveryActive = true;
    const challenge = {
      reason: "insufficient_scope" as const,
      requiredScopes: ["weather:read"],
    };
    const operation = vi
      .fn()
      .mockRejectedValue(new AuthChallengeError(challenge, 403));
    vi.spyOn(client, "handleAuthChallenge").mockResolvedValue({
      kind: "step_up_confirm",
      challenge,
    });
    vi.spyOn(client, "dispatchTypedEvent").mockImplementation(() => {});

    await expect(
      internalsOf(client).withDirectAuthRecovery.call(client, operation),
    ).rejects.toMatchObject({
      name: "AuthRecoveryRequiredError",
      emaStepUpConfirm: true,
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("InspectorClient resumeAfterOAuth branches", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reattaches a remote session, pushes auth state, and reconnects when not connected", async () => {
    const client = makeClient();
    internalsOf(client).oauthManager = {
      handleAuthChallenge: vi.fn(),
      completeOAuthFlow: vi.fn().mockResolvedValue(undefined),
    };
    internalsOf(client).directAuthRecovery = false;
    internalsOf(client).directAuthRecoveryActive = null;
    internalsOf(client).status = "disconnected";

    const transport = Object.create(
      RemoteClientTransport.prototype,
    ) as RemoteClientTransport;
    const attachToSession = vi.fn().mockResolvedValue(undefined);
    const pushAuthState = vi.fn().mockResolvedValue(undefined);
    (transport as unknown as { attachToSession: unknown }).attachToSession =
      attachToSession;
    (transport as unknown as { pushAuthState: unknown }).pushAuthState =
      pushAuthState;
    internalsOf(client).baseTransport = transport;

    const connectSpy = vi.spyOn(client, "connect").mockResolvedValue(undefined);

    await client.resumeAfterOAuth("auth-code", {
      remoteSessionId: "session-1",
    });

    expect(attachToSession).toHaveBeenCalledWith("session-1");
    expect(pushAuthState).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });
});
