import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { StderrLogEntry } from "@inspector/core/mcp/types";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { StderrLogState } from "@inspector/core/mcp/state/stderrLogState";
import { useStderrLog } from "@inspector/core/react/useStderrLog";

function entry(message: string): StderrLogEntry {
  return { message, timestamp: new Date(2026, 4, 13) };
}

describe("useStderrLog", () => {
  let client: FakeInspectorClient;
  let state: StderrLogState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new StderrLogState(client);
  });

  it("returns the initial snapshot from the state", () => {
    client.dispatchTypedEvent("stderrLog", entry("a"));
    const { result } = renderHook(() => useStderrLog(state));
    expect(result.current.stderrLogs.map((e) => e.message)).toEqual(["a"]);
  });

  it("returns empty when state is null", () => {
    const { result } = renderHook(() => useStderrLog(null));
    expect(result.current.stderrLogs).toEqual([]);
  });

  it("updates when state dispatches stderrLogsChange", async () => {
    const { result } = renderHook(() => useStderrLog(state));
    act(() => {
      client.dispatchTypedEvent("stderrLog", entry("a"));
    });
    await waitFor(() => {
      expect(result.current.stderrLogs).toHaveLength(1);
    });
  });

  it("resets to empty when the state prop becomes null", async () => {
    client.dispatchTypedEvent("stderrLog", entry("a"));
    const { result, rerender } = renderHook(
      ({ s }: { s: StderrLogState | null }) => useStderrLog(s),
      { initialProps: { s: state as StderrLogState | null } },
    );
    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.stderrLogs).toEqual([]);
    });
  });

  it("unsubscribes on unmount", () => {
    const { result, unmount } = renderHook(() => useStderrLog(state));
    unmount();
    client.dispatchTypedEvent("stderrLog", entry("a"));
    expect(result.current.stderrLogs).toEqual([]);
  });
});
