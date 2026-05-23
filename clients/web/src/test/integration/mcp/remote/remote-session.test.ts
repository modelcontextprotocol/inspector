/**
 * Unit-level tests for RemoteSession's event queue + transport-death wiring.
 *
 * Lives under integration/ because RemoteSession imports SDK types that
 * pull in node-only modules at runtime; the file is otherwise pure (no I/O,
 * no network) so the integration runner is comfortable for it.
 */

import { describe, it, expect } from "vitest";
import { RemoteSession } from "@inspector/core/mcp/remote/node/remote-session.js";

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
});
