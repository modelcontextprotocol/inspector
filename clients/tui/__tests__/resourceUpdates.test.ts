import { describe, it, expect } from "vitest";
import type {
  InspectorResourceSubscription,
  MessageEntry,
} from "@inspector/core/mcp/types.js";
import {
  RESOURCE_UPDATED_METHOD,
  resourceUpdateFeed,
  subscribableResources,
} from "../src/utils/resourceUpdates.js";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));

const notification = (
  id: string,
  method: string,
  params: Record<string, unknown> | undefined,
  seconds: number,
): MessageEntry => ({
  id,
  timestamp: at(seconds),
  direction: "notification",
  message: params
    ? { jsonrpc: "2.0", method, params }
    : { jsonrpc: "2.0", method },
});

describe("resourceUpdateFeed", () => {
  it("keeps only resources/updated notifications with a URI, newest first", () => {
    const messages: MessageEntry[] = [
      notification("1", RESOURCE_UPDATED_METHOD, { uri: "file:///a" }, 1),
      {
        id: "2",
        timestamp: at(2),
        direction: "request",
        message: { jsonrpc: "2.0", id: 1, method: RESOURCE_UPDATED_METHOD },
      },
      notification("3", "notifications/tools/list_changed", undefined, 3),
      notification("4", RESOURCE_UPDATED_METHOD, undefined, 4),
      notification("5", RESOURCE_UPDATED_METHOD, { uri: 42 }, 5),
      {
        id: "6",
        timestamp: at(6),
        direction: "response",
        message: { jsonrpc: "2.0", id: 1, result: {} },
      },
      notification("7", RESOURCE_UPDATED_METHOD, { uri: "file:///b" }, 7),
    ];
    expect(resourceUpdateFeed(messages)).toEqual([
      { id: "7", timestamp: at(7), uri: "file:///b" },
      { id: "1", timestamp: at(1), uri: "file:///a" },
    ]);
  });

  it("is empty for an empty log", () => {
    expect(resourceUpdateFeed([])).toEqual([]);
  });
});

describe("subscribableResources", () => {
  it("marks listed resources and appends unlisted subscriptions", () => {
    const updated = at(9);
    const subs: InspectorResourceSubscription[] = [
      { resource: { uri: "file:///a", name: "a" }, lastUpdated: updated },
      { resource: { uri: "file:///x", name: "file:///x" } },
    ];
    const rows = subscribableResources(
      [
        { uri: "file:///a", name: "a" },
        { uri: "file:///b", name: "b" },
      ],
      subs,
    );
    expect(rows).toEqual([
      {
        resource: { uri: "file:///a", name: "a" },
        subscribed: true,
        lastUpdated: updated,
      },
      {
        resource: { uri: "file:///b", name: "b" },
        subscribed: false,
        lastUpdated: undefined,
      },
      {
        resource: { uri: "file:///x", name: "file:///x" },
        subscribed: true,
        lastUpdated: undefined,
      },
    ]);
  });
});
