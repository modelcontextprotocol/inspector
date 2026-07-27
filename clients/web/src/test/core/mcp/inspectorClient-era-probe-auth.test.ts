import { describe, it, expect, vi } from "vitest";
import {
  AuthChallengeError,
  AuthRecoveryRequiredError,
} from "@inspector/core/auth/challenge.js";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import type { CreateTransportOptions } from "@inspector/core/mcp/types.js";
import { BrowserOAuthStorage } from "@inspector/core/auth/browser/storage.js";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";

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

      // No auth error in the chain, so nothing is unwrapped: whatever the SDK
      // produced reaches the caller as a plain connection failure. Pin that it
      // is *not* an auth error rather than matching a message alternation
      // (which would pass on either branch and assert nothing) — "auto" falls
      // back to the legacy handshake and rejects with the raw error, while
      // "modern" pins and rejects with the wrapped negotiation error.
      const error = await client.connect().then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AuthChallengeError);
      expect(error).not.toBeInstanceOf(AuthRecoveryRequiredError);
      expect((error as Error).message).toMatch(
        era === "auto" ? /ECONNREFUSED/ : /Version negotiation/,
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

/**
 * The workaround half of #1805: with no stored tokens there is no authProvider,
 * so the direct path only intercepts the probe's 401 — turning it into a typed
 * `AuthChallengeError` that survives as `data.cause` — when the era actually
 * probes. Asserted through the transport options the factory receives (the
 * load-bearing effect) rather than the private predicate behind it.
 */
describe("InspectorClient era-scoped interceptAuthChallenges (#1805)", () => {
  async function interceptFlagFor(
    versionNegotiation:
      | { mode?: "legacy" | "auto" | { pin: string } }
      | undefined,
  ): Promise<boolean | undefined> {
    let seen: CreateTransportOptions | undefined;
    const client = new InspectorClient(
      { type: "streamable-http", url: "https://mcp.example/mcp" },
      {
        environment: {
          transport: (_config, options) => {
            seen = options;
            return {
              transport: new RejectingTransport(new Error("ECONNREFUSED")),
            };
          },
          // Real but empty storage (sessionStorage under happy-dom) plus the
          // other two components an OAuthManager requires. No stored tokens, so
          // `isOAuthAuthorized()` is false and no authProvider is attached —
          // the case this clause exists for.
          oauth: {
            storage: new BrowserOAuthStorage(),
            navigation: { navigateToAuthorization: vi.fn() },
            redirectUrlProvider: {
              getRedirectUrl: () => "http://localhost/callback",
            },
          },
        },
        oauth: { clientId: "era-probe-test" },
        directAuthRecovery: true,
        ...(versionNegotiation ? { versionNegotiation } : {}),
      },
    );

    await client.connect().catch(() => {});
    return seen?.interceptAuthChallenges;
  }

  it("is enabled for the probing eras and left off for legacy", async () => {
    expect(await interceptFlagFor(eraToVersionNegotiation("auto"))).toBe(true);
    expect(await interceptFlagFor(eraToVersionNegotiation("modern"))).toBe(
      true,
    );
    expect(
      await interceptFlagFor(eraToVersionNegotiation("legacy")),
    ).toBeFalsy();
  });

  it("treats an absent mode and an absent option as legacy (the SDK default)", async () => {
    expect(await interceptFlagFor({})).toBeFalsy();
    expect(await interceptFlagFor(undefined)).toBeFalsy();
  });
});
