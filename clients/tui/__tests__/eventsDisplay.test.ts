import { describe, it, expect } from "vitest";
import type {
  EventLogEntry,
  EventSubscription,
} from "@inspector/core/mcp/state/index.js";
import {
  escapeControls,
  eventLogLine,
  eventTypeRows,
  isLiveSubscription,
  subscriptionStatusColor,
  subscriptionSummary,
  terminationText,
} from "../src/utils/eventsDisplay.js";

const NO_COUNTS = {
  events: 0,
  duplicates: 0,
  invalidPayloads: 0,
  gaps: 0,
  errors: 0,
  reconnects: 0,
};

const subscription = (
  over: Partial<EventSubscription> = {},
): EventSubscription => ({
  id: "key",
  name: "incident.created",
  mode: "push",
  arguments: {},
  eventType: {
    name: "incident.created",
    delivery: ["push"],
    inputSchema: { type: "object" },
  },
  status: "active",
  cursor: "cur_3",
  startedAt: new Date(0),
  counts: NO_COUNTS,
  ...over,
});

const error = {
  code: -32023,
  message: "gone https://x.example/cb?code=secret",
};

describe("isLiveSubscription / subscriptionStatusColor", () => {
  it("treats starting, active and reconnecting as live", () => {
    for (const status of ["starting", "active", "reconnecting"] as const) {
      expect(isLiveSubscription(subscription({ status }))).toBe(true);
    }
    for (const status of ["stopped", "terminated"] as const) {
      expect(isLiveSubscription(subscription({ status }))).toBe(false);
    }
  });

  it("colors each status", () => {
    expect(subscriptionStatusColor("active")).toBe("green");
    expect(subscriptionStatusColor("terminated")).toBe("red");
    expect(subscriptionStatusColor("stopped")).toBe("gray");
  });
});

describe("subscriptionSummary", () => {
  it("names the push heartbeat and a single event", () => {
    expect(
      subscriptionSummary(
        subscription({
          grantedHeartbeatMs: 30000,
          counts: { ...NO_COUNTS, events: 1 },
        }),
      ),
    ).toBe("push · active · cursor cur_3 · heartbeat 30000ms · 1 event");
  });

  it("names the poll interval, every non-zero count, and the arguments", () => {
    expect(
      subscriptionSummary(
        subscription({
          mode: "poll",
          cursor: null,
          nextPollMs: 1000,
          arguments: { region: "eu" },
          counts: {
            events: 2,
            duplicates: 1,
            invalidPayloads: 1,
            gaps: 1,
            errors: 1,
            reconnects: 1,
          },
        }),
      ),
    ).toBe(
      'poll · active · cursor null · next poll 1000ms · 2 events · 1 gap(s) · 1 error(s) · 1 reconnect(s) · 1 duplicate(s) · 1 invalid payload(s) · args {"region":"eu"}',
    );
  });
});

describe("terminationText", () => {
  const termination = {
    reason: "removed" as const,
    error,
    at: new Date(0),
    canResubscribe: false,
  };

  it("is undefined while the subscription has not ended", () => {
    expect(terminationText(subscription())).toBeUndefined();
  });

  it.each([
    ["pending", "; re-listing event types…"],
    ["failed", "; re-listing failed"],
    ["skipped", ""],
  ] as const)("describes a %s re-list", (relist, suffix) => {
    const text = terminationText(
      subscription({ termination: { ...termination, relist } }),
    );
    expect(text).toMatch(/^Terminated \(removed\): gone /);
    expect(text).not.toContain("secret");
    expect(text!.endsWith(suffix)).toBe(true);
  });

  it("says when the type is gone, and nothing when it can be resumed", () => {
    expect(
      terminationText(
        subscription({ termination: { ...termination, relist: "done" } }),
      ),
    ).toContain("no longer offered");
    expect(
      terminationText(
        subscription({
          termination: { ...termination, relist: "done", canResubscribe: true },
        }),
      ),
    ).not.toContain("no longer offered");
  });
});

describe("eventLogLine", () => {
  const at = new Date("2026-11-24T10:11:12.000Z");
  const base = { seq: 1, at, subscription: "key" };
  const occurrence = {
    eventId: "e1",
    name: "incident.created",
    timestamp: "t",
    data: { title: "\u001b[2Jboom" },
  };

  it("shows an occurrence's data as escaped JSON", () => {
    const line = eventLogLine({ ...base, kind: "event", occurrence });
    expect(line).toEqual({
      text: '10:11:12 e1 {"title":"\\u001b[2Jboom"}',
    });
  });

  it.each<[EventLogEntry, string, string]>([
    [
      { ...base, kind: "event", occurrence, payloadError: "missing x" },
      "payload does not match its schema: missing x",
      "yellow",
    ],
    [
      { ...base, kind: "gap", cursor: null },
      "resuming at cursor null",
      "yellow",
    ],
    [{ ...base, kind: "error", error }, "error -32023: gone", "red"],
    [
      { ...base, kind: "reconnect", reason: "stream ended" },
      "reconnecting: stream ended",
      "gray",
    ],
    [
      { ...base, kind: "terminated", reason: "removed", error },
      "terminated (removed): gone",
      "red",
    ],
  ])("frames entry %#", (entry, text, color) => {
    const line = eventLogLine(entry);
    expect(line.text).toContain(text);
    expect(line.text).not.toContain("secret");
    expect(line.color).toBe(color);
  });
});

describe("escapeControls", () => {
  it("escapes C0, DEL and C1 controls, and leaves JSON escapes alone", () => {
    expect(escapeControls("a\u009b31mb\u0007c\u007f")).toBe(
      "a\\u009b31mb\\u0007c\\u007f",
    );
    expect(escapeControls('{"x":"\\u001b"}')).toBe('{"x":"\\u001b"}');
  });

  it("is applied to log lines and summaries built from server text", () => {
    const at = new Date(0);
    const line = eventLogLine({
      seq: 1,
      at,
      subscription: "key",
      kind: "event",
      occurrence: {
        eventId: "e\u009b1",
        name: "t",
        timestamp: "t",
        data: { s: "\u009b2J" },
      },
    });
    expect(line.text).not.toMatch(/[\u0080-\u009f]/);
    expect(subscriptionSummary(subscription({ cursor: "c\u009b" }))).toContain(
      "cursor c\\u009b",
    );
  });
});

describe("eventTypeRows", () => {
  it("keeps a type the catalog dropped while a subscription refers to it", () => {
    const listed = subscription().eventType;
    const gone = {
      ...subscription({ id: "gone", name: "old.type" }),
      eventType: { ...listed, name: "old.type" },
    };
    expect(
      eventTypeRows([listed], [subscription(), gone, gone]).map((r) => [
        r.eventType.name,
        r.listed,
      ]),
    ).toEqual([
      ["incident.created", true],
      ["old.type", false],
    ]);
  });
});
