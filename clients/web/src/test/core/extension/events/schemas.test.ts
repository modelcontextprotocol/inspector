import { describe, it, expect } from "vitest";
import {
  EventTypeSchema,
  EventOccurrenceSchema,
  EventsActiveNotificationParamsSchema,
  EventsErrorNotificationParamsSchema,
  EventsEventNotificationParamsSchema,
  EventsHeartbeatNotificationParamsSchema,
  EventsListChangedNotificationParamsSchema,
  EventsTerminatedNotificationParamsSchema,
  ListEventsResultSchema,
  PollEventsResultSchema,
  StreamEventsResultSchema,
  SubscribeEventsResultSchema,
  UnsubscribeEventsResultSchema,
  knownDeliveryModes,
  normalizeCursor,
  subscriptionIdOf,
  type EventType,
} from "@inspector/core/extension/events/schemas.js";
import { EVENTS_SUBSCRIPTION_ID_META_KEY } from "@inspector/core/extension/events/constants.js";

const EMAIL: EventType = {
  name: "email.received",
  description: "Fires when a new email arrives",
  delivery: ["poll"],
  inputSchema: { type: "object", properties: { from: { type: "string" } } },
  payloadSchema: { type: "object" },
};

const META = { [EVENTS_SUBSCRIPTION_ID_META_KEY]: 1 };

describe("events schemas (#3028)", () => {
  it("parses the spec's events/list example", () => {
    const result = ListEventsResultSchema.parse({
      events: [
        EMAIL,
        {
          name: "incident.created",
          delivery: ["webhook", "push", "poll"],
          inputSchema: { type: "object" },
          payloadSchema: {},
          _meta: { a: 1 },
        },
      ],
      nextCursor: "2",
    });
    expect(result.events.map((e) => e.name)).toEqual([
      "email.received",
      "incident.created",
    ]);
    expect(result.nextCursor).toBe("2");
  });

  it("keeps an unknown delivery mode but refuses an empty delivery list", () => {
    expect(
      EventTypeSchema.safeParse({ ...EMAIL, delivery: ["carrier-pigeon"] })
        .success,
    ).toBe(true);
    expect(EventTypeSchema.safeParse({ ...EMAIL, delivery: [] }).success).toBe(
      false,
    );
  });

  it("requires name and inputSchema", () => {
    expect(
      EventTypeSchema.safeParse({ delivery: ["poll"], inputSchema: {} })
        .success,
    ).toBe(false);
    expect(
      EventTypeSchema.safeParse({ name: "x", delivery: ["poll"] }).success,
    ).toBe(false);
  });

  it("knownDeliveryModes drops modes this client does not know", () => {
    expect(
      knownDeliveryModes({ ...EMAIL, delivery: ["push", "sms", "poll"] }),
    ).toEqual(["push", "poll"]);
  });

  it("an occurrence's cursor may be absent, null or a string", () => {
    const base = {
      eventId: "evt_1",
      name: "email.received",
      timestamp: "2026-02-19T15:30:00Z",
      data: { subject: "hi" },
    };
    expect(EventOccurrenceSchema.parse(base).cursor).toBeUndefined();
    expect(EventOccurrenceSchema.parse({ ...base, cursor: null }).cursor).toBe(
      null,
    );
    expect(EventOccurrenceSchema.parse({ ...base, cursor: "c" }).cursor).toBe(
      "c",
    );
    expect(
      EventOccurrenceSchema.safeParse({ ...base, data: "not an object" })
        .success,
    ).toBe(false);
  });

  it("parses a poll result and types the fields a runner branches on", () => {
    const ok = {
      events: [],
      cursor: "historyId_99842",
      truncated: false,
      hasMore: false,
      nextPollMs: 30000,
    };
    expect(PollEventsResultSchema.parse(ok).nextPollMs).toBe(30000);
    expect(
      PollEventsResultSchema.safeParse({ ...ok, hasMore: "no" }).success,
    ).toBe(false);
    expect(
      PollEventsResultSchema.safeParse({ ...ok, nextPollMs: -1 }).success,
    ).toBe(false);
  });

  it("parses subscribe results with and without a delivery status", () => {
    const base = {
      id: "sub_a3f1",
      refreshBefore: "2026-02-19T16:30:00Z",
      cursor: "c",
      truncated: false,
    };
    expect(SubscribeEventsResultSchema.parse(base).id).toBe("sub_a3f1");
    expect(
      SubscribeEventsResultSchema.parse({ ...base, refreshBefore: null })
        .refreshBefore,
    ).toBeNull();
    const withStatus = SubscribeEventsResultSchema.parse({
      ...base,
      deliveryStatus: {
        active: true,
        lastDeliveryAt: "2026-02-19T16:28:00Z",
        lastError: null,
        throttled: true,
        retryAfterMs: 60000,
      },
    });
    expect(withStatus.deliveryStatus?.throttled).toBe(true);
    // refreshBefore is always present (nullable, not optional).
    const missing: Partial<typeof base> = { ...base };
    delete missing.refreshBefore;
    expect(SubscribeEventsResultSchema.safeParse(missing).success).toBe(false);
  });

  it("parses the empty stream and unsubscribe results", () => {
    expect(StreamEventsResultSchema.parse({ _meta: META })).toEqual({
      _meta: META,
    });
    expect(UnsubscribeEventsResultSchema.parse({})).toEqual({});
  });

  it("parses each push notification and requires the subscription id", () => {
    expect(
      EventsActiveNotificationParamsSchema.parse({
        cursor: "c",
        truncated: false,
        heartbeatMs: 15000,
        _meta: META,
      }).heartbeatMs,
    ).toBe(15000);
    expect(
      EventsEventNotificationParamsSchema.parse({
        eventId: "e",
        name: "n",
        timestamp: "t",
        data: {},
        cursor: null,
        _meta: META,
      }).eventId,
    ).toBe("e");
    expect(
      EventsHeartbeatNotificationParamsSchema.parse({
        cursor: null,
        _meta: META,
      }).cursor,
    ).toBeNull();
    const error = {
      error: { code: -32024, message: "Forbidden", data: { reason: "x" } },
      _meta: META,
    };
    expect(EventsErrorNotificationParamsSchema.parse(error).error.code).toBe(
      -32024,
    );
    expect(
      EventsTerminatedNotificationParamsSchema.parse(error).error.message,
    ).toBe("Forbidden");
    expect(
      EventsHeartbeatNotificationParamsSchema.safeParse({ cursor: "c" })
        .success,
    ).toBe(false);
  });

  it("list_changed params are optional", () => {
    expect(EventsListChangedNotificationParamsSchema.parse(undefined)).toBe(
      undefined,
    );
    expect(EventsListChangedNotificationParamsSchema.parse({})).toEqual({});
  });

  it("normalizeCursor folds absent into null", () => {
    expect(normalizeCursor(undefined)).toBeNull();
    expect(normalizeCursor(null)).toBeNull();
    expect(normalizeCursor("c")).toBe("c");
  });

  it("subscriptionIdOf reads a string or numeric id and nothing else", () => {
    expect(subscriptionIdOf({ _meta: META })).toBe(1);
    expect(
      subscriptionIdOf({ _meta: { [EVENTS_SUBSCRIPTION_ID_META_KEY]: "s" } }),
    ).toBe("s");
    expect(
      subscriptionIdOf({ _meta: { [EVENTS_SUBSCRIPTION_ID_META_KEY]: {} } }),
    ).toBeUndefined();
    expect(subscriptionIdOf({ _meta: null })).toBeUndefined();
    expect(subscriptionIdOf({})).toBeUndefined();
    expect(subscriptionIdOf(null)).toBeUndefined();
    expect(subscriptionIdOf("x")).toBeUndefined();
  });
});
