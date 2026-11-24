import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ManagedEventsState } from "@inspector/core/mcp/state/managedEventsState";
import { useManagedEvents } from "@inspector/core/react/useManagedEvents";
import { EventsFakeClient, eventType } from "../mcp/state/eventsFake";

describe("useManagedEvents (#3030)", () => {
  let client: EventsFakeClient;
  let state: ManagedEventsState;

  beforeEach(() => {
    client = new EventsFakeClient({ status: "connected" });
    state = new ManagedEventsState(client, 0);
  });

  it("degrades to empty values when no store is attached", async () => {
    const { result } = renderHook(() => useManagedEvents(client, null));
    expect(result.current.eventTypes).toEqual([]);
    expect(result.current.listChanged).toBe(false);
    expect(result.current.loaded).toBe(false);
    expect(result.current.error).toBeNull();
    await expect(result.current.refresh()).resolves.toEqual([]);
    // A no-op rather than a throw with nothing attached.
    result.current.clearListChanged();
  });

  it("resolves empty when there is a store but no client", async () => {
    const { result } = renderHook(() => useManagedEvents(null, state));
    await expect(result.current.refresh()).resolves.toEqual([]);
    expect(client.listAllEvents).not.toHaveBeenCalled();
  });

  it("re-renders on a refresh and reports the list as loaded", async () => {
    const { result } = renderHook(() => useManagedEvents(client, state));
    client.eventPages.push({ events: [eventType("a")], excluded: [] });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.eventTypes.map((e) => e.name)).toEqual(["a"]);
    expect(result.current.loaded).toBe(true);
  });

  it("follows the list-changed indicator and clears it on refresh", async () => {
    const { result } = renderHook(() => useManagedEvents(client, state));
    act(() => {
      client.dispatchTypedEvent("eventsListChanged");
    });
    await waitFor(() => expect(result.current.listChanged).toBe(true));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.listChanged).toBe(false);

    act(() => {
      client.dispatchTypedEvent("eventsListChanged");
    });
    await waitFor(() => expect(result.current.listChanged).toBe(true));
    act(() => result.current.clearListChanged());
    expect(result.current.listChanged).toBe(false);
  });

  it("surfaces the store's error", async () => {
    client.listAllEvents.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useManagedEvents(client, state));
    await act(async () => {
      await result.current.refresh().catch(() => {});
    });
    expect(result.current.error?.message).toBe("boom");
  });
});
