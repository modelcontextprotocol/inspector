import { describe, it, expect, beforeEach } from "vitest";
import type { MessageEntry } from "@inspector/core/mcp/types";
import { MessageLogState } from "@inspector/core/mcp/state/messageLogState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function requestEntry(id: number, method = "tools/list"): MessageEntry {
  return {
    id: `req-${id}`,
    timestamp: new Date(2026, 4, 13, 0, 0, 0, id),
    direction: "request",
    message: { jsonrpc: "2.0", id, method, params: {} },
  };
}

function responseEntry(id: number): MessageEntry {
  return {
    id: `resp-${id}`,
    timestamp: new Date(2026, 4, 13, 0, 0, 0, id + 100),
    direction: "response",
    message: { jsonrpc: "2.0", id, result: {} },
  };
}

function notificationEntry(method = "notifications/ping"): MessageEntry {
  return {
    id: "notif-1",
    timestamp: new Date(2026, 4, 13, 0, 0, 1),
    direction: "notification",
    message: { jsonrpc: "2.0", method, params: {} },
  };
}

describe("MessageLogState", () => {
  let client: FakeInspectorClient;
  let state: MessageLogState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new MessageLogState(client);
  });

  it("starts empty and returns defensive copies", () => {
    expect(state.getMessages()).toEqual([]);
    expect(state.getMessages()).not.toBe(state.getMessages());
  });

  it("appends a request entry and dispatches message + messagesChange", () => {
    const seenSingle: MessageEntry[] = [];
    const seenFull: MessageEntry[][] = [];
    state.addEventListener("message", (e) => seenSingle.push(e.detail));
    state.addEventListener("messagesChange", (e) => seenFull.push(e.detail));

    client.dispatchTypedEvent("message", requestEntry(1));
    expect(seenSingle).toHaveLength(1);
    expect(seenFull).toHaveLength(1);
    expect(state.getMessages()).toHaveLength(1);
  });

  it("matches a response to its pending request and updates duration", () => {
    client.dispatchTypedEvent("message", requestEntry(1));
    const seen: MessageEntry[][] = [];
    state.addEventListener("messagesChange", (e) => seen.push(e.detail));

    client.dispatchTypedEvent("message", responseEntry(1));
    const merged = state.getMessages();
    expect(merged).toHaveLength(1);
    expect(merged[0]!.response).toBeDefined();
    expect(merged[0]!.duration).toBe(100);
  });

  it("appends an unmatched response when no pending request exists", () => {
    client.dispatchTypedEvent("message", responseEntry(99));
    expect(state.getMessages()).toHaveLength(1);
    expect(state.getMessages()[0]!.direction).toBe("response");
  });

  it("appends notification entries", () => {
    client.dispatchTypedEvent("message", notificationEntry());
    expect(state.getMessages()).toHaveLength(1);
    expect(state.getMessages()[0]!.direction).toBe("notification");
  });

  it("trims the oldest entries when maxMessages is exceeded", () => {
    const small = new MessageLogState(client, { maxMessages: 2 });
    client.dispatchTypedEvent("message", notificationEntry("a"));
    client.dispatchTypedEvent("message", notificationEntry("b"));
    client.dispatchTypedEvent("message", notificationEntry("c"));
    const seen = small
      .getMessages()
      .map((m) => (m.message as { method?: string }).method);
    expect(seen).toEqual(["b", "c"]);
  });

  it("does not trim when maxMessages is 0", () => {
    const big = new MessageLogState(client, { maxMessages: 0 });
    for (let i = 0; i < 5; i++) {
      client.dispatchTypedEvent("message", notificationEntry(`m${i}`));
    }
    expect(big.getMessages()).toHaveLength(5);
  });

  it("clearMessages with no predicate empties the list and dispatches", () => {
    client.dispatchTypedEvent("message", notificationEntry());
    let changeCount = 0;
    state.addEventListener("messagesChange", () => changeCount++);
    state.clearMessages();
    expect(state.getMessages()).toEqual([]);
    expect(changeCount).toBe(1);
  });

  it("clearMessages with a predicate filters and dispatches only when changed", () => {
    client.dispatchTypedEvent("message", notificationEntry("a"));
    client.dispatchTypedEvent("message", notificationEntry("b"));
    let changeCount = 0;
    state.addEventListener("messagesChange", () => changeCount++);

    state.clearMessages(
      (m) => (m.message as { method?: string }).method === "a",
    );
    expect(state.getMessages()).toHaveLength(1);
    expect(changeCount).toBe(1);

    state.clearMessages(
      (m) => (m.message as { method?: string }).method === "missing",
    );
    expect(changeCount).toBe(1);
  });

  it("clearMessages drops pending-request bookkeeping for evicted requests", () => {
    client.dispatchTypedEvent("message", requestEntry(1));
    state.clearMessages((m) => m.direction === "request");
    expect(state.getMessages()).toEqual([]);

    // The matching response should now fall through to the unmatched-response
    // branch (append) instead of mutating an unreachable pending entry.
    client.dispatchTypedEvent("message", responseEntry(1));
    expect(state.getMessages()).toHaveLength(1);
    expect(state.getMessages()[0]!.direction).toBe("response");
    expect(state.getMessages()[0]!.duration).toBeUndefined();
  });

  it("clearMessages without a predicate also drops all pending bookkeeping", () => {
    client.dispatchTypedEvent("message", requestEntry(1));
    state.clearMessages();
    client.dispatchTypedEvent("message", responseEntry(1));
    expect(state.getMessages()).toHaveLength(1);
    expect(state.getMessages()[0]!.direction).toBe("response");
  });

  it("getMessages applies the predicate filter", () => {
    client.dispatchTypedEvent("message", notificationEntry("keep"));
    client.dispatchTypedEvent("message", notificationEntry("drop"));
    const keep = state.getMessages(
      (m) => (m.message as { method?: string }).method === "keep",
    );
    expect(keep).toHaveLength(1);
  });

  it("clears on connect", () => {
    client.dispatchTypedEvent("message", notificationEntry());
    expect(state.getMessages()).toHaveLength(1);
    let dispatched = false;
    state.addEventListener("messagesChange", () => (dispatched = true));
    client.dispatchTypedEvent("connect");
    expect(state.getMessages()).toEqual([]);
    expect(dispatched).toBe(true);
  });

  it("clears on disconnect (statusChange -> disconnected)", () => {
    client.setStatus("connected");
    client.dispatchTypedEvent("message", notificationEntry());
    expect(state.getMessages()).toHaveLength(1);
    let dispatched = false;
    state.addEventListener("messagesChange", () => (dispatched = true));
    client.setStatus("disconnected");
    expect(state.getMessages()).toEqual([]);
    expect(dispatched).toBe(true);
  });

  it("does not clear on non-disconnected status changes", () => {
    client.dispatchTypedEvent("message", notificationEntry());
    client.setStatus("error");
    expect(state.getMessages()).toHaveLength(1);
  });

  it("destroy stops listening and clears state", () => {
    client.dispatchTypedEvent("message", notificationEntry());
    state.destroy();
    expect(state.getMessages()).toEqual([]);
    client.dispatchTypedEvent("message", notificationEntry());
    expect(state.getMessages()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
