import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { Resource } from "@modelcontextprotocol/client";
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
    // `resources` capability so the ManagedResourcesState refresh used by the
    // reference-resolution test exercises the live `listResources` path.
    client = new FakeInspectorClient({
      status: "connected",
      capabilities: { resources: {} },
    });
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
    const resourcesState = new ManagedResourcesState(client, 0);
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
    const resourcesState = new ManagedResourcesState(client, 0);
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
    const resourcesState = new ManagedResourcesState(client, 0);
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

  it("clears subscriptions on a mid-session crash (statusChange to error, #1490)", async () => {
    const state = new ResourceSubscriptionsState(client);
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    expect(state.getSubscriptions()).toHaveLength(1);

    const changePromise = waitForSubscriptionsChange(state);
    client.setStatus("error");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getSubscriptions()).toEqual([]);
  });

  it("does not clear subscriptions on a non-terminal status change (connecting)", () => {
    const state = new ResourceSubscriptionsState(client);
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    client.setStatus("connecting");
    expect(state.getSubscriptions()).toHaveLength(1);
  });

  it("destroy unsubscribes from client and resources state events", () => {
    const resourcesState = new ManagedResourcesState(client, 0);
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

  describe("modern listen-stream state (#1630)", () => {
    it("starts inactive and seeds from the client", () => {
      const state = new ResourceSubscriptionsState(client);
      expect(state.getStreamState()).toEqual({
        active: false,
        status: "ended",
        honoredUris: [],
      });

      client.resourceSubscriptionStreamState = {
        active: true,
        status: "acknowledged",
        honoredUris: ["file:///a"],
      };
      const seeded = new ResourceSubscriptionsState(client);
      expect(seeded.getStreamState().active).toBe(true);
      expect(seeded.getStreamState().honoredUris).toEqual(["file:///a"]);
    });

    it("forwards resourceSubscriptionStreamChange as streamStateChange", async () => {
      const state = new ResourceSubscriptionsState(client);
      const next = await new Promise((resolve) => {
        state.addEventListener("streamStateChange", (e) => resolve(e.detail), {
          once: true,
        });
        client.dispatchTypedEvent("resourceSubscriptionStreamChange", {
          active: true,
          status: "reconnecting",
          honoredUris: [],
        });
      });
      expect(next).toEqual({
        active: true,
        status: "reconnecting",
        honoredUris: [],
      });
      expect(state.getStreamState().status).toBe("reconnecting");
    });

    it("resets stream state to inactive on a terminal status change", () => {
      const state = new ResourceSubscriptionsState(client);
      client.dispatchTypedEvent("resourceSubscriptionStreamChange", {
        active: true,
        status: "acknowledged",
        honoredUris: ["file:///a"],
      });
      expect(state.getStreamState().active).toBe(true);

      const handler = vi.fn();
      state.addEventListener("streamStateChange", handler);
      client.setStatus("disconnected");
      expect(state.getStreamState().active).toBe(false);
      expect(handler).toHaveBeenCalled();
    });

    it("resets stream state on destroy", () => {
      const state = new ResourceSubscriptionsState(client);
      client.dispatchTypedEvent("resourceSubscriptionStreamChange", {
        active: true,
        status: "acknowledged",
        honoredUris: ["file:///a"],
      });
      state.destroy();
      expect(state.getStreamState().active).toBe(false);
    });
  });
});
