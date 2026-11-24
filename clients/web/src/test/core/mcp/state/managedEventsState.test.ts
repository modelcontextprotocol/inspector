import { describe, it, expect, beforeEach } from "vitest";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import {
  ManagedEventsState,
  clientSupportsEvents,
} from "@inspector/core/mcp/state/managedEventsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { EventsFakeClient, eventType } from "./eventsFake";
import { waitForChangeEvent } from "./waitForChangeEvent";

const AUTO_REFRESH_SETTINGS: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: {},
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  autoRefreshOnListChanged: true,
  roots: [],
};

describe("ManagedEventsState (#3028)", () => {
  let client: EventsFakeClient;
  let state: ManagedEventsState;

  beforeEach(() => {
    client = new EventsFakeClient();
    state = new ManagedEventsState(client, 0);
  });

  it("starts empty and hands out defensive copies", () => {
    expect(state.getEventTypes()).toEqual([]);
    expect(state.getEventTypes()).not.toBe(state.getEventTypes());
  });

  it("loads every page on connect", async () => {
    client.eventPages.push(
      { events: [eventType("a")], nextCursor: "2", excluded: [] },
      { events: [eventType("b")], excluded: [] },
    );
    const changed = waitForChangeEvent(state, "eventTypesChange");
    await client.connect();
    expect((await changed).map((e) => e.name)).toEqual(["a", "b"]);
    expect(client.listAllEvents).toHaveBeenCalledTimes(1);
    expect(state.isLoaded()).toBe(true);
  });

  it("never asks a client whose connection does not support events", async () => {
    client.eventsExtension = undefined;
    client.setStatus("connected");
    expect(await state.refresh()).toEqual([]);
    expect(client.listAllEvents).not.toHaveBeenCalled();
  });

  it("treats a client without the events surface as unsupported", async () => {
    const plain = new FakeInspectorClient();
    expect(clientSupportsEvents(plain)).toBe(false);
    plain.setStatus("connected");
    const plainState = new ManagedEventsState(plain, 0);
    expect(await plainState.refresh()).toEqual([]);
  });

  it("re-walks on eventsListChanged when auto-refresh is on", async () => {
    client.setServerSettings(AUTO_REFRESH_SETTINGS);
    client.setStatus("connected");
    client.eventPages.push({ events: [eventType("new")], excluded: [] });
    const changed = waitForChangeEvent(state, "eventTypesChange");
    client.dispatchTypedEvent("eventsListChanged");
    expect((await changed).map((e) => e.name)).toEqual(["new"]);
  });

  it("lights the indicator on eventsListChanged when auto-refresh is off", async () => {
    client.setStatus("connected");
    const lit = waitForChangeEvent(state, "listChangedChange");
    client.dispatchTypedEvent("eventsListChanged");
    expect(await lit).toBe(true);
    expect(client.listAllEvents).not.toHaveBeenCalled();
  });

  it("defers the connect-time walk in paginated mode", async () => {
    client.setServerSettings({
      ...AUTO_REFRESH_SETTINGS,
      paginatedLists: true,
    });
    await client.connect();
    expect(client.listAllEvents).not.toHaveBeenCalled();
  });

  it("records a failed walk and attributes it", async () => {
    client.setStatus("connected");
    client.listAllEvents.mockRejectedValueOnce(new Error("boom"));
    await expect(state.refresh()).rejects.toThrow("boom");
    expect(state.getError()?.message).toBe("boom");
  });

  it("clears on disconnect", async () => {
    client.eventPages.push({ events: [eventType("a")], excluded: [] });
    client.setStatus("connected");
    await state.refresh();
    expect(state.getEventTypes()).toHaveLength(1);
    await client.disconnect();
    expect(state.getEventTypes()).toEqual([]);
    expect(state.isLoaded()).toBe(false);
  });
});
