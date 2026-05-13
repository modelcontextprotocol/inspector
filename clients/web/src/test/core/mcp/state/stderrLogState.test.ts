import { describe, it, expect, beforeEach } from "vitest";
import type { StderrLogEntry } from "@inspector/core/mcp/types";
import { StderrLogState } from "@inspector/core/mcp/state/stderrLogState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function entry(message: string): StderrLogEntry {
  return { message, timestamp: new Date(2026, 4, 13) };
}

describe("StderrLogState", () => {
  let client: FakeInspectorClient;
  let state: StderrLogState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new StderrLogState(client);
  });

  it("starts empty and returns defensive copies", () => {
    expect(state.getStderrLogs()).toEqual([]);
    expect(state.getStderrLogs()).not.toBe(state.getStderrLogs());
  });

  it("appends entries and dispatches stderrLog + stderrLogsChange", () => {
    const seenSingle: StderrLogEntry[] = [];
    const seenFull: StderrLogEntry[][] = [];
    state.addEventListener("stderrLog", (e) => seenSingle.push(e.detail));
    state.addEventListener("stderrLogsChange", (e) => seenFull.push(e.detail));

    client.dispatchTypedEvent("stderrLog", entry("a"));
    client.dispatchTypedEvent("stderrLog", entry("b"));

    expect(state.getStderrLogs().map((e) => e.message)).toEqual(["a", "b"]);
    expect(seenSingle).toHaveLength(2);
    expect(seenFull).toHaveLength(2);
  });

  it("trims the oldest entries when maxStderrLogEvents is exceeded", () => {
    const small = new StderrLogState(client, { maxStderrLogEvents: 2 });
    client.dispatchTypedEvent("stderrLog", entry("a"));
    client.dispatchTypedEvent("stderrLog", entry("b"));
    client.dispatchTypedEvent("stderrLog", entry("c"));
    expect(small.getStderrLogs().map((e) => e.message)).toEqual(["b", "c"]);
  });

  it("does not trim when maxStderrLogEvents is 0", () => {
    const big = new StderrLogState(client, { maxStderrLogEvents: 0 });
    for (let i = 0; i < 5; i++) {
      client.dispatchTypedEvent("stderrLog", entry(`m${i}`));
    }
    expect(big.getStderrLogs()).toHaveLength(5);
  });

  it("clearStderrLogs dispatches when the list was non-empty", () => {
    client.dispatchTypedEvent("stderrLog", entry("a"));
    let dispatched = false;
    state.addEventListener("stderrLogsChange", () => (dispatched = true));
    state.clearStderrLogs();
    expect(dispatched).toBe(true);
    expect(state.getStderrLogs()).toEqual([]);
  });

  it("clearStderrLogs is a no-op when the list is empty", () => {
    let dispatched = false;
    state.addEventListener("stderrLogsChange", () => (dispatched = true));
    state.clearStderrLogs();
    expect(dispatched).toBe(false);
  });

  it("does NOT clear on connect or disconnect", () => {
    client.dispatchTypedEvent("stderrLog", entry("a"));
    client.dispatchTypedEvent("connect");
    expect(state.getStderrLogs().map((e) => e.message)).toEqual(["a"]);
    client.setStatus("disconnected");
    expect(state.getStderrLogs().map((e) => e.message)).toEqual(["a"]);
  });

  it("destroy stops listening and clears state", () => {
    client.dispatchTypedEvent("stderrLog", entry("a"));
    state.destroy();
    expect(state.getStderrLogs()).toEqual([]);
    client.dispatchTypedEvent("stderrLog", entry("b"));
    expect(state.getStderrLogs()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
