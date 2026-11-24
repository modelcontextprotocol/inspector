import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { EventSubscriptionsState } from "@inspector/core/mcp/state/eventSubscriptionsState";
import {
  useEventLog,
  useEventSubscriptions,
} from "@inspector/core/react/useEventSubscriptions";
import { EVENTS_EVENT_NOTIFICATION } from "@inspector/core/extension/events/constants";
import type { EventType } from "@inspector/core/extension/events/schemas";
import { EventsEngineFakeClient } from "../mcp/state/eventsFake";

const pushType: EventType = {
  name: "build.finished",
  delivery: ["push"],
  inputSchema: { type: "object" },
};

describe("useEventSubscriptions / useEventLog (#3029)", () => {
  let client: EventsEngineFakeClient;
  let state: EventSubscriptionsState;

  beforeEach(() => {
    client = new EventsEngineFakeClient();
    state = new EventSubscriptionsState(client);
  });

  afterEach(() => state.destroy());

  it("returns stable empty lists when there is no store", () => {
    const subs = renderHook(() => useEventSubscriptions(null));
    const log = renderHook(() => useEventLog(null));
    const first = subs.result.current;
    subs.rerender();
    expect(subs.result.current).toBe(first);
    expect(first).toEqual([]);
    expect(log.result.current).toEqual([]);
  });

  it("re-renders with each subscription change and log entry", () => {
    const subs = renderHook(() => useEventSubscriptions(state));
    const log = renderHook(() => useEventLog(state));
    expect(subs.result.current).toEqual([]);

    act(() => {
      state.subscribe(pushType, { mode: "push" });
    });
    expect(subs.result.current).toHaveLength(1);
    expect(subs.result.current[0]!.name).toBe("build.finished");

    act(() => {
      client.notify(EVENTS_EVENT_NOTIFICATION, client.lastStream().id, {
        eventId: "e1",
        name: "build.finished",
        timestamp: "2026-11-24T00:00:00Z",
        data: {},
      });
    });
    expect(log.result.current).toHaveLength(1);
    expect(log.result.current[0]!.kind).toBe("event");
    expect(subs.result.current[0]!.counts.events).toBe(1);
  });
});
