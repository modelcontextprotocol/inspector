import { describe, it, expect, vi } from "vitest";
import { wireElicitationBridge } from "../src/daemon/elicitation-bridge.js";
import type { ElicitationChannel } from "../src/daemon/ipc-glue.js";
import type { ElicitationResponseFrame } from "../src/daemon/protocol.js";
import type { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";

/**
 * Covers `wireElicitationBridge`'s event routing: origin filtering
 * (task-input-required elicitations are left for a future tasks/-based
 * command, not answered here), URL vs form mode frame shaping, and the
 * channel-failure fallback to `cancel()` (since some construction sites,
 * notably legacy URL-mode, never wire a reject callback).
 */
function fakeClient(): {
  client: InspectorClient;
  emit: (detail: unknown) => void;
} {
  const target = new EventTarget();
  const client = {
    addEventListener: (type: string, listener: EventListener) =>
      target.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListener) =>
      target.removeEventListener(type, listener),
  } as unknown as InspectorClient;
  return {
    client,
    emit: (detail: unknown) =>
      target.dispatchEvent(
        new CustomEvent("newPendingElicitation", { detail }),
      ),
  };
}

function fakeMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "elicitation-x",
    origin: "server-request",
    request: { method: "elicitation/create", params: { message: "hi" } },
    respond: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    reject: vi.fn(),
    ...overrides,
  };
}

describe("wireElicitationBridge", () => {
  it("skips task-input-required origin elicitations entirely", () => {
    const { client, emit } = fakeClient();
    const channel: ElicitationChannel = { request: vi.fn() };
    const unwire = wireElicitationBridge(client, channel, "req-1");
    const message = fakeMessage({ origin: "task-input-required" });
    emit(message);
    expect(channel.request).not.toHaveBeenCalled();
    expect(message.respond).not.toHaveBeenCalled();
    unwire();
  });

  it("builds a url-mode frame and responds with the channel's answer", async () => {
    const { client, emit } = fakeClient();
    const answer: ElicitationResponseFrame = {
      id: "req-1",
      kind: "elicitation-response",
      elicitationId: "elicitation-x",
      action: "accept",
    };
    const request = vi.fn().mockResolvedValue(answer);
    const channel: ElicitationChannel = { request };
    const unwire = wireElicitationBridge(client, channel, "req-1");
    const message = fakeMessage({
      request: {
        method: "elicitation/create",
        params: { message: "Please visit", url: "https://example.com" },
      },
    });
    emit(message);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "elicitation-request",
        mode: "url",
        url: "https://example.com",
        elicitationId: "elicitation-x",
        origin: "server-request",
      }),
    );
    expect(message.respond).toHaveBeenCalledWith({
      action: "accept",
      content: undefined,
    });
    unwire();
  });

  it("builds a form-mode frame with requestedSchema", async () => {
    const { client, emit } = fakeClient();
    const answer: ElicitationResponseFrame = {
      id: "req-1",
      kind: "elicitation-response",
      elicitationId: "elicitation-x",
      action: "decline",
    };
    const request = vi.fn().mockResolvedValue(answer);
    const channel: ElicitationChannel = { request };
    const unwire = wireElicitationBridge(client, channel, "req-1");
    const message = fakeMessage({
      request: {
        method: "elicitation/create",
        params: {
          message: "Confirm?",
          requestedSchema: { type: "object", properties: {} },
        },
      },
    });
    emit(message);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "form",
        requestedSchema: { type: "object", properties: {} },
        url: undefined,
      }),
    );
    expect(message.respond).toHaveBeenCalledWith({
      action: "decline",
      content: undefined,
    });
    unwire();
  });

  it("cancels the pending elicitation when the channel rejects", async () => {
    const { client, emit } = fakeClient();
    const request = vi.fn().mockRejectedValue(new Error("disconnected"));
    const channel: ElicitationChannel = { request };
    const unwire = wireElicitationBridge(client, channel, "req-1");
    const message = fakeMessage();
    emit(message);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(message.cancel).toHaveBeenCalled();
    expect(message.respond).not.toHaveBeenCalled();
    unwire();
  });

  it("processes multiple elicitations in arrival order (serialized)", async () => {
    const { client, emit } = fakeClient();
    const order: string[] = [];
    const request = vi.fn().mockImplementation(async (frame) => {
      order.push(`start:${frame.elicitationId}`);
      await Promise.resolve();
      order.push(`end:${frame.elicitationId}`);
      return {
        id: frame.id,
        kind: "elicitation-response",
        elicitationId: frame.elicitationId,
        action: "cancel",
      } satisfies ElicitationResponseFrame;
    });
    const channel: ElicitationChannel = { request };
    const unwire = wireElicitationBridge(client, channel, "req-1");
    emit(fakeMessage({ id: "e1" }));
    emit(fakeMessage({ id: "e2" }));
    await vi.waitFor(() => {
      expect(order).toEqual(["start:e1", "end:e1", "start:e2", "end:e2"]);
    });

    unwire();
  });

  it("delivers each elicitation to exactly one of two concurrent callers (oldest first)", async () => {
    const { client, emit } = fakeClient();
    const answerFor = (frame: {
      id: string;
      elicitationId: string;
    }): ElicitationResponseFrame => ({
      id: frame.id,
      kind: "elicitation-response",
      elicitationId: frame.elicitationId,
      action: "cancel",
    });
    const requestA = vi
      .fn()
      .mockImplementation(async (frame) => answerFor(frame));
    const requestB = vi
      .fn()
      .mockImplementation(async (frame) => answerFor(frame));
    const unwireA = wireElicitationBridge(
      client,
      { request: requestA },
      "req-a",
    );
    const unwireB = wireElicitationBridge(
      client,
      { request: requestB },
      "req-b",
    );

    const first = fakeMessage({ id: "e1" });
    emit(first);
    await vi.waitFor(() => expect(first.respond).toHaveBeenCalled());
    expect(requestA).toHaveBeenCalledTimes(1);
    expect(requestB).not.toHaveBeenCalled();
    expect(first.respond).toHaveBeenCalledTimes(1);

    // Once the oldest caller settles, the next event goes to the survivor.
    unwireA();
    const second = fakeMessage({ id: "e2" });
    emit(second);
    await vi.waitFor(() => expect(second.respond).toHaveBeenCalled());
    expect(requestA).toHaveBeenCalledTimes(1);
    expect(requestB).toHaveBeenCalledTimes(1);
    unwireB();
  });

  it("cancels an event already queued when every caller settled before dispatch", async () => {
    const { client, emit } = fakeClient();
    const request = vi.fn();
    const unwire = wireElicitationBridge(client, { request }, "req-1");
    const message = fakeMessage();
    emit(message);
    unwire(); // settle before the queued microtask dispatches
    await vi.waitFor(() => expect(message.cancel).toHaveBeenCalled());
    expect(request).not.toHaveBeenCalled();
    expect(message.respond).not.toHaveBeenCalled();
  });

  it("unwire stops the listener from reacting to further events", () => {
    const { client, emit } = fakeClient();
    const channel: ElicitationChannel = { request: vi.fn() };
    const unwire = wireElicitationBridge(client, channel, "req-1");
    unwire();
    emit(fakeMessage());
    expect(channel.request).not.toHaveBeenCalled();
  });
});
