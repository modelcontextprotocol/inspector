import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PagedEventsState } from "@inspector/core/mcp/state/pagedEventsState";
import { usePagedEvents } from "@inspector/core/react/usePagedEvents";
import { EventsFakeClient, eventType } from "../mcp/state/eventsFake";

const EXCLUDED = { eventType: eventType("bad"), reason: "invalid" };

describe("usePagedEvents (#3030)", () => {
  let client: EventsFakeClient;
  let state: PagedEventsState;

  beforeEach(() => {
    client = new EventsFakeClient({ status: "connected" });
    state = new PagedEventsState(client);
  });

  it("degrades to empty values when no store is attached", async () => {
    const { result } = renderHook(() => usePagedEvents(client, null));
    expect(result.current.eventTypes).toEqual([]);
    expect(result.current.excluded).toEqual([]);
    expect(result.current.pageCount).toBe(0);
    expect(result.current.nextCursor).toBeUndefined();
    expect(result.current.error).toBeNull();
    await expect(result.current.loadPage()).resolves.toEqual({
      events: [],
      nextCursor: undefined,
    });
  });

  it("mirrors each page, its exclusions and the progress", async () => {
    const { result } = renderHook(() => usePagedEvents(client, state));
    client.eventPages.push(
      { events: [eventType("a")], nextCursor: "2", excluded: [EXCLUDED] },
      { events: [eventType("b")], excluded: [] },
    );
    await act(async () => {
      await result.current.loadPage();
    });
    expect(result.current.eventTypes.map((e) => e.name)).toEqual(["a"]);
    expect(result.current.excluded).toEqual([EXCLUDED]);
    expect(result.current.nextCursor).toBe("2");
    expect(result.current.pageCount).toBe(1);

    await act(async () => {
      await result.current.loadPage("2");
    });
    expect(result.current.eventTypes.map((e) => e.name)).toEqual(["a", "b"]);
    expect(result.current.pageCount).toBe(2);
    expect(result.current.nextCursor).toBeUndefined();
  });

  it("surfaces a failed page", async () => {
    client.listEvents.mockRejectedValueOnce(new Error("nope"));
    const { result } = renderHook(() => usePagedEvents(client, state));
    await act(async () => {
      await result.current.loadPage().catch(() => {});
    });
    expect(result.current.error?.message).toBe("nope");
  });
});
