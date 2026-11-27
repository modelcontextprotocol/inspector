import { describe, it, expect } from "vitest";
import {
  canonicalJson,
  eventSubscriptionKey,
} from "@inspector/core/extension/events/canonicalJson.js";

describe("canonicalJson (#3029)", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe(
      '{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("writes everything else as JSON.stringify does", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson(undefined)).toBe("null");
  });
});

describe("eventSubscriptionKey (#3029)", () => {
  it("is equal for reordered arguments and different per mode", () => {
    expect(eventSubscriptionKey("t", { a: 1, b: 2 }, "poll")).toBe(
      eventSubscriptionKey("t", { b: 2, a: 1 }, "poll"),
    );
    expect(eventSubscriptionKey("t", { a: 1 }, "poll")).not.toBe(
      eventSubscriptionKey("t", { a: 1 }, "push"),
    );
    // A JSON argument named `__proto__` is part of the identity.
    const proto = JSON.parse('{"__proto__":{"region":"west"}}') as Record<
      string,
      unknown
    >;
    expect(eventSubscriptionKey("t", proto, "poll")).not.toBe(
      eventSubscriptionKey("t", {}, "poll"),
    );
    expect(canonicalJson(proto)).toBe('{"__proto__":{"region":"west"}}');
    expect(eventSubscriptionKey("t", undefined, "poll")).toBe(
      eventSubscriptionKey("t", {}, "poll"),
    );
  });
});
