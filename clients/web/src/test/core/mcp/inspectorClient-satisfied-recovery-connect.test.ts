import { describe, it, expect, vi } from "vitest";
import { AuthChallengeError } from "@inspector/core/auth/challenge.js";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { BrowserOAuthStorage } from "@inspector/core/auth/browser/storage.js";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";

/**
 * The three environment components an OAuthManager needs to exist. Storage is
 * real but empty (sessionStorage under happy-dom), so there are no tokens and
 * no authProvider is attached — the connect path this covers.
 */
function oauthEnvironment() {
  return {
    storage: new BrowserOAuthStorage(),
    navigation: { navigateToAuthorization: vi.fn() },
    redirectUrlProvider: {
      getRedirectUrl: () => "http://localhost/callback",
    },
  };
}

/**
 * A connect-time auth challenge that recovery satisfies *silently* (a refresh
 * token, say) must leave `connect()` resolved, not rejected.
 *
 * `connect()` builds its handshake promise once, outside the `runConnect`
 * closure that `withDirectAuthRecovery` retries. On a `satisfied` outcome
 * recovery calls `reconnectAfterAuthRecovery()`, which runs a complete nested
 * `connect()` — so by the time the retry leg runs, the client is connected and
 * the original promise is still rejected. Re-awaiting it rethrew that first
 * error and rejected a `connect()` whose client was in fact connected (found in
 * review of #1809; reachable on the legacy era before #1805 and on auto/modern
 * after it, since a probe 401 now arrives as a typed challenge).
 */
describe("InspectorClient connect() after a silently satisfied auth challenge", () => {
  /** Answers `initialize`, so a connect over it completes the handshake. */
  class HandshakingTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    async start(): Promise<void> {}
    async close(): Promise<void> {
      this.onclose?.();
    }

    async send(message: JSONRPCMessage): Promise<void> {
      if (
        "method" in message &&
        message.method === "initialize" &&
        "id" in message
      ) {
        const params = message.params as { protocolVersion: string };
        this.onmessage?.({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: params.protocolVersion,
            capabilities: {},
            serverInfo: { name: "recovered-server", version: "1.0.0" },
          },
        });
      }
    }
  }

  /** Rejects the handshake with the challenge recovery will satisfy. */
  class ChallengingTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    async start(): Promise<void> {}
    async close(): Promise<void> {
      this.onclose?.();
    }

    async send(): Promise<void> {
      throw new AuthChallengeError({ reason: "token_expired" }, 401);
    }
  }

  /** Rejects the handshake for a non-auth reason (no recovery re-entry). */
  class FailingTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    private readonly reason: string;

    // A parameter property would trip `erasableSyntaxOnly`.
    constructor(reason: string) {
      this.reason = reason;
    }

    async start(): Promise<void> {}
    async close(): Promise<void> {
      this.onclose?.();
    }

    async send(): Promise<void> {
      throw new Error(this.reason);
    }
  }

  it("resolves, reports connected, and dispatches exactly one connect event", async () => {
    let transportsCreated = 0;
    const client = new InspectorClient(
      { type: "streamable-http", url: "https://mcp.example/mcp" },
      {
        environment: {
          transport: () => {
            transportsCreated += 1;
            // First connect challenges; the reconnect underneath the satisfied
            // recovery gets a transport that completes the handshake.
            return {
              transport:
                transportsCreated === 1
                  ? new ChallengingTransport()
                  : new HandshakingTransport(),
            };
          },
          oauth: oauthEnvironment(),
        },
        oauth: { clientId: "satisfied-recovery-test" },
        directAuthRecovery: true,
      },
    );

    // Recovery succeeds without user interaction — the case that ends in the
    // retry leg rather than an AuthRecoveryRequiredError.
    vi.spyOn(client, "handleAuthChallenge").mockResolvedValue({
      kind: "satisfied",
    });

    let connectEvents = 0;
    client.addEventListener("connect", () => {
      connectEvents += 1;
    });
    let connectedStatusEvents = 0;
    client.addEventListener("statusChange", (event) => {
      if (event.detail === "connected") connectedStatusEvents += 1;
    });

    await expect(client.connect()).resolves.toBeUndefined();
    expect(client.getStatus()).toBe("connected");
    // The outer call skips fetchServerInfo(); this pins that the nested connect
    // populated it, i.e. the early return loses nothing.
    expect(client.getServerInfo()?.name).toBe("recovered-server");
    // The duplicate statusChange("connected") is suppressed with the duplicate
    // connect event.
    expect(connectedStatusEvents).toBe(1);
    expect(transportsCreated).toBe(2);
    // The nested connect() already ran the post-connect block; the outer call
    // must not run it a second time (a duplicate `connect` re-triggers every
    // list-state manager's refresh).
    expect(connectEvents).toBe(1);

    await client.disconnect();
  });

  it("still rejects when the reconnect underneath the recovery fails", async () => {
    // The short-circuit must not mask a failed re-handshake. The reconnect
    // fails for a *non-auth* reason, so recovery does not re-enter: the outer
    // connect() surfaces that error and lands on "error" (a second auth
    // challenge instead would be held by isConnectAuthRecoveryError, which is
    // the bounded chain the next test covers).
    let transportsCreated = 0;
    const client = new InspectorClient(
      { type: "streamable-http", url: "https://mcp.example/mcp" },
      {
        environment: {
          transport: () => {
            transportsCreated += 1;
            return {
              transport:
                transportsCreated === 1
                  ? new ChallengingTransport()
                  : new FailingTransport("handshake refused"),
            };
          },
          oauth: oauthEnvironment(),
        },
        oauth: { clientId: "satisfied-recovery-test" },
        directAuthRecovery: true,
      },
    );
    vi.spyOn(client, "handleAuthChallenge").mockResolvedValue({
      kind: "satisfied",
    });

    await expect(client.connect()).rejects.toThrow(/handshake refused/);
    expect(client.getStatus()).toBe("error");
  });

  it("reports the teardown, not the stale challenge, when the recovered session dies first", async () => {
    // The retry leg is reached only after the nested connect() completed, but
    // the session can die in between. Simulated deterministically: the nested
    // connect dispatches `connect` after setting "connected", so closing the
    // live transport from that listener flips the status before the retry leg
    // runs. It must report why the session died rather than rethrowing the
    // original 401 the recovery already dealt with.
    let transportsCreated = 0;
    let live: HandshakingTransport | undefined;
    const client = new InspectorClient(
      { type: "streamable-http", url: "https://mcp.example/mcp" },
      {
        environment: {
          transport: () => {
            transportsCreated += 1;
            if (transportsCreated === 1) {
              return { transport: new ChallengingTransport() };
            }
            live = new HandshakingTransport();
            return { transport: live };
          },
          oauth: oauthEnvironment(),
        },
        oauth: { clientId: "satisfied-recovery-test" },
        directAuthRecovery: true,
      },
    );
    vi.spyOn(client, "handleAuthChallenge").mockResolvedValue({
      kind: "satisfied",
    });
    client.addEventListener("connect", () => {
      live?.onclose?.();
    });

    await expect(client.connect()).rejects.toThrow(
      /Connection closed during authorization recovery/,
    );
    expect(client.getStatus()).not.toBe("connected");
  });

  it("bounds nested recoveries when refreshed credentials keep being rejected", async () => {
    // Every transport challenges and every challenge reports satisfied, so each
    // recovery reconnects into a fresh challenge. Recovery is counted across
    // the nesting boundary, so this terminates instead of recursing forever.
    let transportsCreated = 0;
    const client = new InspectorClient(
      { type: "streamable-http", url: "https://mcp.example/mcp" },
      {
        environment: {
          transport: () => {
            transportsCreated += 1;
            return { transport: new ChallengingTransport() };
          },
          oauth: oauthEnvironment(),
        },
        oauth: { clientId: "satisfied-recovery-test" },
        directAuthRecovery: true,
      },
    );
    vi.spyOn(client, "handleAuthChallenge").mockResolvedValue({
      kind: "satisfied",
    });

    await expect(client.connect()).rejects.toBeInstanceOf(AuthChallengeError);
    // One transport per connect attempt: the initial one plus the three
    // bounded nested recoveries (MAX_NESTED_AUTH_RECOVERIES), not an unbounded
    // chain.
    expect(transportsCreated).toBe(4);
  });
});
