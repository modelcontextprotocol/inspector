import { describe, it, expect, vi } from "vitest";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { MessageTrackingTransport } from "@inspector/core/mcp/messageTrackingTransport.js";

/** Minimal in-memory Transport so we can drive send()/onmessage directly. */
class FakeTransport implements Transport {
  sent: JSONRPCMessage[] = [];
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
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
