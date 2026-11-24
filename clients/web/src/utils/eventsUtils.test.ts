import { describe, it, expect } from "vitest";
import {
  SUBSCRIBABLE_DELIVERY_MODES,
  buildSubscribeOptions,
  callbackUrlError,
  canResumeSubscription,
  describeDeliveryStatus,
  describeEventsError,
  describeWebhookError,
  describeWebhookFailure,
  formatRefreshBefore,
  formatTtlSuggestion,
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
  unknownModeType,
  webhookOnlyType,
} from "../test/fixtures/events";

describe("subscribable modes (#3031)", () => {
  it("offers all three modes", () => {
    expect(SUBSCRIBABLE_DELIVERY_MODES).toEqual(["poll", "push", "webhook"]);
  });

  it("keeps the advertised subscribable modes in the server's order", () => {
    expect(subscribableModes(allModesType)).toEqual([
      "poll",
      "push",
      "webhook",
    ]);
    expect(
      subscribableModes({ ...allModesType, delivery: ["push", "poll"] }),
    ).toEqual(["push", "poll"]);
    expect(subscribableModes(webhookOnlyType)).toEqual(["webhook"]);
    expect(subscribableModes(unknownModeType)).toEqual([]);
    expect(
      subscribableModes({ ...pollOnlyType, delivery: ["poll", "pigeon"] }),
    ).toEqual(["poll"]);
  });

  it("resolves the preferred mode when offered, else the first", () => {
    expect(resolveSubscribeMode(allModesType, "push")).toBe("push");
    expect(resolveSubscribeMode(pollOnlyType, "push")).toBe("poll");
    expect(resolveSubscribeMode(pollOnlyType, undefined)).toBe("poll");
    expect(resolveSubscribeMode(webhookOnlyType, "poll")).toBe("webhook");
    expect(resolveSubscribeMode(unknownModeType, "poll")).toBeUndefined();
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

describe("webhook options (#3031)", () => {
  it("sends the trimmed URL, the secret and only the webhook tuning", () => {
    expect(
      buildSubscribeOptions(
        "webhook",
        { a: 1 },
        {
          callbackUrl: "  https://hooks.example.com/in ",
          ttlMs: 60000,
          maxAgeMs: 5,
          maxEvents: 3,
          heartbeatMs: 4,
        },
        "whsec_x",
      ),
    ).toEqual({
      mode: "webhook",
      arguments: { a: 1 },
      maxAgeMs: 5,
      webhook: {
        url: "https://hooks.example.com/in",
        secret: "whsec_x",
        ttlMs: 60000,
      },
    });
  });

  it("sends ttlMs: null for no expiry, and omits an unset TTL and secret", () => {
    expect(
      buildSubscribeOptions("webhook", {}, { noExpiry: true, ttlMs: 9 }),
    ).toEqual({
      mode: "webhook",
      arguments: {},
      webhook: { url: "", ttlMs: null },
    });
    expect(buildSubscribeOptions("webhook", {}, {})).toEqual({
      mode: "webhook",
      arguments: {},
      webhook: { url: "" },
    });
    // The secret belongs to webhook only.
    expect(buildSubscribeOptions("poll", {}, {}, "whsec_x")).toEqual({
      mode: "poll",
      arguments: {},
    });
  });

  it("explains a callback URL that cannot be used", () => {
    expect(callbackUrlError(undefined)).toBeUndefined();
    expect(callbackUrlError("  ")).toBeUndefined();
    expect(callbackUrlError("https://hooks.example.com")).toBeUndefined();
    expect(callbackUrlError("nope")).toBe("Not a valid URL.");
    expect(callbackUrlError("http://hooks.example.com")).toMatch(
      /must use https/,
    );
  });

  it("needs an https callback URL", () => {
    expect(isTuningValid("webhook", {})).toBe(false);
    expect(isTuningValid("webhook", { callbackUrl: " " })).toBe(false);
    expect(isTuningValid("webhook", { callbackUrl: "http://x.example" })).toBe(
      false,
    );
    expect(
      isTuningValid("webhook", { callbackUrl: "https://x.example/in" }),
    ).toBe(true);
  });

  it("spells out a CallbackEndpointError reason", () => {
    expect(
      describeWebhookError({
        code: -32027,
        message: "verify failed",
        data: { reason: "challenge_failed" },
      }),
    ).toMatch(
      /^The server could not verify the callback endpoint \(challenge_failed\): the endpoint did not echo the verification challenge/,
    );
    expect(
      describeWebhookError({ code: -32027, message: "verify failed" }),
    ).toBe(
      "-32027 CallbackEndpointError: verify failed. The server could not verify the callback endpoint.",
    );
    expect(
      describeWebhookError({
        code: -32027,
        message: "x",
        data: { reason: 5 },
      }),
    ).toMatch(/could not verify the callback endpoint\.$/);
    expect(
      describeWebhookError({ code: -32027, message: "x", data: "flat" }),
    ).toMatch(/could not verify the callback endpoint\.$/);
  });

  it("says Forbidden means an authenticated principal is needed", () => {
    expect(
      describeWebhookError({ code: -32024, message: "Forbidden" }),
    ).toMatch(
      /^-32024 Forbidden: Forbidden\. Webhook subscriptions need an authenticated principal/,
    );
  });

  it("reads any other error as describeEventsError does", () => {
    expect(describeWebhookError({ code: -32602, message: "bad" })).toBe(
      "-32602: bad",
    );
  });

  it("describes every failure category, and an unknown one verbatim", () => {
    for (const category of [
      "connection_refused",
      "timeout",
      "tls_error",
      "http_4xx",
      "http_5xx",
      "challenge_failed",
    ]) {
      expect(describeWebhookFailure(category)).not.toBe(category);
    }
    expect(describeWebhookFailure("dns_error")).toBe("dns_error");
  });

  it("formats the grant and the suggestion", () => {
    expect(formatRefreshBefore(undefined)).toBe("not granted yet");
    expect(formatRefreshBefore(null)).toBe("never (no expiry)");
    expect(formatRefreshBefore("2026-11-24T11:00:00Z")).toBe(
      "2026-11-24T11:00:00Z",
    );
    expect(formatTtlSuggestion(undefined)).toBe("server default");
    expect(formatTtlSuggestion(null)).toBe("no expiry");
    expect(formatTtlSuggestion(3_600_000)).toBe("60 min");
  });

  it("describes a deliveryStatus, line by reported field", () => {
    expect(describeDeliveryStatus({ active: true })).toEqual(["Delivering"]);
    expect(
      describeDeliveryStatus({
        active: false,
        lastError: "http_4xx",
        failedSince: "T1",
        lastDeliveryAt: "T0",
      }),
    ).toEqual([
      "Suspended after repeated failures (this refresh reactivated it)",
      "Last error: http_4xx — the endpoint answered with a 4xx status",
      "Failing since T1",
      "Last delivery T0",
    ]);
    expect(
      describeDeliveryStatus({
        active: true,
        lastError: null,
        throttled: true,
        retryAfterMs: 60_000,
      }),
    ).toEqual([
      "Delivering",
      "Throttled: deliveries delayed, not failing (about 1 min)",
    ]);
    expect(describeDeliveryStatus({ active: true, throttled: true })).toEqual([
      "Delivering",
      "Throttled: deliveries delayed, not failing",
    ]);
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
