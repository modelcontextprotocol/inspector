import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import { DispatchError } from "@modelcontextprotocol/ext-tasks/client";
import {
  RAW_WIRE_ID_PREFIX,
  RawWireChannel,
  type RawWireChannelHost,
} from "@inspector/core/extension/tasks/rawWireChannel.js";

type Sent = { id?: string | number; method: string; params?: unknown };

function setup(overrides: Partial<RawWireChannelHost> = {}) {
  const sent: Sent[] = [];
  const transport = {
    start: async () => {},
    close: async () => {},
    send: vi.fn(async (message: JSONRPCMessage) => {
      // The fields these tests read; every frame the channel sends has them.
      sent.push(message as Sent);
    }),
  } satisfies Transport;
  const channel = new RawWireChannel({
    transport: () => transport,
    defaultTimeoutMs: () => 1_000,
    resetTimeoutOnProgress: () => true,
    annotateTimeout: (error) => error,
    ...overrides,
  });
  return { channel, sent, transport };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RawWireChannel", () => {
  it("rejects without a transport, retryably", async () => {
    const { channel } = setup({ transport: () => null });
    await expect(channel.dispatch({ method: "tasks/get" })).rejects.toSatisfy(
      (error) => error instanceof DispatchError && error.retryable,
    );
  });

  it("rejects malformed requests before sending", async () => {
    const { channel, sent } = setup();
    await expect(channel.dispatch([])).rejects.toThrow(/JSON object/);
    await expect(channel.dispatch({ method: 1 })).rejects.toThrow(/method/);
    await expect(
      channel.dispatch({ method: "x", params: [1] }),
    ).rejects.toThrow(/params/);
    expect(sent).toHaveLength(0);
  });

  it("resolves the matching response and leaves foreign ids to the SDK", async () => {
    const { channel, sent } = setup();
    const promise = channel.dispatch({ method: "tasks/get", params: {} });
    await Promise.resolve();
    const id = String(sent[0]!.id);
    expect(id.startsWith(RAW_WIRE_ID_PREFIX)).toBe(true);
    expect(channel.consume({ jsonrpc: "2.0", id: 7, result: {} })).toBe(false);
    expect(
      channel.consume({ jsonrpc: "2.0", id: `${id}-other`, result: {} }),
    ).toBe(false);
    expect(channel.consume({ jsonrpc: "2.0", id, result: { ok: true } })).toBe(
      true,
    );
    await expect(promise).resolves.toEqual({
      kind: "result",
      result: { ok: true },
    });
  });

  it("returns error responses, dropping non-JSON data", async () => {
    const { channel, sent } = setup();
    const promise = channel.dispatch({ method: "tasks/get" });
    await Promise.resolve();
    channel.consume({
      jsonrpc: "2.0",
      id: String(sent[0]!.id),
      error: { code: -1, message: "no", data: Number.NaN },
    });
    await expect(promise).resolves.toEqual({
      kind: "error",
      error: { code: -1, message: "no" },
    });
  });

  it("rejects a non-JSON result", async () => {
    const { channel, sent } = setup();
    const promise = channel.dispatch({ method: "tasks/get" });
    await Promise.resolve();
    channel.consume({
      jsonrpc: "2.0",
      id: String(sent[0]!.id),
      result: { n: Number.POSITIVE_INFINITY },
    });
    await expect(promise).rejects.toThrow(/non-JSON result/);
  });

  it("times out with the annotated timeout as its cause, re-armed by progress", async () => {
    vi.useFakeTimers();
    const annotateTimeout = vi.fn((error: unknown) => error);
    const { channel, sent } = setup({ annotateTimeout });
    const promise = channel.dispatch({
      method: "tools/call",
      params: { _meta: { progressToken: "p" } },
    });
    let settled = false;
    promise.catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(800);
    channel.noteProgress("p");
    channel.noteProgress("other");
    await vi.advanceTimersByTimeAsync(800);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).rejects.toSatisfy(
      (error) =>
        error instanceof DispatchError &&
        (error.cause as { code?: unknown }).code !== undefined,
    );
    expect(annotateTimeout).toHaveBeenCalledWith(
      expect.anything(),
      "tools/call",
    );
    // stdio-style transport: the timeout reaches the server as a cancel.
    expect(sent[1]).toMatchObject({ method: "notifications/cancelled" });
  });

  it("honors an explicit timeout override", async () => {
    vi.useFakeTimers();
    const { channel } = setup();
    const promise = channel.dispatch({ method: "tasks/get" }, {}, 5);
    const assertion = expect(promise).rejects.toThrow(/after 5 ms/);
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
  });

  it("rejects an already-aborted signal without sending", async () => {
    const { channel, sent } = setup();
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    await expect(
      channel.dispatch({ method: "tasks/get" }, { signal: controller.signal }),
    ).rejects.toThrow("gone");
    expect(sent).toHaveLength(0);
  });

  it("cancels on the wire when the caller aborts", async () => {
    const { channel, sent } = setup();
    const controller = new AbortController();
    const promise = channel.dispatch(
      { method: "tools/call" },
      { signal: controller.signal },
    );
    await Promise.resolve();
    controller.abort("user");
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(sent[1]).toMatchObject({
      method: "notifications/cancelled",
      params: { reason: "user" },
    });
  });

  it("annotates a send failure and rejects everything on rejectAll", async () => {
    const boom = new Error("closed");
    const annotateTimeout = vi.fn(() => boom);
    const failing = setup({ annotateTimeout });
    failing.transport.send.mockRejectedValueOnce("raw failure");
    await expect(
      failing.channel.dispatch({ method: "tasks/get" }),
    ).rejects.toBe(boom);

    const { channel } = setup();
    const pending = channel.dispatch({ method: "tasks/get" });
    channel.rejectAll("Disconnected");
    await expect(pending).rejects.toThrow("Disconnected");
  });
});
