/**
 * Unit-level tests for RemoteSession's event queue + transport-death wiring.
 *
 * Lives under integration/ because RemoteSession imports SDK types that
 * pull in node-only modules at runtime; the file is otherwise pure (no I/O,
 * no network) so the integration runner is comfortable for it.
 */

import { describe, it, expect, vi } from "vitest";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { RemoteSession } from "@inspector/core/mcp/remote/node/remote-session.js";
import type { FetchRequestEntryBase } from "@inspector/core/mcp/types.js";
import { AuthChallengeError } from "@inspector/core/auth/challenge.js";

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
