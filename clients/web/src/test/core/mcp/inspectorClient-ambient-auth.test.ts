import { describe, it, expect, vi, beforeEach } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { RemoteClientTransport } from "@inspector/core/mcp/remote/remoteClientTransport.js";

describe("InspectorClient ambient auth dedup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("joins concurrent handleAmbientAuthChallenge calls for the same challenge", async () => {
    const client = Object.create(InspectorClient.prototype) as InspectorClient;
    const handleAuthChallenge = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ kind: "satisfied" as const }), 20);
        }),
    );
    (client as unknown as { oauthManager: unknown }).oauthManager = {
      handleAuthChallenge,
    };
    (
      client as unknown as {
        ambientAuthChallengeInFlight: Map<string, Promise<void>>;
      }
    ).ambientAuthChallengeInFlight = new Map();
    (client as unknown as { baseTransport: unknown }).baseTransport =
      Object.create(RemoteClientTransport.prototype);
    vi.spyOn(client, "pushRemoteAuthState").mockResolvedValue(undefined);
    vi.spyOn(client, "dispatchTypedEvent").mockImplementation(() => {});

    const challenge = {
      reason: "token_expired" as const,
    };

    await Promise.all([
      client.handleAmbientAuthChallenge(challenge),
      client.handleAmbientAuthChallenge(challenge),
    ]);

    expect(handleAuthChallenge).toHaveBeenCalledTimes(1);
  });
});
