import { describe, it, expect } from "vitest";
import {
  SUBSCRIBABLE_DELIVERY_MODES,
  buildSubscribeOptions,
  canResumeSubscription,
  describeEventsError,
  eventArguments,
  filterEventLog,
  filterEventTypes,
  formatCursor,
  formatInterval,
  formatPayload,
  formatSubscriptionArguments,
  isSubscriptionLive,
  isTuningValid,
  mirroredEventHeaders,
  optionalWholeNumber,
  resolveSubscribeMode,
  subscribableModes,
  subscriptionInterval,
} from "./eventsUtils";
import {
  activePoll,
  allModesType,
  eventLog,
  eventTypes,
  forbiddenPoll,
  headerAnnotatedType,
  pollOnlyType,
  reconnectingPush,
  terminatedPush,
  webhookOnlyType,
} from "../test/fixtures/events";

describe("subscribable modes (the webhook seam, #3031)", () => {
  it("offers poll and push only", () => {
    expect(SUBSCRIBABLE_DELIVERY_MODES).toEqual(["poll", "push"]);
  });

  it("keeps the advertised subscribable modes in the server's order", () => {
    expect(subscribableModes(allModesType)).toEqual(["poll", "push"]);
    expect(
      subscribableModes({ ...allModesType, delivery: ["push", "poll"] }),
    ).toEqual(["push", "poll"]);
    expect(subscribableModes(webhookOnlyType)).toEqual([]);
    expect(
      subscribableModes({ ...pollOnlyType, delivery: ["poll", "pigeon"] }),
    ).toEqual(["poll"]);
  });

  it("resolves the preferred mode when offered, else the first", () => {
    expect(resolveSubscribeMode(allModesType, "push")).toBe("push");
    expect(resolveSubscribeMode(pollOnlyType, "push")).toBe("poll");
    expect(resolveSubscribeMode(pollOnlyType, undefined)).toBe("poll");
    expect(resolveSubscribeMode(webhookOnlyType, "poll")).toBeUndefined();
  });
});

describe("buildSubscribeOptions", () => {
  const tuning = { maxAgeMs: 60000, maxEvents: 10, heartbeatMs: 15000 };

  it("sends maxEvents only on a poll", () => {
    expect(buildSubscribeOptions("poll", { a: 1 }, tuning)).toEqual({
      mode: "poll",
      arguments: { a: 1 },
      maxAgeMs: 60000,
      maxEvents: 10,
    });
  });

  it("sends heartbeatMs only on a push", () => {
    expect(buildSubscribeOptions("push", {}, tuning)).toEqual({
      mode: "push",
      arguments: {},
      maxAgeMs: 60000,
      heartbeatMs: 15000,
    });
  });

  it("omits every unset option", () => {
    expect(buildSubscribeOptions("poll", {}, {})).toEqual({
      mode: "poll",
      arguments: {},
    });
    expect(buildSubscribeOptions("push", {}, {})).toEqual({
      mode: "push",
      arguments: {},
    });
  });
});

describe("eventArguments", () => {
  const schema = {
    type: "object",
    properties: {
      count: { type: "integer" },
      name: { type: "string" },
      flag: { type: "boolean" },
    },
  };

  it("drops empty fields and converts typed strings", () => {
    expect(
      eventArguments(schema, {
        count: "3",
        name: "x",
        empty: "",
        missing: undefined,
        flag: true,
      }),
    ).toEqual({ count: 3, name: "x", flag: true });
  });

  it("keeps an argument named __proto__ as an own property", () => {
    const args = eventArguments(schema, JSON.parse('{"__proto__":"x"}'));
    expect(Object.keys(args)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(args, "__proto__")?.value).toBe("x");
  });

  it("keeps an empty string for a required field", () => {
    expect(
      eventArguments(
        { type: "object", properties: { k: { const: "" } }, required: ["k"] },
        { k: "" },
      ),
    ).toEqual({ k: "" });
  });

  it("returns an empty object for an empty form", () => {
    expect(eventArguments(schema, {})).toEqual({});
  });
});

describe("isTuningValid", () => {
  it("refuses a poll batch or a push heartbeat below 1", () => {
    expect(isTuningValid("poll", { maxEvents: 0 })).toBe(false);
    expect(isTuningValid("poll", { maxEvents: 1, heartbeatMs: 0 })).toBe(true);
    expect(isTuningValid("poll", {})).toBe(true);
    expect(isTuningValid("push", { heartbeatMs: 0 })).toBe(false);
    expect(isTuningValid("push", { heartbeatMs: 5, maxEvents: 0 })).toBe(true);
    expect(isTuningValid(undefined, { maxEvents: 0 })).toBe(true);
  });
});

describe("optionalWholeNumber", () => {
  it("keeps a finite number, truncated", () => {
    expect(optionalWholeNumber(5)).toBe(5);
    expect(optionalWholeNumber(5.9)).toBe(5);
  });

  it("reads an empty or partial entry as unset", () => {
    expect(optionalWholeNumber("")).toBeUndefined();
    expect(optionalWholeNumber("-")).toBeUndefined();
    expect(optionalWholeNumber(Number.NaN)).toBeUndefined();
  });
});

describe("mirroredEventHeaders", () => {
  it("names each annotated argument's Mcp-Param header", () => {
    expect(mirroredEventHeaders(headerAnnotatedType)).toEqual([
      { path: "region", header: "Mcp-Param-Region" },
    ]);
  });

  it("is empty without annotations, and for an invalid set", () => {
    expect(mirroredEventHeaders(pollOnlyType)).toEqual([]);
    expect(
      mirroredEventHeaders({
        ...pollOnlyType,
        inputSchema: {
          type: "object",
          properties: { t: { type: "string", "x-mcp-header": "Bad Header" } },
        },
      }),
    ).toEqual([]);
  });
});

describe("filterEventTypes", () => {
  it("sorts by name and matches name or description", () => {
    expect(filterEventTypes(eventTypes, "").map((e) => e.name)).toEqual([
      "deploy.completed",
      "email.received",
      "incident.created",
      "payment.settled",
    ]);
    expect(filterEventTypes(eventTypes, "INBOX").map((e) => e.name)).toEqual([
      "email.received",
    ]);
    expect(filterEventTypes(eventTypes, "payment").map((e) => e.name)).toEqual([
      "payment.settled",
    ]);
  });
});

describe("formatting", () => {
  it("formats a cursor, naming null", () => {
    expect(formatCursor("c-1")).toBe("c-1");
    expect(formatCursor(null)).toBe("none (from now)");
  });

  it("formats intervals by scale", () => {
    expect(formatInterval(750)).toBe("750 ms");
    expect(formatInterval(30000)).toBe("30 s");
    expect(formatInterval(1500)).toBe("1.5 s");
    expect(formatInterval(90000)).toBe("1.5 min");
  });

  it("formats arguments and payloads", () => {
    expect(formatSubscriptionArguments({})).toBe("no arguments");
    expect(formatSubscriptionArguments({ a: 1 })).toBe('{"a":1}');
    expect(formatPayload({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("describes an error with its spec name when it has one", () => {
    expect(describeEventsError({ code: -32023, message: "gone" })).toBe(
      "-32023 NotFound: gone",
    );
    expect(describeEventsError({ code: -32603, message: "boom" })).toBe(
      "-32603: boom",
    );
  });
});

describe("subscription state", () => {
  it("reports the granted heartbeat or the next poll", () => {
    expect(subscriptionInterval(activePoll)).toEqual({
      label: "Next poll",
      ms: 5000,
    });
    expect(subscriptionInterval(reconnectingPush)).toEqual({
      label: "Heartbeat",
      ms: 30000,
    });
    expect(subscriptionInterval(terminatedPush)).toBeUndefined();
    expect(
      subscriptionInterval({ ...activePoll, nextPollMs: undefined }),
    ).toBeUndefined();
  });

  it("tells live subscriptions from ended ones", () => {
    expect(isSubscriptionLive(activePoll)).toBe(true);
    expect(isSubscriptionLive(reconnectingPush)).toBe(true);
    expect(isSubscriptionLive({ ...activePoll, status: "starting" })).toBe(
      true,
    );
    expect(isSubscriptionLive(terminatedPush)).toBe(false);
  });

  it("offers a resume only where the engine would accept one", () => {
    expect(canResumeSubscription(activePoll)).toBe(false);
    expect(canResumeSubscription({ ...activePoll, status: "stopped" })).toBe(
      true,
    );
    expect(canResumeSubscription(terminatedPush)).toBe(true);
    expect(canResumeSubscription(forbiddenPoll)).toBe(false);
  });

  it("filters the log to one subscription", () => {
    expect(filterEventLog(eventLog, undefined)).toBe(eventLog);
    expect(
      filterEventLog(eventLog, reconnectingPush.id).map((e) => e.seq),
    ).toEqual([4, 5]);
  });
});
