import { describe, it, expect, vi } from "vitest";
import type { Transport } from "@modelcontextprotocol/client";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import { MessageTrackingTransport } from "@inspector/core/mcp/messageTrackingTransport.js";

/** Minimal in-memory Transport so we can drive send()/onmessage directly. */
class FakeTransport implements Transport {
  sent: JSONRPCMessage[] = [];
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  sessionId?: string;
  // Optional on the SDK Transport interface; stdio omits it, HTTP defines it.
  setProtocolVersion?: (version: string) => void;
  async start(): Promise<void> {}
  async send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
  }
  async close(): Promise<void> {}
}

function makeTracked() {
  const callbacks = {
    trackRequest: vi.fn(),
    trackResponse: vi.fn(),
    trackNotification: vi.fn(),
  };
  const base = new FakeTransport();
  const tracked = new MessageTrackingTransport(base, callbacks);
  return { callbacks, base, tracked };
}

describe("MessageTrackingTransport.send", () => {
  it("tracks an outgoing request", async () => {
    const { callbacks, tracked } = makeTracked();
    const request = { jsonrpc: "2.0", id: 1, method: "tools/list" } as const;
    await tracked.send(request);
    expect(callbacks.trackRequest).toHaveBeenCalledWith(request, "client");
    expect(callbacks.trackResponse).not.toHaveBeenCalled();
  });

  it("tracks an outgoing response to a server→client request (roots/list)", async () => {
    const { callbacks, tracked } = makeTracked();
    // The client answering a server's roots/list request.
    const response = {
      jsonrpc: "2.0",
      id: 7,
      result: { roots: [{ uri: "file:///work", name: "work" }] },
    } as const;
    await tracked.send(response);
    expect(callbacks.trackResponse).toHaveBeenCalledWith(response, "client");
    expect(callbacks.trackRequest).not.toHaveBeenCalled();
  });

  it("tracks an outgoing error response", async () => {
    const { callbacks, tracked } = makeTracked();
    const errorResponse = {
      jsonrpc: "2.0",
      id: 8,
      error: { code: -32603, message: "boom" },
    } as const;
    await tracked.send(errorResponse);
    expect(callbacks.trackResponse).toHaveBeenCalledWith(
      errorResponse,
      "client",
    );
  });

  it("tracks an outgoing notification as a client notification", async () => {
    const { callbacks, tracked } = makeTracked();
    const notification = {
      jsonrpc: "2.0",
      method: "notifications/roots/list_changed",
    } as const;
    await tracked.send(notification);
    expect(callbacks.trackNotification).toHaveBeenCalledWith(
      notification,
      "client",
    );
    expect(callbacks.trackRequest).not.toHaveBeenCalled();
    expect(callbacks.trackResponse).not.toHaveBeenCalled();
  });

  it("forwards the message to the base transport", async () => {
    const { base, tracked } = makeTracked();
    const request = { jsonrpc: "2.0", id: 1, method: "ping" } as const;
    await tracked.send(request);
    expect(base.sent).toEqual([request]);
  });

  it("fires no callback for an id-bearing message with neither method/result/error", async () => {
    const { callbacks, base, tracked } = makeTracked();
    // An id present but no method, result, or error — none of the three
    // tracking callbacks should fire, yet the message still forwards.
    const malformed = { jsonrpc: "2.0", id: 5 } as unknown as JSONRPCMessage;
    await tracked.send(malformed);
    expect(callbacks.trackRequest).not.toHaveBeenCalled();
    expect(callbacks.trackResponse).not.toHaveBeenCalled();
    expect(callbacks.trackNotification).not.toHaveBeenCalled();
    expect(base.sent).toEqual([malformed]);
  });

  it("fires no callback for a message lacking both id and method", async () => {
    // No id and no method — the outer notification branch's `method in message`
    // check is false, so none of the callbacks fire.
    const { callbacks, base, tracked } = makeTracked();
    const bare = { jsonrpc: "2.0" } as unknown as JSONRPCMessage;
    await tracked.send(bare);
    expect(callbacks.trackRequest).not.toHaveBeenCalled();
    expect(callbacks.trackResponse).not.toHaveBeenCalled();
    expect(callbacks.trackNotification).not.toHaveBeenCalled();
    expect(base.sent).toEqual([bare]);
  });

  it("treats a null-id message as a notification (no id) path", async () => {
    const { callbacks, tracked } = makeTracked();
    const nullId = {
      jsonrpc: "2.0",
      id: null,
      method: "notifications/ping",
    } as unknown as JSONRPCMessage;
    await tracked.send(nullId);
    expect(callbacks.trackNotification).toHaveBeenCalledWith(nullId, "client");
  });

  it("does not throw when tracking callbacks are all undefined", async () => {
    const base = new FakeTransport();
    const tracked = new MessageTrackingTransport(base, {});
    const request = { jsonrpc: "2.0", id: 1, method: "tools/list" } as const;
    const response = { jsonrpc: "2.0", id: 1, result: {} } as const;
    const notification = {
      jsonrpc: "2.0",
      method: "notifications/ping",
    } as const;
    await expect(tracked.send(request)).resolves.toBeUndefined();
    await expect(tracked.send(response)).resolves.toBeUndefined();
    await expect(tracked.send(notification)).resolves.toBeUndefined();
    expect(base.sent).toEqual([request, response, notification]);
  });
});

describe("MessageTrackingTransport.onmessage", () => {
  it("classifies incoming response / request / notification", () => {
    const { callbacks, base, tracked } = makeTracked();
    const handler = vi.fn();
    tracked.onmessage = handler;

    const response = { jsonrpc: "2.0", id: 1, result: {} } as const;
    const serverRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "roots/list",
    } as const;
    const notification = {
      jsonrpc: "2.0",
      method: "notifications/ping",
    } as const;

    base.onmessage?.(response);
    base.onmessage?.(serverRequest);
    base.onmessage?.(notification);

    expect(callbacks.trackResponse).toHaveBeenCalledWith(response, "server");
    expect(callbacks.trackRequest).toHaveBeenCalledWith(
      serverRequest,
      "server",
    );
    expect(callbacks.trackNotification).toHaveBeenCalledWith(
      notification,
      "server",
    );
    // The wrapped handler still receives every message.
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("fires no callback for an incoming id-bearing message with neither method/result/error", () => {
    const { callbacks, base, tracked } = makeTracked();
    const handler = vi.fn();
    tracked.onmessage = handler;
    const malformed = { jsonrpc: "2.0", id: 9 } as unknown as JSONRPCMessage;
    base.onmessage?.(malformed);
    expect(callbacks.trackRequest).not.toHaveBeenCalled();
    expect(callbacks.trackResponse).not.toHaveBeenCalled();
    expect(callbacks.trackNotification).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(malformed, undefined);
  });

  it("fires no callback for an incoming message lacking both id and method", () => {
    const { callbacks, base, tracked } = makeTracked();
    const handler = vi.fn();
    tracked.onmessage = handler;
    const bare = { jsonrpc: "2.0" } as unknown as JSONRPCMessage;
    base.onmessage?.(bare);
    expect(callbacks.trackRequest).not.toHaveBeenCalled();
    expect(callbacks.trackResponse).not.toHaveBeenCalled();
    expect(callbacks.trackNotification).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(bare, undefined);
  });

  it("exposes the wrapped handler via the onmessage getter", () => {
    const { tracked } = makeTracked();
    expect(tracked.onmessage).toBeUndefined();
    tracked.onmessage = vi.fn();
    expect(typeof tracked.onmessage).toBe("function");
  });

  it("clears the base transport onmessage when set to undefined", () => {
    const { base, tracked } = makeTracked();
    tracked.onmessage = vi.fn();
    expect(base.onmessage).toBeTypeOf("function");
    tracked.onmessage = undefined;
    expect(base.onmessage).toBeUndefined();
  });
});

describe("MessageTrackingTransport lifecycle + delegation", () => {
  it("delegates start() and close() to the base transport", async () => {
    const base = new FakeTransport();
    const startSpy = vi.spyOn(base, "start");
    const closeSpy = vi.spyOn(base, "close");
    const tracked = new MessageTrackingTransport(base, {});
    await tracked.start();
    await tracked.close();
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("proxies onclose / onerror getters and setters to the base transport", () => {
    const { base, tracked } = makeTracked();
    const onclose = vi.fn();
    const onerror = vi.fn();
    tracked.onclose = onclose;
    tracked.onerror = onerror;
    expect(base.onclose).toBe(onclose);
    expect(base.onerror).toBe(onerror);
    expect(tracked.onclose).toBe(onclose);
    expect(tracked.onerror).toBe(onerror);
  });

  it("exposes the base transport sessionId via the getter", () => {
    const { base, tracked } = makeTracked();
    expect(tracked.sessionId).toBeUndefined();
    base.sessionId = "session-123";
    expect(tracked.sessionId).toBe("session-123");
  });
});

describe("MessageTrackingTransport.setProtocolVersion", () => {
  it("captures the negotiated version and exposes it via protocolVersion", () => {
    const { tracked } = makeTracked();
    expect(tracked.protocolVersion).toBeUndefined();
    tracked.setProtocolVersion("2025-06-18");
    expect(tracked.protocolVersion).toBe("2025-06-18");
  });

  it("forwards to the base transport's setProtocolVersion when present", () => {
    const base = new FakeTransport();
    const baseSet = vi.fn();
    // stdio-style transports omit setProtocolVersion; HTTP transports define
    // it to stamp the version into later request headers — forward to those.
    base.setProtocolVersion = baseSet;
    const tracked = new MessageTrackingTransport(base, {});
    tracked.setProtocolVersion("2025-06-18");
    expect(baseSet).toHaveBeenCalledWith("2025-06-18");
    expect(tracked.protocolVersion).toBe("2025-06-18");
  });

  it("captures even when the base transport has no setProtocolVersion", () => {
    // FakeTransport (like stdio) has no setProtocolVersion — must not throw.
    const { tracked, base } = makeTracked();
    expect(base.setProtocolVersion).toBeUndefined();
    expect(() => tracked.setProtocolVersion("2025-06-18")).not.toThrow();
    expect(tracked.protocolVersion).toBe("2025-06-18");
  });
});
