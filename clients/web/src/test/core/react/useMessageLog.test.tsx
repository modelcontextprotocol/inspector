import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { MessageEntry } from "@inspector/core/mcp/types";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { MessageLogState } from "@inspector/core/mcp/state/messageLogState";
import { useMessageLog } from "@inspector/core/react/useMessageLog";

function notif(method: string): MessageEntry {
  return {
    id: `n-${method}`,
    timestamp: new Date(2026, 4, 13),
    direction: "notification",
    message: { jsonrpc: "2.0", method, params: {} },
  };
}

describe("useMessageLog", () => {
  let client: FakeInspectorClient;
  let state: MessageLogState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new MessageLogState(client);
  });

  it("returns the initial snapshot from the state", () => {
    client.dispatchTypedEvent("message", notif("a"));
    const { result } = renderHook(() => useMessageLog(state));
    expect(result.current.messages).toHaveLength(1);
  });

  it("returns empty when state is null", () => {
    const { result } = renderHook(() => useMessageLog(null));
    expect(result.current.messages).toEqual([]);
  });

  it("updates when state dispatches messagesChange", async () => {
    const { result } = renderHook(() => useMessageLog(state));
    expect(result.current.messages).toEqual([]);
    act(() => {
      client.dispatchTypedEvent("message", notif("a"));
    });
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
  });

  it("resets to empty when the state prop becomes null", async () => {
    client.dispatchTypedEvent("message", notif("a"));
    const { result, rerender } = renderHook(
      ({ s }: { s: MessageLogState | null }) => useMessageLog(s),
      { initialProps: { s: state as MessageLogState | null } },
    );
    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.messages).toEqual([]);
    });
  });

  it("unsubscribes on unmount", async () => {
    const { result, unmount } = renderHook(() => useMessageLog(state));
    unmount();
    client.dispatchTypedEvent("message", notif("a"));
    expect(result.current.messages).toEqual([]);
  });
});
