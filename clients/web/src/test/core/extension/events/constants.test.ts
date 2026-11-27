import { describe, it, expect } from "vitest";
import { SUBSCRIPTION_ID_META_KEY } from "@modelcontextprotocol/client";
import {
  EVENTS_ERROR_CODES,
  EVENTS_ERROR_META,
  EVENTS_NAMED_METHODS,
  EVENTS_LIST_METHOD,
  EVENTS_SUBSCRIPTION_ID_META_KEY,
  eventsErrorName,
} from "@inspector/core/extension/events/constants.js";

describe("events constants (#3028)", () => {
  it("uses the core protocol's subscription-id meta key", () => {
    // The spec reuses the correlation key the core subscription streams use;
    // restated here only because no events package exists to re-export from.
    expect(EVENTS_SUBSCRIPTION_ID_META_KEY).toBe(SUBSCRIPTION_ID_META_KEY);
  });

  it("allocates the five general-purpose codes -32023..-32027", () => {
    expect(Object.values(EVENTS_ERROR_CODES)).toEqual([
      -32023, -32024, -32025, -32026, -32027,
    ]);
  });

  it("names every code and describes it", () => {
    for (const [name, code] of Object.entries(EVENTS_ERROR_CODES)) {
      expect(eventsErrorName(code)).toBe(name);
      expect(EVENTS_ERROR_META[code].description.length).toBeGreaterThan(0);
    }
  });

  it("names no other code", () => {
    expect(eventsErrorName(-32020)).toBeUndefined();
    expect(eventsErrorName(-32602)).toBeUndefined();
  });

  it("names every events/* request except events/list for Mcp-Name", () => {
    expect([...EVENTS_NAMED_METHODS].sort()).toEqual([
      "events/poll",
      "events/stream",
      "events/subscribe",
      "events/unsubscribe",
    ]);
    expect(EVENTS_NAMED_METHODS.has(EVENTS_LIST_METHOD)).toBe(false);
  });
});
