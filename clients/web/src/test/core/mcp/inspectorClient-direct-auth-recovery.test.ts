import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthChallengeError } from "@inspector/core/auth/challenge.js";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";

describe("InspectorClient direct auth recovery retry bound", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("retries an operation once after satisfied recovery, then gives up", async () => {
    const client = Object.create(InspectorClient.prototype) as InspectorClient;
    const internals = client as unknown as {
      directAuthRecovery: boolean;
      directAuthRecoveryActive: boolean;
      reconnectAfterAuthRecovery: ReturnType<typeof vi.fn>;
      withDirectAuthRecovery: <T>(
        operation: () => Promise<T>,
        context?: { method?: string; toolName?: string },
        attempt?: number,
      ) => Promise<T>;
    };
    internals.directAuthRecovery = true;
    internals.directAuthRecoveryActive = true;
    internals.reconnectAfterAuthRecovery = vi.fn().mockResolvedValue(undefined);

    const challenge = {
      reason: "insufficient_scope" as const,
      requiredScopes: ["weather:read"],
    };
    const operation = vi
      .fn()
      .mockRejectedValue(new AuthChallengeError(challenge, 403));

    vi.spyOn(client, "handleAuthChallenge").mockResolvedValue({
      kind: "satisfied",
    });
    vi.spyOn(client, "dispatchTypedEvent").mockImplementation(() => {});

    await expect(
      internals.withDirectAuthRecovery.call(client, operation, {
        method: "tools/call",
        toolName: "get_temp",
      }),
    ).rejects.toBeInstanceOf(AuthChallengeError);

    expect(operation).toHaveBeenCalledTimes(2);
    expect(client.handleAuthChallenge).toHaveBeenCalledTimes(1);
    expect(internals.reconnectAfterAuthRecovery).toHaveBeenCalledTimes(1);
  });
});
