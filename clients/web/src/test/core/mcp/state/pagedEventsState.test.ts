import { describe, it, expect, beforeEach } from "vitest";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { PagedEventsState } from "@inspector/core/mcp/state/pagedEventsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { EventsFakeClient, eventType } from "./eventsFake";
import { waitForChangeEvent } from "./waitForChangeEvent";

const PAGINATED: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: {},
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  roots: [],
  paginatedLists: true,
};

const EXCLUDED = { eventType: eventType("bad"), reason: "invalid" };

describe("PagedEventsState (#3028)", () => {
  let client: EventsFakeClient;
  let state: PagedEventsState;

  beforeEach(() => {
    client = new EventsFakeClient();
    state = new PagedEventsState(client);
  });

  it("returns empty and sends nothing while disconnected", async () => {
    expect(await state.loadPage()).toEqual({
      events: [],
      nextCursor: undefined,
    });
    expect(client.listEvents).not.toHaveBeenCalled();
  });

  it("sends nothing when the connection does not support events", async () => {
    client.eventsExtension = undefined;
    client.setStatus("connected");
    await state.loadPage();
    expect(client.listEvents).not.toHaveBeenCalled();
  });

  it("auto-loads page 1 on connect in paginated mode only", async () => {
    await client.connect();
    expect(client.listEvents).not.toHaveBeenCalled();

    const paged = new EventsFakeClient({ serverSettings: PAGINATED });
    paged.eventPages.push({
      events: [eventType("a")],
      nextCursor: "2",
      excluded: [EXCLUDED],
    });
    const pagedState = new PagedEventsState(paged);
    const changed = waitForChangeEvent(pagedState, "eventTypesChange");
    await paged.connect();
    expect((await changed).map((e) => e.name)).toEqual(["a"]);
    expect(pagedState.getPagination()).toEqual({
      nextCursor: "2",
      pageCount: 1,
    });
    expect(pagedState.getExcludedEventTypes()).toEqual([EXCLUDED]);
  });

  it("appends later pages and their exclusions; page 1 replaces", async () => {
    client.setStatus("connected");
    client.eventPages.push(
      { events: [eventType("a")], nextCursor: "2", excluded: [EXCLUDED] },
      { events: [eventType("b")], excluded: [EXCLUDED] },
      { events: [eventType("c")], excluded: [] },
    );
    await state.loadPage();
    await state.loadPage("2");
    expect(state.getEventTypes().map((e) => e.name)).toEqual(["a", "b"]);
    expect(state.getExcludedEventTypes()).toHaveLength(2);
    expect(state.getPagination()).toEqual({
      nextCursor: undefined,
      pageCount: 2,
    });
    expect(client.listEvents.mock.calls[1][0]).toBe("2");

    await state.loadPage();
    expect(state.getEventTypes().map((e) => e.name)).toEqual(["c"]);
    expect(state.getExcludedEventTypes()).toEqual([]);
    expect(state.getPagination().pageCount).toBe(1);
  });

  it("drops a concurrent load", async () => {
    client.setStatus("connected");
    client.eventPages.push({ events: [eventType("a")], excluded: [] });
    const first = state.loadPage();
    expect(await state.loadPage()).toEqual({
      events: [],
      nextCursor: undefined,
    });
    await first;
    expect(client.listEvents).toHaveBeenCalledTimes(1);
  });

  it("records and rethrows a failure, and clears it on the next success", async () => {
    client.setStatus("connected");
    client.listEvents.mockRejectedValueOnce(new Error("boom"));
    await expect(state.loadPage()).rejects.toThrow("boom");
    expect(state.getError()?.message).toBe("boom");
    client.listEvents.mockRejectedValueOnce("plain");
    await expect(state.loadPage()).rejects.toBe("plain");
    expect(state.getError()?.message).toBe("plain");
    await state.loadPage();
    expect(state.getError()).toBeNull();
  });

  it("reads a client missing the page method as an empty page", async () => {
    // A protocol implementation can expose the aggregate without the page
    // method; the store then has nothing to page through.
    const partial = new FakeInspectorClient();
    const withAggregate = Object.assign(partial, {
      getEventsExtension: () => ({ listChanged: false }),
      listAllEvents: async () => ({ events: [] }),
    });
    withAggregate.setStatus("connected");
    const partialState = new PagedEventsState(withAggregate);
    expect(await partialState.loadPage()).toEqual({
      events: [],
      nextCursor: undefined,
    });
    expect(partialState.getPagination().pageCount).toBe(1);
  });

  it("abandons a load that a reset overtook, and does not block the next one", async () => {
    client.setStatus("connected");
    let release: (page: {
      events: ReturnType<typeof eventType>[];
      excluded: never[];
    }) => void = () => {};
    let fail: (err: Error) => void = () => {};
    client.listEvents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const stale = state.loadPage();
    state.clear();
    // The reset released the guard: a new session's load goes out at once.
    client.eventPages.push({ events: [eventType("fresh")], excluded: [] });
    await state.loadPage();
    expect(state.getEventTypes().map((e) => e.name)).toEqual(["fresh"]);

    release({ events: [eventType("stale")], excluded: [] });
    expect(await stale).toEqual({ events: [], nextCursor: undefined });
    expect(state.getEventTypes().map((e) => e.name)).toEqual(["fresh"]);

    // A stale failure is re-thrown but not recorded.
    client.listEvents.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const failing = state.loadPage();
    await client.disconnect();
    fail(new Error("late"));
    await expect(failing).rejects.toThrow("late");
    expect(state.getError()).toBeNull();
    expect(state.getEventTypes()).toEqual([]);
  });

  it("clears on disconnect and on clear(), and destroy() is idempotent", async () => {
    client.setStatus("connected");
    client.eventPages.push({ events: [eventType("a")], excluded: [EXCLUDED] });
    await state.loadPage();
    await client.disconnect();
    expect(state.getEventTypes()).toEqual([]);
    expect(state.getExcludedEventTypes()).toEqual([]);

    client.setStatus("connected");
    client.eventPages.push({ events: [eventType("a")], excluded: [] });
    await state.loadPage();
    state.clear();
    expect(state.getEventTypes()).toEqual([]);

    state.destroy();
    state.destroy();
    expect(await state.loadPage()).toEqual({
      events: [],
      nextCursor: undefined,
    });
  });
});
