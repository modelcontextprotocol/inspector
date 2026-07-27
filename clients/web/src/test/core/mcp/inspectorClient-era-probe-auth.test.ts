import { describe, it, expect } from "vitest";
import {
  AuthChallengeError,
  AuthRecoveryRequiredError,
} from "@inspector/core/auth/challenge.js";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";

/**
 * Connecting with `protocolEra: "auto" | "modern"` sends the SDK's
 * `server/discover` negotiation probe first, and the probe's classifier reports
 * whatever the transport threw as `SdkError(ERA_NEGOTIATION_FAILED)` with the
 * original error moved to `data.cause`. That buried the auth signals every
 * client's connect-error handling matches on, so an OAuth-protected server that
 * authorized fine on the legacy era produced a dead-end "Version negotiation
 * probe failed" instead of starting authorization (#1805).
 *
 * `connect()` unwraps the rejection, so these assert the *type* that reaches the
 * caller. The live counterpart (a real modern server answering 401) is
 * `src/test/integration/mcp/inspectorClient-modern-era-oauth.test.ts`.
 */
describe("InspectorClient connect() era-probe auth unwrapping (#1805)", () => {
  /**
   * Minimal transport whose `send` rejects — which is what the probe's
   * `server/discover` exchange hits. The remote path rejects with
   * `AuthRecoveryRequiredError` (after the backend intercepted the 401 and
   * `handleAuthChallenge` returned `interactive`); a direct transport with
   * challenge interception rejects with `AuthChallengeError`.
   */
  class RejectingTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    private readonly rejection: Error;

    // A parameter property would trip `erasableSyntaxOnly`.
    constructor(rejection: Error) {
      this.rejection = rejection;
    }

    async start(): Promise<void> {}

    async send(): Promise<void> {
      throw this.rejection;
    }

    async close(): Promise<void> {
      this.onclose?.();
    }
  }

  function makeClient(
    rejection: Error,
    era: "legacy" | "auto" | "modern",
  ): InspectorClient {
    return new InspectorClient(
      { type: "streamable-http", url: "https://mcp.example/mcp" },
      {
        environment: {
          transport: () => ({ transport: new RejectingTransport(rejection) }),
        },
        versionNegotiation: eraToVersionNegotiation(era),
      },
    );
  }

  const recoveryRequired = () =>
    new AuthRecoveryRequiredError(new URL("https://as.example/authorize"), {
      reason: "unauthorized",
    });

  for (const era of ["auto", "modern"] as const) {
    it(`surfaces AuthRecoveryRequiredError from the probe wrapper on the "${era}" era`, async () => {
      const rejection = recoveryRequired();
      const client = makeClient(rejection, era);

      await expect(client.connect()).rejects.toBe(rejection);
    });

    it(`surfaces AuthChallengeError from the probe wrapper on the "${era}" era`, async () => {
      const rejection = new AuthChallengeError(
        { reason: "token_expired" },
        401,
      );
      const client = makeClient(rejection, era);

      // The direct-recovery retry is off for this client, so the challenge
      // itself reaches the caller rather than a recovery outcome.
      await expect(client.connect()).rejects.toBe(rejection);
    });

    it(`leaves a non-auth probe failure untouched on the "${era}" era`, async () => {
      const client = makeClient(new Error("ECONNREFUSED"), era);

      // No auth error in the chain: the SDK's typed negotiation error stands, so
      // callers still report a plain connection failure.
      await expect(client.connect()).rejects.toThrow(
        /Version negotiation|ECONNREFUSED/,
      );
    });
  }

  it("passes an unwrapped legacy-era rejection through unchanged", async () => {
    // Legacy sends no probe, so nothing wraps the error — the baseline the
    // probing eras now match.
    const rejection = recoveryRequired();
    const client = makeClient(rejection, "legacy");

    await expect(client.connect()).rejects.toBe(rejection);
  });
});

describe("InspectorClient probesProtocolEra (#1805)", () => {
  function probesFor(
    versionNegotiation:
      | { mode?: "legacy" | "auto" | { pin: string } }
      | undefined,
  ): boolean {
    const client = new InspectorClient(
      { type: "streamable-http", url: "https://mcp.example/mcp" },
      {
        environment: { transport: () => ({}) as never },
        ...(versionNegotiation ? { versionNegotiation } : {}),
      },
    );
    return (
      client as unknown as { probesProtocolEra: () => boolean }
    ).probesProtocolEra();
  }

  it("is true for the probing eras and false for legacy", () => {
    expect(probesFor(eraToVersionNegotiation("auto"))).toBe(true);
    expect(probesFor(eraToVersionNegotiation("modern"))).toBe(true);
    expect(probesFor(eraToVersionNegotiation("legacy"))).toBe(false);
  });

  it("treats an absent mode and an absent option as legacy (the SDK default)", () => {
    expect(probesFor({})).toBe(false);
    expect(probesFor(undefined)).toBe(false);
  });
});
