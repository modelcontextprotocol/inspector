/**
 * Shared Events fixtures (SEP-3415, #3030) for the Events tab's tests and
 * stories: event types shaped like the `events-modern-http` test server's, and
 * subscriptions and log entries in every state the engine reports.
 */
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import type {
  EventLogEntry,
  EventSubscription,
} from "@inspector/core/mcp/state/eventSubscriptionsState.js";

export const pollOnlyType: EventType = {
  name: "email.received",
  description: "Fires when a new email arrives in the inbox (poll only)",
  delivery: ["poll"],
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Only mail from this sender" },
    },
  },
  payloadSchema: {
    type: "object",
    properties: {
      messageId: { type: "string" },
      from: { type: "string" },
      subject: { type: "string" },
    },
    required: ["messageId", "from", "subject"],
  },
};

export const allModesType: EventType = {
  name: "incident.created",
  description: "Fires when a new incident is created (poll, push and webhook)",
  delivery: ["poll", "push", "webhook"],
  inputSchema: {
    type: "object",
    properties: {
      severity: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
      service: { type: "string" },
    },
  },
  payloadSchema: {
    type: "object",
    properties: {
      incidentId: { type: "string" },
      title: { type: "string" },
    },
    required: ["incidentId", "title"],
  },
};

export const headerAnnotatedType: EventType = {
  name: "deploy.completed",
  description:
    "Fires when a deploy completes; `region` is mirrored into Mcp-Param-Region",
  delivery: ["poll", "push"],
  inputSchema: {
    type: "object",
    properties: {
      region: {
        type: "string",
        description: "Deploy region",
        "x-mcp-header": "Region",
      },
      env: { type: "string" },
    },
    required: ["region"],
  },
};

export const webhookOnlyType: EventType = {
  name: "payment.settled",
  delivery: ["webhook"],
  inputSchema: { type: "object" },
};

export const eventTypes: EventType[] = [
  pollOnlyType,
  allModesType,
  headerAnnotatedType,
  webhookOnlyType,
];

const counts = {
  events: 3,
  duplicates: 0,
  invalidPayloads: 1,
  gaps: 1,
  errors: 0,
  reconnects: 0,
};

export const activePoll: EventSubscription = {
  id: "email.received\u0000{}\u0000poll",
  name: "email.received",
  mode: "poll",
  arguments: {},
  eventType: pollOnlyType,
  status: "active",
  cursor: "c-42",
  nextPollMs: 5000,
  startedAt: new Date("2026-11-24T10:00:00Z"),
  counts,
};

export const reconnectingPush: EventSubscription = {
  id: 'incident.created\u0000{"severity":"P1"}\u0000push',
  name: "incident.created",
  mode: "push",
  arguments: { severity: "P1" },
  eventType: allModesType,
  status: "reconnecting",
  cursor: null,
  subscriptionId: 7,
  grantedHeartbeatMs: 30000,
  startedAt: new Date("2026-11-24T10:00:00Z"),
  counts: { ...counts, reconnects: 2, errors: 1 },
  lastError: { code: -32603, message: "stream dropped" },
};

export const terminatedPush: EventSubscription = {
  id: "deploy.completed\u0000{}\u0000push",
  name: "deploy.completed",
  mode: "push",
  arguments: {},
  eventType: headerAnnotatedType,
  status: "terminated",
  cursor: "c-9",
  startedAt: new Date("2026-11-24T10:00:00Z"),
  counts,
  termination: {
    reason: "removed",
    error: { code: -32023, message: "Event type removed" },
    at: new Date("2026-11-24T10:05:00Z"),
    relist: "done",
    canResubscribe: true,
  },
};

export const forbiddenPoll: EventSubscription = {
  ...activePoll,
  id: "email.received\u0000{}\u0000poll#forbidden",
  status: "terminated",
  termination: {
    reason: "forbidden",
    error: { code: -32024, message: "Access revoked" },
    at: new Date("2026-11-24T10:05:00Z"),
    relist: "skipped",
    canResubscribe: false,
  },
};

export const subscriptions: EventSubscription[] = [
  activePoll,
  reconnectingPush,
  terminatedPush,
];

const at = new Date("2026-11-24T10:01:00Z");

export const eventLog: EventLogEntry[] = [
  {
    seq: 1,
    at,
    subscription: activePoll.id,
    kind: "event",
    occurrence: {
      eventId: "e1",
      name: "email.received",
      timestamp: "2026-11-24T10:01:00Z",
      data: {
        messageId: "msg_1",
        from: "alerts@example.com",
        subject: "<b>not bold</b>",
      },
      cursor: "c-41",
    },
  },
  {
    seq: 2,
    at,
    subscription: activePoll.id,
    kind: "event",
    occurrence: {
      eventId: "e2",
      name: "email.received",
      timestamp: "2026-11-24T10:01:05Z",
      data: { messageId: "msg_2" },
    },
    payloadError: "data must have required property 'from'",
  },
  { seq: 3, at, subscription: activePoll.id, kind: "gap", cursor: "c-42" },
  {
    seq: 4,
    at,
    subscription: reconnectingPush.id,
    kind: "error",
    error: { code: -32025, message: "Too many streams" },
  },
  {
    seq: 5,
    at,
    subscription: reconnectingPush.id,
    kind: "reconnect",
    reason: "no heartbeat for 90 s",
  },
  {
    seq: 6,
    at,
    subscription: terminatedPush.id,
    kind: "terminated",
    reason: "removed",
    error: { code: -32023, message: "Event type removed" },
  },
  {
    seq: 7,
    at,
    subscription: "gone\u0000{}\u0000poll",
    kind: "event",
    occurrence: {
      eventId: "e3",
      name: "gone",
      timestamp: "2026-11-24T10:01:09Z",
      data: {},
    },
  },
];
