import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { ResourceSubscriptionsState } from "@inspector/core/mcp/state/resourceSubscriptionsState";
import { ManagedResourcesState } from "@inspector/core/mcp/state/managedResourcesState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import type { InspectorResourceSubscription } from "@inspector/core/mcp/types";

function resource(uri: string, extras: Partial<Resource> = {}): Resource {
  return { uri, name: uri, ...extras };
}

function waitForSubscriptionsChange(
  state: ResourceSubscriptionsState,
): Promise<InspectorResourceSubscription[]> {
  return new Promise((resolve) => {
    state.addEventListener("subscriptionsChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("ResourceSubscriptionsState", () => {
  let client: FakeInspectorClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T10:00:00Z"));
    client = new FakeInspectorClient({ status: "connected" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts empty and getSubscriptions returns a defensive copy", () => {
    const state = new ResourceSubscriptionsState(client);
    expect(state.getSubscriptions()).toEqual([]);
    const a = state.getSubscriptions();
    const b = state.getSubscriptions();
    expect(a).not.toBe(b);
  });

  it("rebuilds subscriptions from resourceSubscriptionsChange events", async () => {
    const state = new ResourceSubscriptionsState(client);
    const changePromise = waitForSubscriptionsChange(state);
    client.dispatchTypedEvent("resourceSubscriptionsChange", [
      "file:///a",
      "file:///b",
    ]);
    const next = await changePromise;
    expect(next).toEqual([
      { resource: { uri: "file:///a", name: "file:///a" } },
      { resource: { uri: "file:///b", name: "file:///b" } },
    ]);
  });

  it("resolves Resource references via ManagedResourcesState when provided", async () => {
    const resourcesState = new ManagedResourcesState(client);
    client.queueResourcePages({
      resources: [resource("file:///a", { name: "Alpha", title: "Title A" })],
    });
    await resourcesState.refresh();

    const state = new ResourceSubscriptionsState(client, resourcesState);
    const changePromise = waitForSubscriptionsChange(state);
    client.dispatchTypedEvent("resourceSubscriptionsChange", [
      "file:///a",
      "file:///unknown",
    ]);
    const next = await changePromise;
    expect(next[0].resource).toEqual({
      uri: "file:///a",
      name: "Alpha",
      title: "Title A",
    });
    // Unknown URI falls back to a synthetic Resource
    expect(next[1].resource).toEqual({
      uri: "file:///unknown",
      name: "file:///unknown",
    });
  });

  it("stamps lastUpdated on resourceUpdated for a tracked URI", async () => {
    const state = new ResourceSubscriptionsState(client);
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    expect(state.getSubscriptions()[0].lastUpdated).toBeUndefined();

    const changePromise = waitForSubscriptionsChange(state);
    client.dispatchTypedEvent("resourceUpdated", { uri: "file:///a" });
    const next = await changePromise;
    expect(next[0].lastUpdated).toEqual(new Date("2026-05-19T10:00:00Z"));
  });

  it("ignores resourceUpdated for URIs that are not subscribed", () => {
    const state = new ResourceSubscriptionsState(client);
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    const handler = vi.fn();
    state.addEventListener("subscriptionsChange", handler);
    client.dispatchTypedEvent("resourceUpdated", {
      uri: "file:///not-tracked",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(state.getSubscriptions()[0].lastUpdated).toBeUndefined();
  });

  it("preserves lastUpdated across re-subscribes and drops it on unsubscribe", async () => {
    const state = new ResourceSubscriptionsState(client);
    client.dispatchTypedEvent("resourceSubscriptionsChange", [
      "file:///a",
      "file:///b",
    ]);
    client.dispatchTypedEvent("resourceUpdated", { uri: "file:///a" });
    expect(state.getSubscriptions()[0].lastUpdated).toBeInstanceOf(Date);

    // Unsubscribe from "a", subscribe to "c". lastUpdated for "a" is dropped.
    client.dispatchTypedEvent("resourceSubscriptionsChange", [
      "file:///b",
      "file:///c",
    ]);
    expect(state.getSubscriptions().map((s) => s.resource.uri)).toEqual([
      "file:///b",
      "file:///c",
    ]);
    expect(state.getSubscriptions().every((s) => !s.lastUpdated)).toBe(true);

    // Re-subscribe to "a" — no lastUpdated since the prior entry was dropped.
    client.dispatchTypedEvent("resourceSubscriptionsChange", [
      "file:///a",
      "file:///b",
      "file:///c",
    ]);
    expect(state.getSubscriptions()[0].lastUpdated).toBeUndefined();
  });

  it("preserves lastUpdated when an unrelated URI is added", () => {
    const state = new ResourceSubscriptionsState(client);
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    client.dispatchTypedEvent("resourceUpdated", { uri: "file:///a" });
    const stampedAt = state.getSubscriptions()[0].lastUpdated;
    expect(stampedAt).toBeInstanceOf(Date);

    client.dispatchTypedEvent("resourceSubscriptionsChange", [
      "file:///a",
      "file:///b",
    ]);
    const subs = state.getSubscriptions();
    expect(subs[0].lastUpdated).toEqual(stampedAt);
    expect(subs[1].lastUpdated).toBeUndefined();
  });

  it("re-resolves Resource references when ManagedResourcesState refreshes", async () => {
    const resourcesState = new ManagedResourcesState(client);
    const state = new ResourceSubscriptionsState(client, resourcesState);
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    expect(state.getSubscriptions()[0].resource.name).toBe("file:///a");

    client.queueResourcePages({
      resources: [resource("file:///a", { name: "Resolved Name" })],
    });
    const changePromise = waitForSubscriptionsChange(state);
    await resourcesState.refresh();
    const next = await changePromise;
    expect(next[0].resource.name).toBe("Resolved Name");
  });

  it("does not re-emit on resourcesChange when no URIs are subscribed", async () => {
    const resourcesState = new ManagedResourcesState(client);
    const state = new ResourceSubscriptionsState(client, resourcesState);
    const handler = vi.fn();
    state.addEventListener("subscriptionsChange", handler);

    client.queueResourcePages({ resources: [resource("file:///a")] });
    await resourcesState.refresh();
    expect(handler).not.toHaveBeenCalled();
  });

  it("clears subscriptions on statusChange to disconnected", async () => {
    const state = new ResourceSubscriptionsState(client);
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    expect(state.getSubscriptions()).toHaveLength(1);

    const changePromise = waitForSubscriptionsChange(state);
    client.setStatus("disconnected");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getSubscriptions()).toEqual([]);
  });

  it("does not clear subscriptions on non-disconnected status changes", () => {
    const state = new ResourceSubscriptionsState(client);
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    client.setStatus("error");
    expect(state.getSubscriptions()).toHaveLength(1);
  });

  it("destroy unsubscribes from client and resources state events", () => {
    const resourcesState = new ManagedResourcesState(client);
    const state = new ResourceSubscriptionsState(client, resourcesState);
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    expect(state.getSubscriptions()).toHaveLength(1);

    state.destroy();
    expect(state.getSubscriptions()).toEqual([]);

    // Further events from the client must not affect the destroyed state.
    const handler = vi.fn();
    state.addEventListener("subscriptionsChange", handler);
    client.dispatchTypedEvent("resourceSubscriptionsChange", [
      "file:///a",
      "file:///b",
    ]);
    client.dispatchTypedEvent("resourceUpdated", { uri: "file:///a" });
    expect(handler).not.toHaveBeenCalled();
    expect(state.getSubscriptions()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    const state = new ResourceSubscriptionsState(client);
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
