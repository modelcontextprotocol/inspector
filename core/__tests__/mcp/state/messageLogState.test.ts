/**
 * MessageLogState tests use a mock protocol that dispatches "message" and "statusChange"
 * to assert the manager's list and emitted events.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { MessageEntry } from "../../../mcp/types.js";
import { MessageLogState } from "../../../mcp/state/messageLogState.js";

/** Minimal protocol shape: dispatches "message", "statusChange", "connect"; getStatus(). */
class MockMessageProtocol extends EventTarget {
  private _status: "connected" | "disconnected" = "connected";

  getStatus(): "connected" | "disconnected" {
    return this._status;
  }

  dispatchMessage(entry: MessageEntry): void {
    this.dispatchEvent(new CustomEvent("message", { detail: entry }));
  }

  dispatchConnect(): void {
    this.dispatchEvent(new CustomEvent("connect"));
  }

  setDisconnected(): void {
    this._status = "disconnected";
    this.dispatchEvent(
      new CustomEvent("statusChange", { detail: "disconnected" }),
    );
  }
}

function createRequestEntry(id: string): MessageEntry {
  return {
    id: `req-${id}`,
    timestamp: new Date(),
    direction: "request",
    message: { jsonrpc: "2.0", id: 1, method: "test" },
  };
}

function createResponseEntry(messageId: number): MessageEntry {
  return {
    id: `res-${messageId}`,
    timestamp: new Date(),
    direction: "response",
    message: { jsonrpc: "2.0", id: messageId, result: {} },
  };
}

describe("MessageLogState", () => {
  let protocol: MockMessageProtocol;
  let state: MessageLogState | null = null;

  afterEach(() => {
    state?.destroy();
    state = null;
  });

  it("starts with empty messages", () => {
    protocol = new MockMessageProtocol();
    state = new MessageLogState(
      protocol as unknown as import("../../../mcp/inspectorClient.js").InspectorClient,
    );
    expect(state.getMessages()).toEqual([]);
  });

  it("on protocol message appends entry and dispatches message + messagesChange", () => {
    protocol = new MockMessageProtocol();
    state = new MessageLogState(
      protocol as unknown as import("../../../mcp/inspectorClient.js").InspectorClient,
    );
    const entry = createRequestEntry("1");

    const messageDetails: MessageEntry[] = [];
    const listDetails: MessageEntry[][] = [];
    state.addEventListener("message", (e) => messageDetails.push(e.detail));
    state.addEventListener("messagesChange", (e) => listDetails.push(e.detail));

    protocol.dispatchMessage(entry);

    expect(state.getMessages()).toHaveLength(1);
    expect(state.getMessages()[0]).toBe(entry);
    expect(messageDetails).toHaveLength(1);
    expect(messageDetails[0]).toBe(entry);
    expect(listDetails).toHaveLength(1);
    expect(listDetails[0]).toHaveLength(1);
  });

  it("when protocol dispatches request then response with same id, manager matches and does not duplicate, still emits events", () => {
    protocol = new MockMessageProtocol();
    state = new MessageLogState(
      protocol as unknown as import("../../../mcp/inspectorClient.js").InspectorClient,
    );
    const requestEntry = createRequestEntry("1");
    const responseEntry = createResponseEntry(1);

    const listDetails: MessageEntry[][] = [];
    state.addEventListener("messagesChange", (e) => listDetails.push(e.detail));

    protocol.dispatchMessage(requestEntry);
    protocol.dispatchMessage(responseEntry);

    expect(state.getMessages()).toHaveLength(1);
    expect(state.getMessages()[0].response).toEqual(responseEntry.message);
    expect(state.getMessages()[0].duration).toBeDefined();
    expect(listDetails).toHaveLength(2);
  });

  it("clearMessages() empties list and dispatches messagesChange", () => {
    protocol = new MockMessageProtocol();
    state = new MessageLogState(
      protocol as unknown as import("../../../mcp/inspectorClient.js").InspectorClient,
    );
    protocol.dispatchMessage(createRequestEntry("1"));
    expect(state.getMessages()).toHaveLength(1);

    const listDetails: MessageEntry[][] = [];
    state.addEventListener("messagesChange", (e) => listDetails.push(e.detail));
    state.clearMessages();

    expect(state.getMessages()).toEqual([]);
    expect(listDetails).toHaveLength(1);
    expect(listDetails[0]).toEqual([]);
  });

  it("on statusChange disconnected clears list and dispatches messagesChange", () => {
    protocol = new MockMessageProtocol();
    state = new MessageLogState(
      protocol as unknown as import("../../../mcp/inspectorClient.js").InspectorClient,
    );
    protocol.dispatchMessage(createRequestEntry("1"));
    expect(state.getMessages()).toHaveLength(1);

    const listDetails: MessageEntry[][] = [];
    state.addEventListener("messagesChange", (e) => listDetails.push(e.detail));
    protocol.setDisconnected();

    expect(state.getMessages()).toEqual([]);
    expect(listDetails).toHaveLength(1);
    expect(listDetails[0]).toEqual([]);
  });

  it("destroy() unsubscribes and clears state", () => {
    protocol = new MockMessageProtocol();
    state = new MessageLogState(
      protocol as unknown as import("../../../mcp/inspectorClient.js").InspectorClient,
    );
    protocol.dispatchMessage(createRequestEntry("1"));
    state.destroy();
    expect(state.getMessages()).toEqual([]);
    // After destroy, protocol messages should not be appended
    protocol.dispatchMessage(createRequestEntry("2"));
    expect(state.getMessages()).toEqual([]);
  });

  it("maxMessages option trims oldest when at capacity", () => {
    protocol = new MockMessageProtocol();
    state = new MessageLogState(
      protocol as unknown as import("../../../mcp/inspectorClient.js").InspectorClient,
      {
        maxMessages: 3,
      },
    );
    protocol.dispatchMessage(createRequestEntry("1"));
    protocol.dispatchMessage(createRequestEntry("2"));
    protocol.dispatchMessage(createRequestEntry("3"));
    expect(state.getMessages()).toHaveLength(3);
    protocol.dispatchMessage(createRequestEntry("4"));
    expect(state.getMessages()).toHaveLength(3);
    expect(state.getMessages().map((m) => m.id)).toEqual([
      "req-2",
      "req-3",
      "req-4",
    ]);
  });

  it("getMessages(predicate) returns filtered list", () => {
    protocol = new MockMessageProtocol();
    state = new MessageLogState(
      protocol as unknown as import("../../../mcp/inspectorClient.js").InspectorClient,
    );
    protocol.dispatchMessage(createRequestEntry("1"));
    protocol.dispatchMessage(createRequestEntry("2"));
    protocol.dispatchMessage(createRequestEntry("3"));
    const requests = state.getMessages((e) => e.direction === "request");
    expect(requests).toHaveLength(3);
    const one = state.getMessages((e) => e.id === "req-2");
    expect(one).toHaveLength(1);
    expect(one[0]!.id).toBe("req-2");
  });

  it("clearMessages(predicate) removes only matching and dispatches only when changed", () => {
    protocol = new MockMessageProtocol();
    state = new MessageLogState(
      protocol as unknown as import("../../../mcp/inspectorClient.js").InspectorClient,
    );
    protocol.dispatchMessage(createRequestEntry("1"));
    protocol.dispatchMessage(createRequestEntry("2"));
    protocol.dispatchMessage(createRequestEntry("3"));
    const listDetails: MessageEntry[][] = [];
    state.addEventListener("messagesChange", (e) => listDetails.push(e.detail));
    state.clearMessages((e) => e.id === "req-2");
    expect(state.getMessages()).toHaveLength(2);
    expect(state.getMessages().map((m) => m.id)).toEqual(["req-1", "req-3"]);
    expect(listDetails).toHaveLength(1);
    state.clearMessages((e) => e.id === "nonexistent");
    expect(state.getMessages()).toHaveLength(2);
    expect(listDetails).toHaveLength(1);
  });

  it("on connect clears list and dispatches messagesChange", () => {
    protocol = new MockMessageProtocol();
    state = new MessageLogState(
      protocol as unknown as import("../../../mcp/inspectorClient.js").InspectorClient,
    );
    protocol.dispatchMessage(createRequestEntry("1"));
    expect(state.getMessages()).toHaveLength(1);
    const listDetails: MessageEntry[][] = [];
    state.addEventListener("messagesChange", (e) => listDetails.push(e.detail));
    protocol.dispatchConnect();
    expect(state.getMessages()).toEqual([]);
    expect(listDetails).toHaveLength(1);
    expect(listDetails[0]).toEqual([]);
  });
});
