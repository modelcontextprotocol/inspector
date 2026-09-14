/**
 * Unit-level tests for RemoteSession's event queue + transport-death wiring.
 *
 * Lives under integration/ because RemoteSession imports SDK types that
 * pull in node-only modules at runtime; the file is otherwise pure (no I/O,
 * no network) so the integration runner is comfortable for it.
 */

import { describe, it, expect, vi } from "vitest";
import type { Transport, JSONRPCMessage } from "@modelcontextprotocol/client";
import { RemoteSession } from "@inspector/core/mcp/remote/node/remote-session.js";
import type { FetchRequestEntryBase } from "@inspector/core/mcp/types.js";
import { AuthChallengeError } from "@inspector/core/auth/challenge.js";

// Stage a deliberately off-spec message as `unknown` and narrow with a single
// cast — the guard branches these fixtures exercise are ones the typed
// `JSONRPCMessage` shape forbids, and `unknown` is the safe top type to pass in.
const asMsg = (m: unknown): JSONRPCMessage => m as JSONRPCMessage;

function makeFetchEntry(
  overrides: Partial<FetchRequestEntryBase> = {},
): FetchRequestEntryBase {
  return {
    id: "req-1",
    timestamp: new Date("2026-01-01T00:00:00Z"),
    method: "GET",
    url: "http://example.com/",
    requestHeaders: {},
    ...overrides,
  };
}

/** A structurally valid `Transport`, so a fixture needs no cast. */
function makeTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    start: async () => {},
    send: async () => {},
    close: async () => {},
    ...overrides,
  };
}

describe("RemoteSession", () => {
  it("queues events before a consumer attaches and drains them on attach", () => {
    const session = new RemoteSession("s1");
    session.onStderr({ timestamp: new Date(), message: "line one" });
    session.onStderr({ timestamp: new Date(), message: "line two" });

    const received: { type: string }[] = [];
    session.setEventConsumer((event) => {
      received.push({ type: event.type });
    });

    expect(received.map((e) => e.type)).toEqual(["stdio_log", "stdio_log"]);
  });

  it("queues the transport_error event when markTransportDead fires before a consumer attaches", () => {
    // Regression: the previous behavior dropped the event when no consumer
    // was attached, so a process that crashed during startup vanished into
    // a bare "Session not found" 404 on the next /api/mcp/events poll.
    const session = new RemoteSession("s2");
    session.onStderr({
      timestamp: new Date(),
      message: "Error: Cannot find module 'bogus.js'",
    });
    session.markTransportDead("Transport closed - process may have exited");

    const received: { type: string; data: unknown }[] = [];
    session.setEventConsumer((event) => {
      received.push({ type: event.type, data: event.data });
    });

    expect(received.map((e) => e.type)).toEqual([
      "stdio_log",
      "transport_error",
    ]);
    const err = received[1]?.data as { error: string; code: number };
    expect(err.error).toMatch(/Transport closed/);
    expect(err.code).toBe(-32000);
  });

  it("delivers transport_error live when a consumer is already attached", () => {
    const session = new RemoteSession("s3");
    const received: { type: string }[] = [];
    session.setEventConsumer((event) => {
      received.push({ type: event.type });
    });
    session.markTransportDead("transport closed");
    expect(received.map((e) => e.type)).toEqual(["transport_error"]);
  });

  it("isTransportDead + getTransportError reflect the marked state", () => {
    const session = new RemoteSession("s4");
    expect(session.isTransportDead()).toBe(false);
    expect(session.getTransportError()).toBeNull();
    session.markTransportDead("boom");
    expect(session.isTransportDead()).toBe(true);
    expect(session.getTransportError()).toBe("boom");
  });

  it("clearEventConsumer signals cleanup-needed when the transport is dead", () => {
    const session = new RemoteSession("s5");
    session.setEventConsumer(() => {});
    expect(session.clearEventConsumer()).toBe(false);
    session.setEventConsumer(() => {});
    session.markTransportDead("boom");
    expect(session.clearEventConsumer()).toBe(true);
  });

  it("flushes a non-empty queue in order on consumer attach", () => {
    const session = new RemoteSession("s6");
    session.onStderr({ timestamp: new Date(), message: "first" });
    session.onMessage({ jsonrpc: "2.0", id: 1, method: "ping" });
    session.onFetchResponseBody("req-1", "body");
    const received: string[] = [];
    session.setEventConsumer((event) => received.push(event.type));
    expect(received).toEqual([
      "stdio_log",
      "message",
      "fetch_request_body_update",
    ]);
  });

  it("setEventConsumer with an empty queue flushes nothing", () => {
    const session = new RemoteSession("s7");
    const consumer = vi.fn();
    session.setEventConsumer(consumer);
    expect(consumer).not.toHaveBeenCalled();
  });

  it("setTransport stores the transport", () => {
    const session = new RemoteSession("s8");
    const transport = { foo: "bar" } as unknown as Transport;
    session.setTransport(transport);
    expect(session.transport).toBe(transport);
  });

  // #1935: the browser's Client negotiates the version, so the backend has to
  // be told before it can stamp `Mcp-Protocol-Version` on upstream requests.
  it("applyProtocolVersion forwards a new version to the transport once", () => {
    const session = new RemoteSession("s8a");
    const setProtocolVersion = vi.fn();
    session.setTransport(makeTransport({ setProtocolVersion }));

    session.applyProtocolVersion("2025-11-25");
    session.applyProtocolVersion("2025-11-25");
    expect(setProtocolVersion.mock.calls).toEqual([["2025-11-25"]]);

    // A renegotiated version (e.g. after a reconnect) is re-applied.
    session.applyProtocolVersion("2026-07-28");
    expect(setProtocolVersion).toHaveBeenLastCalledWith("2026-07-28");
  });

  it("applyProtocolVersion ignores an absent, non-token, or non-string version", () => {
    const session = new RemoteSession("s8b");
    const setProtocolVersion = vi.fn();
    session.setTransport(makeTransport({ setProtocolVersion }));

    session.applyProtocolVersion(undefined);
    // Header injection attempt — must never reach the upstream transport.
    session.applyProtocolVersion("2025-11-25\r\nX-Evil: 1");
    session.applyProtocolVersion("");
    // The value arrives from an unvalidated JSON body, so a non-string must be
    // rejected on its type — `RegExp.test` would coerce these into a match.
    session.applyProtocolVersion(123);
    session.applyProtocolVersion(true);
    session.applyProtocolVersion(null);
    expect(setProtocolVersion).not.toHaveBeenCalled();
  });

  it("applyProtocolVersion is a no-op on a transport without setProtocolVersion (stdio)", () => {
    const session = new RemoteSession("s8c");
    session.setTransport(makeTransport());
    expect(() => session.applyProtocolVersion("2025-11-25")).not.toThrow();
  });

  it("hasEventConsumer reflects whether a consumer is attached", () => {
    const session = new RemoteSession("s9");
    expect(session.hasEventConsumer()).toBe(false);
    session.setEventConsumer(() => {});
    expect(session.hasEventConsumer()).toBe(true);
  });

  it("delivers events live to an attached consumer (pushEvent direct path)", () => {
    const session = new RemoteSession("s10");
    const received: { type: string; data: unknown }[] = [];
    session.setEventConsumer((event) =>
      received.push({ type: event.type, data: event.data }),
    );
    session.onMessage({ jsonrpc: "2.0", id: 1, result: {} });
    session.onFetchResponseBody("req-1", "the-body");
    expect(received.map((e) => e.type)).toEqual([
      "message",
      "fetch_request_body_update",
    ]);
    expect(received[1]?.data).toEqual({
      id: "req-1",
      responseBody: "the-body",
    });
  });

  it("onFetchRequest serializes a Date timestamp to an ISO string", () => {
    const session = new RemoteSession("s11");
    const received: { type: string; data: unknown }[] = [];
    session.setEventConsumer((event) =>
      received.push({ type: event.type, data: event.data }),
    );
    session.onFetchRequest(
      makeFetchEntry({ timestamp: new Date("2026-01-01T00:00:00Z") }),
    );
    expect(received[0]?.type).toBe("fetch_request");
    expect((received[0]?.data as { timestamp: string }).timestamp).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("onFetchRequest leaves a non-Date timestamp untouched", () => {
    const session = new RemoteSession("s12");
    const received: { data: unknown }[] = [];
    session.setEventConsumer((event) => received.push({ data: event.data }));
    // A pre-serialized (string) timestamp exercises the ternary's else branch.
    session.onFetchRequest(
      makeFetchEntry({
        timestamp: "2026-01-01T00:00:00.000Z" as unknown as Date,
      }),
    );
    expect((received[0]?.data as { timestamp: string }).timestamp).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("waitForRequestResponse resolves when a matching JSON-RPC response arrives", async () => {
    const session = new RemoteSession("s-wait");
    const wait = session.waitForRequestResponse(42);
    session.onMessage({ jsonrpc: "2.0", id: 42, result: { tools: [] } });
    await expect(wait).resolves.toBeUndefined();
  });

  it("a matching progress notification re-arms the wait past its original deadline (#2028)", async () => {
    vi.useFakeTimers();
    const session = new RemoteSession("s-progress-reset");
    const wait = session.waitForRequestResponse(5, 1000);
    // Almost at the deadline, then a progress note for this request arrives.
    await vi.advanceTimersByTimeAsync(900);
    session.onMessage({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progressToken: 5, progress: 1, total: 10 },
    });
    // Past the *original* 1000ms deadline: without the re-arm this would have
    // already rejected, and the resolve below would be a no-op on a dead wait.
    await vi.advanceTimersByTimeAsync(900);
    session.onMessage({ jsonrpc: "2.0", id: 5, result: {} });
    await expect(wait).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("a notifications/message does NOT re-arm the wait (log messages don't extend the deadline, #2028)", async () => {
    vi.useFakeTimers();
    const session = new RemoteSession("s-message-no-reset");
    const wait = session.waitForRequestResponse(6, 1000);
    const rejection = expect(wait).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(500);
    session.onMessage({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "info", data: { msg: "tick" } },
    });
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    vi.useRealTimers();
  });

  it("noteRequestProgress is a no-op for an id with no pending wait", () => {
    const session = new RemoteSession("s-progress-noop");
    expect(() => session.noteRequestProgress(999)).not.toThrow();
  });

  it("a progress notification on a timeoutMs=0 wait leaves it timerless and it still resolves", async () => {
    const session = new RemoteSession("s-progress-notimer");
    const wait = session.waitForRequestResponse(7, 0);
    session.onMessage({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progressToken: 7, progress: 1 },
    });
    session.onMessage({ jsonrpc: "2.0", id: 7, result: {} });
    await expect(wait).resolves.toBeUndefined();
  });

  it("a progress notification with a non-token progressToken re-arms nothing", async () => {
    vi.useFakeTimers();
    const session = new RemoteSession("s-progress-bad-token");
    const wait = session.waitForRequestResponse(8, 1000);
    const rejection = expect(wait).rejects.toThrow(/timed out/);
    // A malformed token (object) must be ignored, not coerced to a key.
    session.onMessage(
      asMsg({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: { bad: true }, progress: 1 },
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    vi.useRealTimers();
  });

  it("endSend is a no-op when no send is active", () => {
    const session = new RemoteSession("s-endsend-noop");
    expect(session.hasActiveSend()).toBe(false);
    // No matching beginSend() — activeSendCount is already 0.
    session.endSend();
    expect(session.hasActiveSend()).toBe(false);
  });

  it("waitForRequestResponse with timeoutMs=0 never schedules a timer and still resolves", async () => {
    const session = new RemoteSession("s-no-timeout");
    const wait = session.waitForRequestResponse(7, 0);
    session.onMessage({ jsonrpc: "2.0", id: 7, result: {} });
    await expect(wait).resolves.toBeUndefined();
  });

  it("cancelRequestWait rejects a timeoutMs=0 wait without a timer to clear", async () => {
    const session = new RemoteSession("s-no-timeout-cancel");
    const wait = session.waitForRequestResponse(8, 0);
    const rejection = expect(wait).rejects.toThrow(/cancelled/);
    session.cancelRequestWait(8);
    await rejection;
  });

  it("handleTransportAuthError rejects active request waits during send", async () => {
    const session = new RemoteSession("s-auth");
    session.beginSend();
    const wait = session.waitForRequestResponse(1);
    const err = new AuthChallengeError({ reason: "token_expired" }, 401);
    expect(session.handleTransportAuthError(err)).toBe(true);
    await expect(wait).rejects.toBe(err);
    session.endSend();
  });

  it("handleTransportAuthError pushes ambient auth when no send is active", () => {
    const session = new RemoteSession("s-ambient");
    const received: unknown[] = [];
    session.setEventConsumer((event) => {
      if (event.type === "auth_challenge") received.push(event.data);
    });
    const err = new AuthChallengeError({ reason: "token_expired" }, 401);
    expect(session.handleTransportAuthError(err)).toBe(true);
    expect(received).toHaveLength(1);
  });

  it("does not push SSE auth while a send is active (command path owns delivery)", () => {
    const session = new RemoteSession("s-active");
    const received: unknown[] = [];
    session.setEventConsumer((event) => {
      if (event.type === "auth_challenge") received.push(event.data);
    });
    const err = new AuthChallengeError({ reason: "token_expired" }, 401);
    session.beginSend();
    expect(session.handleTransportAuthError(err)).toBe(true);
    expect(received).toHaveLength(0);
    session.endSend();
  });

  it("does not duplicate on SSE until the HTTP echo suppress window expires", () => {
    vi.useFakeTimers();
    const session = new RemoteSession("s-echo");
    const received: unknown[] = [];
    session.setEventConsumer((event) => {
      if (event.type === "auth_challenge") received.push(event.data);
    });
    const err = new AuthChallengeError({ reason: "token_expired" }, 401);
    session.beginSend();
    session.noteAuthChallengeDeliveredViaHttp();
    session.endSend();
    expect(session.handleTransportAuthError(err)).toBe(true);
    expect(received).toHaveLength(0);
    expect(session.handleTransportAuthError(err)).toBe(true);
    expect(received).toHaveLength(0);
    session.beginSend();
    session.endSend();
    expect(session.handleTransportAuthError(err)).toBe(true);
    expect(received).toHaveLength(0);
    vi.advanceTimersByTime(RemoteSession.AUTH_HTTP_ECHO_SUPPRESS_MS + 1);
    expect(session.handleTransportAuthError(err)).toBe(true);
    expect(received).toHaveLength(1);
    vi.useRealTimers();
  });

  it("does not clear HTTP auth suppression when a concurrent send starts", () => {
    const session = new RemoteSession("s-concurrent");
    const received: unknown[] = [];
    session.setEventConsumer((event) => {
      if (event.type === "auth_challenge") received.push(event.data);
    });
    const err = new AuthChallengeError({ reason: "token_expired" }, 401);
    session.beginSend();
    session.noteAuthChallengeDeliveredViaHttp();
    session.endSend();
    session.beginSend();
    expect(session.handleTransportAuthError(err)).toBe(true);
    expect(received).toHaveLength(0);
    session.endSend();
  });

  it("waitForRequestResponse rejects after timeout", async () => {
    vi.useFakeTimers();
    const session = new RemoteSession("s-timeout");
    const wait = session.waitForRequestResponse(99, 1000);
    const rejection = expect(wait).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    vi.useRealTimers();
  });

  it("cancelRequestWait clears the timeout for a pending wait", async () => {
    vi.useFakeTimers();
    const session = new RemoteSession("s-cancel");
    const wait = session.waitForRequestResponse(42, 5000);
    const rejection = expect(wait).rejects.toThrow(/cancelled/);
    session.cancelRequestWait(42);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();
  });

  it("setAuthState throws when no auth provider handle is set", () => {
    const session = new RemoteSession("no-auth-provider");
    expect(() =>
      session.setAuthState({
        oauthTokens: { access_token: "x", token_type: "Bearer" },
      }),
    ).toThrow(/Session has no OAuth auth provider/);
  });

  it("cancelRequestWait is a no-op when the requestId has no pending wait", () => {
    const session = new RemoteSession("s-cancel-noop");
    // No wait was ever registered for this id — should not throw.
    expect(() => session.cancelRequestWait(123)).not.toThrow();
  });

  it("handleTransportAuthError returns false for a non-AuthChallengeError", () => {
    const session = new RemoteSession("s-not-auth-error");
    expect(session.handleTransportAuthError(new Error("plain error"))).toBe(
      false,
    );
  });

  it("setAuthState updates the session auth provider", async () => {
    const { createRemoteAuthProvider } =
      await import("@inspector/core/mcp/remote/node/tokenAuthProvider.js");
    const handle = createRemoteAuthProvider({
      oauthTokens: { access_token: "old", token_type: "Bearer" },
    })!;
    const session = new RemoteSession("auth-state");
    session.setAuthProviderHandle(handle);
    session.setAuthState({
      oauthTokens: { access_token: "new", token_type: "Bearer" },
    });
    await expect(handle.provider.tokens()).resolves.toEqual({
      access_token: "new",
      token_type: "Bearer",
    });
  });
});
