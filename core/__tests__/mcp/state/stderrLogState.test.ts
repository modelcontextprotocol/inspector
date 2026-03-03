/**
 * StderrLogState tests use a mock protocol that dispatches "stderrLog"
 * to assert the manager's list and emitted events.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { StderrLogEntry } from "../../../mcp/types.js";
import { StderrLogState } from "../../../mcp/state/stderrLogState.js";

class MockStderrLogProtocol extends EventTarget {
  dispatchStderrLog(entry: StderrLogEntry): void {
    this.dispatchEvent(new CustomEvent("stderrLog", { detail: entry }));
  }
}

function createStderrLogEntry(message: string): StderrLogEntry {
  return {
    timestamp: new Date(),
    message,
  };
}

type InspectorClient =
  import("../../../mcp/inspectorClient.js").InspectorClient;

describe("StderrLogState", () => {
  let protocol: MockStderrLogProtocol;
  let state: StderrLogState | null = null;

  afterEach(() => {
    state?.destroy();
    state = null;
  });

  it("starts with empty stderr logs", () => {
    protocol = new MockStderrLogProtocol();
    state = new StderrLogState(protocol as unknown as InspectorClient);
    expect(state.getStderrLogs()).toEqual([]);
  });

  it("on protocol stderrLog appends entry and dispatches stderrLog + stderrLogsChange", () => {
    protocol = new MockStderrLogProtocol();
    state = new StderrLogState(protocol as unknown as InspectorClient);
    const entry = createStderrLogEntry("hello");

    const singleDetails: StderrLogEntry[] = [];
    const listDetails: StderrLogEntry[][] = [];
    state.addEventListener("stderrLog", (e) => singleDetails.push(e.detail));
    state.addEventListener("stderrLogsChange", (e) =>
      listDetails.push(e.detail),
    );

    protocol.dispatchStderrLog(entry);

    expect(state.getStderrLogs()).toHaveLength(1);
    expect(state.getStderrLogs()[0]).toBe(entry);
    expect(singleDetails).toHaveLength(1);
    expect(singleDetails[0]).toBe(entry);
    expect(listDetails).toHaveLength(1);
    expect(listDetails[0]).toHaveLength(1);
  });

  it("maxStderrLogEvents option trims oldest when at capacity", () => {
    protocol = new MockStderrLogProtocol();
    state = new StderrLogState(protocol as unknown as InspectorClient, {
      maxStderrLogEvents: 3,
    });
    protocol.dispatchStderrLog(createStderrLogEntry("a"));
    protocol.dispatchStderrLog(createStderrLogEntry("b"));
    protocol.dispatchStderrLog(createStderrLogEntry("c"));
    expect(state.getStderrLogs()).toHaveLength(3);
    protocol.dispatchStderrLog(createStderrLogEntry("d"));
    expect(state.getStderrLogs()).toHaveLength(3);
    expect(state.getStderrLogs().map((e) => e.message)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("clearStderrLogs() empties list and dispatches stderrLogsChange only when non-empty", () => {
    protocol = new MockStderrLogProtocol();
    state = new StderrLogState(protocol as unknown as InspectorClient);
    const listDetails: StderrLogEntry[][] = [];
    state.addEventListener("stderrLogsChange", (e) =>
      listDetails.push(e.detail),
    );
    state.clearStderrLogs();
    expect(listDetails).toHaveLength(0);

    protocol.dispatchStderrLog(createStderrLogEntry("x"));
    expect(listDetails).toHaveLength(1);
    state.clearStderrLogs();
    expect(state.getStderrLogs()).toEqual([]);
    expect(listDetails).toHaveLength(2);
    expect(listDetails[1]).toEqual([]);
  });

  it("destroy() unsubscribes and clears state", () => {
    protocol = new MockStderrLogProtocol();
    state = new StderrLogState(protocol as unknown as InspectorClient);
    protocol.dispatchStderrLog(createStderrLogEntry("x"));
    state.destroy();
    expect(state.getStderrLogs()).toEqual([]);
    protocol.dispatchStderrLog(createStderrLogEntry("y"));
    expect(state.getStderrLogs()).toEqual([]);
  });
});
