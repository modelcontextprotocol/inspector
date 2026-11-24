/**
 * Events extension test fixture — SEP-3415 (`io.modelcontextprotocol/events`,
 * Beta).
 *
 * Neither SDK implements Events, so this module implements the server half
 * directly against the spec (`ext-events/specification/beta/events/events.mdx`):
 * `events/list` (paginated), `events/poll`, `events/stream` (push over SSE),
 * `events/subscribe` / `events/unsubscribe` (webhook management only — no
 * outbound delivery is ever made), and `notifications/events/list_changed` on a
 * `subscriptions/listen` stream that opted in with `eventsListChanged: true`.
 *
 * **It is served as Express middleware, not as SDK request handlers.** On the
 * 2026-07-28 leg the SDK builds a fresh `McpServer` per request, so anything
 * stateful (the occurrence log, open push streams, webhook subscriptions) has
 * to live outside it — in one {@link EventsRuntime} shared by every request,
 * the way `ModernTaskRuntime` is. And `events/stream` is a request that never
 * completes on its own: answering it from middleware owns the SSE response
 * outright, so the fixture controls exactly when each `notifications/events/*`
 * frame is written and sees the client's abort as the response closing, with
 * no SDK request timeout or in-flight bookkeeping in the way.
 *
 * `subscriptions/listen` is intercepted **only** when the filter asks for
 * `eventsListChanged`. The SDK's listen router does not know that field — it
 * drops it from the honored subset, and a listen asking for nothing else would
 * be acknowledged and closed in the same breath — so such a listen is served
 * here instead, honoring the core fields too (from the SDK's event bus, which
 * the HTTP harness shares with this runtime). Every other listen falls through
 * to the SDK untouched.
 *
 * **Era.** The extension is defined for 2026-07-28 and later only, so it is
 * advertised only to a modern `server/discover` (see `createMcpServer`). An
 * `events/*` request without a modern per-request envelope is answered `-32601`
 * and **counted** (`get_event_stats.legacyRequests`), which is what makes the
 * legacy showcase config a test that the Inspector never sends one.
 *
 * ⚠️ Deliberate deviations from a production server, each documented where it
 * lives: webhook subscribe accepts an unauthenticated caller (principal
 * `"anonymous"`) instead of answering `Forbidden`, and the callback endpoint is
 * never contacted — verification and delivery outcomes are canned from the
 * URL (see {@link callbackEndpointFailure} and {@link cannedDeliveryStatus}).
 *
 * Deliberately self-contained: it does not import the Inspector's own events
 * schemas (`core/extension/events/`), because a fixture that validated itself
 * against the client's schema could never catch the client being wrong.
 */

import { createHash } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import * as z from "zod/v4";
import {
  InMemoryServerEventBus,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
  SUBSCRIPTION_ID_META_KEY,
} from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  ServerCapabilities,
} from "@modelcontextprotocol/server";

// ---------------------------------------------------------------------------
// Wire constants
// ---------------------------------------------------------------------------

/** The extension identifier (SEP-2133 `capabilities.extensions` key). */
export const EVENTS_EXTENSION_KEY = "io.modelcontextprotocol/events";

/** First protocol revision the extension is defined for. */
export const EVENTS_MIN_PROTOCOL_VERSION = "2026-07-28";

/** Error codes the extension uses (spec §Error Handling). */
export const EVENTS_ERROR_CODES = {
  InvalidParams: -32602,
  MethodNotFound: -32601,
  HeaderMismatch: -32020,
  NotFound: -32023,
  Forbidden: -32024,
  ResourceExhausted: -32025,
  Unsupported: -32026,
  CallbackEndpointError: -32027,
} as const;

/** Every `events/*` request method, in spec order. */
export const EVENTS_METHODS = [
  "events/list",
  "events/poll",
  "events/stream",
  "events/subscribe",
  "events/unsubscribe",
] as const;
export type EventsMethod = (typeof EVENTS_METHODS)[number];

/**
 * Entries per `events/list` page. Two, so the five built-in types span three
 * pages: a client that stops after page one sees under half the set.
 */
export const EVENTS_PAGE_SIZE = 2;

/** Server default and ceiling for `events/poll` `maxEvents`. */
export const DEFAULT_MAX_EVENTS = 10;
export const MAX_MAX_EVENTS = 100;

/** Heartbeat grant bounds (ms). A suggestion outside them is clamped. */
export const DEFAULT_HEARTBEAT_MS = 30_000;
export const MIN_HEARTBEAT_MS = 100;
export const MAX_HEARTBEAT_MS = 60_000;

/** Webhook TTL grant: default, clamp-up floor and clamp-down ceiling (ms). */
export const DEFAULT_WEBHOOK_TTL_MS = 3_600_000;
export const MIN_WEBHOOK_TTL_MS = 60_000;
export const MAX_WEBHOOK_TTL_MS = 86_400_000;

/** SSE comment keepalive on a listen stream this module serves. */
const LISTEN_KEEPALIVE_MS = 15_000;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type DeliveryMode = "poll" | "push" | "webhook";

export interface EventTypeDescriptor {
  name: string;
  description: string;
  delivery: DeliveryMode[];
  inputSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

interface EventType {
  descriptor: EventTypeDescriptor;
  /**
   * `false` for an emit-only type with no addressable history: its cursor is
   * **omitted** everywhere (absent is the same as `null`), it is never
   * replayed, and `truncated` is always `false`.
   */
  replay: boolean;
  /** Payload for an occurrence emitted without explicit `data`. */
  defaultData: (seq: number) => Record<string, unknown>;
}

/** Stable names of the built-in event types. */
export const EVENT_TYPE_NAMES = {
  /** `delivery: ["poll"]`. */
  pollOnly: "email.received",
  /** `delivery: ["push"]`, emit-only (no replay, cursor always omitted). */
  pushOnly: "build.finished",
  /** `delivery: ["poll", "push", "webhook"]`. */
  allModes: "incident.created",
  /** `delivery: ["poll", "push"]`, `region` carries `x-mcp-header: "Region"`. */
  headerAnnotated: "deploy.completed",
  /** An INVALID `x-mcp-header` annotation — a client MUST exclude it. */
  invalidHeader: "invalid.header",
  /** The default name `add_event_type` adds. */
  dynamic: "dynamic.added",
} as const;

function builtInEventTypes(): EventType[] {
  return [
    {
      descriptor: {
        name: EVENT_TYPE_NAMES.pollOnly,
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
      },
      replay: true,
      defaultData: (seq) => ({
        messageId: `msg_${seq}`,
        from: "alerts@example.com",
        subject: `Synthetic email ${seq}`,
      }),
    },
    {
      descriptor: {
        name: EVENT_TYPE_NAMES.pushOnly,
        description:
          "Fires when a CI build finishes (push only, emit-only: no replay)",
        delivery: ["push"],
        inputSchema: {
          type: "object",
          properties: {
            branch: { type: "string", description: "Only builds of a branch" },
          },
        },
        payloadSchema: {
          type: "object",
          properties: {
            buildId: { type: "string" },
            branch: { type: "string" },
            status: { type: "string", enum: ["passed", "failed"] },
          },
          required: ["buildId", "branch", "status"],
        },
      },
      replay: false,
      defaultData: (seq) => ({
        buildId: `build_${seq}`,
        branch: "main",
        status: "passed",
      }),
    },
    {
      descriptor: {
        name: EVENT_TYPE_NAMES.allModes,
        description:
          "Fires when a new incident is created (poll, push and webhook)",
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
            severity: { type: "string" },
            service: { type: "string" },
          },
          required: ["incidentId", "title", "severity", "service"],
        },
        _meta: { "example.com/owner": "sre" },
      },
      replay: true,
      defaultData: (seq) => ({
        incidentId: `INC-${seq}`,
        title: `Synthetic incident ${seq}`,
        severity: "P1",
        service: "api",
      }),
    },
    {
      descriptor: {
        name: EVENT_TYPE_NAMES.headerAnnotated,
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
        },
        payloadSchema: {
          type: "object",
          properties: {
            deployId: { type: "string" },
            region: { type: "string" },
            env: { type: "string" },
          },
          required: ["deployId", "region", "env"],
        },
      },
      replay: true,
      defaultData: (seq) => ({
        deployId: `dep_${seq}`,
        region: "us-west1",
        env: "prod",
      }),
    },
    {
      descriptor: {
        name: EVENT_TYPE_NAMES.invalidHeader,
        description:
          "Carries an invalid x-mcp-header (not an RFC 9110 token); a client MUST exclude it",
        delivery: ["poll"],
        inputSchema: {
          type: "object",
          properties: {
            tenant: { type: "string", "x-mcp-header": "Bad Header" },
          },
        },
        payloadSchema: { type: "object" },
      },
      replay: true,
      defaultData: (seq) => ({ seq }),
    },
  ];
}

function dynamicEventType(
  name: string,
  delivery: DeliveryMode[],
  description: string,
): EventType {
  return {
    descriptor: {
      name,
      description,
      delivery,
      inputSchema: { type: "object", properties: {} },
      payloadSchema: {
        type: "object",
        properties: { seq: { type: "integer" } },
        required: ["seq"],
      },
    },
    replay: true,
    defaultData: (seq) => ({ seq }),
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A JSON-RPC error the fixture answers with (`httpStatus` defaults to 200). */
export class EventsRpcError extends Error {
  readonly code: number;
  readonly data?: Record<string, unknown>;
  readonly httpStatus: number;

  constructor(
    code: number,
    message: string,
    data?: Record<string, unknown>,
    httpStatus = 200,
  ) {
    super(message);
    this.code = code;
    this.data = data;
    this.httpStatus = httpStatus;
  }

  toJson(): { code: number; message: string; data?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      ...(this.data !== undefined ? { data: this.data } : {}),
    };
  }
}

const invalidParams = (message: string, data?: Record<string, unknown>) =>
  new EventsRpcError(EVENTS_ERROR_CODES.InvalidParams, message, data);
const notFoundEvent = (name: string) =>
  new EventsRpcError(
    EVENTS_ERROR_CODES.NotFound,
    `Unknown event type: ${name}`,
    { kind: "event" },
  );

/**
 * Failure presets `inject_event_failure` arms. Stable names — tests key off
 * them. `error_*` presets fail the next matching `events/*` request once with
 * the named code; the others act on open subscriptions immediately.
 */
export const EVENT_FAILURE_PRESETS = [
  "error_invalid_params",
  "error_not_found",
  "error_forbidden",
  "error_resource_exhausted",
  "error_unsupported",
  "error_callback_endpoint",
  "terminate_forbidden",
  "terminate_schema_changed",
  "stream_error",
  "gap",
  "backlog",
] as const;
export type EventFailurePreset = (typeof EVENT_FAILURE_PRESETS)[number];

function presetError(preset: EventFailurePreset): EventsRpcError {
  switch (preset) {
    case "error_invalid_params":
      return invalidParams("Injected InvalidParams");
    case "error_not_found":
      return new EventsRpcError(EVENTS_ERROR_CODES.NotFound, "NotFound", {
        kind: "event",
      });
    case "error_forbidden":
    case "terminate_forbidden":
      return new EventsRpcError(EVENTS_ERROR_CODES.Forbidden, "Forbidden", {
        reason: "Access revoked",
      });
    case "error_resource_exhausted":
      return new EventsRpcError(
        EVENTS_ERROR_CODES.ResourceExhausted,
        "ResourceExhausted",
        { limit: "subscriptions", max: 0 },
      );
    case "error_unsupported":
      return new EventsRpcError(EVENTS_ERROR_CODES.Unsupported, "Unsupported", {
        feature: "deliveryMode",
        value: "push",
      });
    case "terminate_schema_changed":
      return new EventsRpcError(EVENTS_ERROR_CODES.Unsupported, "Unsupported", {
        feature: "payloadSchema",
        reason: "schema_changed",
      });
    case "error_callback_endpoint":
      return new EventsRpcError(
        EVENTS_ERROR_CODES.CallbackEndpointError,
        "CallbackEndpointError",
        { reason: "challenge_failed" },
      );
    default:
      return new EventsRpcError(-32603, "UpstreamError", {
        reason: "Injected transient upstream failure",
      });
  }
}

// ---------------------------------------------------------------------------
// Cursors, arguments, headers
// ---------------------------------------------------------------------------

/** `cur_<n>`: everything with sequence number `< n` has been seen. */
function encodeCursor(position: number): string {
  return `cur_${position}`;
}

function decodeCursor(cursor: string): number {
  const match = /^cur_(\d+)$/.exec(cursor);
  if (!match) throw invalidParams(`Invalid cursor: ${cursor}`);
  return Number(match[1]);
}

type Args = Record<string, unknown>;

/**
 * Validate `arguments` against an event type's `inputSchema`: an object whose
 * every key is a declared property of the declared primitive type (and in its
 * `enum`, when one is given). Deliberately minimal — the fixture's schemas use
 * nothing richer.
 */
function validateArguments(type: EventType, raw: unknown): Args {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw invalidParams("arguments must be an object");
  }
  const properties = (type.descriptor.inputSchema.properties ?? {}) as Record<
    string,
    { type?: string; enum?: unknown[] }
  >;
  for (const [key, value] of Object.entries(raw)) {
    const prop = properties[key];
    if (!prop) {
      throw invalidParams(
        `Unknown argument for ${type.descriptor.name}: ${key}`,
      );
    }
    const ok =
      prop.type === "integer"
        ? Number.isInteger(value)
        : typeof value === prop.type;
    if (!ok || (prop.enum && !prop.enum.includes(value))) {
      throw invalidParams(`Invalid value for argument ${key}`);
    }
  }
  return raw as Args;
}

/** Canonical JSON (sorted keys) — for subscription keys. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * An occurrence matches a subscription when every argument that names a key of
 * the payload agrees with it. Arguments the payload does not carry don't
 * filter. Documented for consumers: emit with matching `data` to reach a
 * filtered subscription.
 */
function matches(args: Args, data: Record<string, unknown>): boolean {
  return Object.entries(args).every(
    ([key, value]) => !(key in data) || data[key] === value,
  );
}

const BASE64_SENTINEL = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/;

/** Decode a SEP-2243 header value (plain, or the `=?base64?…?=` sentinel). */
function decodeHeaderValue(value: string): string {
  const trimmed = value.trim();
  const sentinel = BASE64_SENTINEL.exec(trimmed);
  if (!sentinel) return trimmed;
  return Buffer.from(sentinel[1]!, "base64").toString("utf8");
}

/** `x-mcp-header` annotations of a type's top-level properties. */
function headerAnnotations(type: EventType): Array<[string, string]> {
  const properties = (type.descriptor.inputSchema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const out: Array<[string, string]> = [];
  for (const [key, schema] of Object.entries(properties)) {
    const header = schema["x-mcp-header"];
    if (typeof header === "string") out.push([key, header]);
  }
  return out;
}

const headerMismatch = (message: string) =>
  new EventsRpcError(
    EVENTS_ERROR_CODES.HeaderMismatch,
    `Bad Request: ${message}`,
    undefined,
    400,
  );

/**
 * The Streamable HTTP routing-header checks (spec §Routing Headers): every
 * `events/*` request except `events/list` MUST carry `Mcp-Name` equal to
 * `params.name`, and an `Mcp-Param-{Name}` header for each annotated argument
 * that has a value. A mismatch is HTTP 400 + `HeaderMismatch` (`-32020`).
 */
function validateRoutingHeaders(
  req: Request,
  method: EventsMethod,
  name: string,
  type: EventType | undefined,
  args: unknown,
): void {
  const methodHeader = req.header("mcp-method");
  if (methodHeader !== undefined && methodHeader.trim() !== method) {
    throw headerMismatch(
      `the Mcp-Method header names ${methodHeader} but the body names ${method}`,
    );
  }
  if (method === "events/list") return;
  const nameHeader = req.header("mcp-name");
  if (nameHeader === undefined) {
    throw headerMismatch(
      `the body carries params.name="${name}" but the required Mcp-Name header is absent`,
    );
  }
  if (decodeHeaderValue(nameHeader) !== name) {
    throw headerMismatch(
      `the Mcp-Name header names "${nameHeader}" but the body carries params.name="${name}"`,
    );
  }
  if (!type || typeof args !== "object" || args === null) return;
  for (const [key, header] of headerAnnotations(type)) {
    const value = (args as Args)[key];
    if (value === undefined || value === null) continue;
    const headerName = `Mcp-Param-${header}`;
    const sent = req.header(headerName);
    if (sent === undefined) {
      throw headerMismatch(
        `the body carries ${key}=${JSON.stringify(value)} but the ${headerName} header is absent`,
      );
    }
    if (decodeHeaderValue(sent) !== String(value)) {
      throw headerMismatch(
        `the ${headerName} header names "${sent}" but the body carries ${key}=${JSON.stringify(value)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Webhook validation (canned — nothing is ever contacted)
// ---------------------------------------------------------------------------

/** The `lastError` / `CallbackEndpointError` reason categories. */
const CALLBACK_FAILURE_REASONS = [
  "connection_refused",
  "timeout",
  "tls_error",
  "http_4xx",
  "http_5xx",
  "challenge_failed",
] as const;

/**
 * The fixture never contacts the callback URL. Instead, a URL whose **first
 * hostname label** is a reason category spelled with dashes —
 * `https://challenge-failed.example.com/hook`,
 * `https://connection-refused.example.com/hook`, … — fails verification with
 * `CallbackEndpointError` and that `data.reason`. Any other host verifies.
 */
function callbackEndpointFailure(url: URL): string | undefined {
  const label = url.hostname.split(".")[0]?.replace(/-/g, "_");
  return CALLBACK_FAILURE_REASONS.find((reason) => reason === label);
}

function isPrivateHost(hostname: string): boolean {
  let host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  // An IPv4-mapped IPv6 address (`::ffff:127.0.0.1`, which WHATWG URL
  // serializes as `::ffff:7f00:1`) is checked as the IPv4 address it embeds.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped) {
    const [hi, lo] = [parseInt(mapped[1]!, 16), parseInt(mapped[2]!, 16)];
    host = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return true;
  }
  if (/^(fc|fd|fe8|fe9|fea|feb)/.test(host) && host.includes(":")) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function validateSecret(secret: unknown): string {
  if (typeof secret !== "string" || !secret.startsWith("whsec_")) {
    throw invalidParams("delivery.secret must be a whsec_ value");
  }
  const body = secret.slice("whsec_".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body) || body.length % 4 !== 0) {
    throw invalidParams("delivery.secret must be whsec_ followed by base64");
  }
  const bytes = Buffer.from(body, "base64").length;
  if (bytes < 24 || bytes > 64) {
    throw invalidParams(
      `delivery.secret must decode to 24-64 bytes (got ${bytes})`,
    );
  }
  return secret;
}

function validateCallbackUrl(raw: unknown): URL {
  if (typeof raw !== "string") throw invalidParams("delivery.url is required");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidParams(`delivery.url is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw invalidParams("delivery.url must use https");
  }
  if (isPrivateHost(url.hostname)) {
    throw invalidParams(
      "delivery.url must resolve to a globally routable address",
    );
  }
  return url;
}

/**
 * Canned `deliveryStatus` for a **refresh** (the first subscribe returns none):
 * a URL path containing `/failing` reports suspended delivery, one containing
 * `/throttled` reports rate-limiting, anything else is healthy.
 */
function cannedDeliveryStatus(
  url: URL,
  createdAt: Date,
): Record<string, unknown> {
  const lastDeliveryAt = createdAt.toISOString();
  if (url.pathname.includes("/failing")) {
    return {
      active: false,
      lastDeliveryAt,
      lastError: "http_5xx",
      failedSince: lastDeliveryAt,
    };
  }
  if (url.pathname.includes("/throttled")) {
    return {
      active: true,
      lastDeliveryAt,
      lastError: null,
      throttled: true,
      retryAfterMs: 60_000,
    };
  }
  return { active: true, lastDeliveryAt, lastError: null };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface EventsConfig {
  /** Declare `listChanged` (default `true`). */
  listChanged?: boolean;
  /** `nextPollMs` every poll result recommends (default 1000). */
  nextPollMs?: number;
  /**
   * Also advertise the extension in a **legacy** `initialize` result. A
   * conformant server never does; the legacy showcase config sets it so that
   * the Inspector's era gate — not a missing capability — is what keeps
   * `events/*` off the wire.
   */
  advertiseOnLegacy?: boolean;
  /** Concurrent push streams before `ResourceExhausted` (default 16). */
  maxStreams?: number;
  /** Webhook subscriptions before `ResourceExhausted` (default 16). */
  maxWebhookSubscriptions?: number;
}

interface Occurrence {
  seq: number;
  eventId: string;
  name: string;
  timestamp: string;
  timeMs: number;
  data: Record<string, unknown>;
}

interface PushStream {
  id: string | number;
  name: string;
  args: Args;
  /** The granted interval, repeated on every `active` (spec §Lifecycle). */
  heartbeatMs: number;
  write: (method: string, params: Record<string, unknown>) => void;
  close: (error?: EventsRpcError) => void;
}

interface ListenStream {
  write: (method: string, params: Record<string, unknown>) => void;
}

interface WebhookSubscription {
  id: string;
  key: string;
  name: string;
  url: URL;
  createdAt: Date;
  refreshBefore: string | null;
}

interface ArmedFailure {
  preset: EventFailurePreset;
  method?: string;
  name?: string;
}

export interface EventsStats {
  /** Modern `events/*` requests received, by method. */
  requests: Record<string, number>;
  /** `events/*` requests that arrived WITHOUT a modern envelope. */
  legacyRequests: number;
  /** Requests answered with a JSON-RPC error. */
  errors: number;
  openStreams: number;
  listenStreams: number;
  webhookSubscriptions: number;
  /** Occurrences emitted so far (the log's head sequence). */
  emitted: number;
}

/**
 * Shared state for every request a server built from one config serves —
 * cached on the config (`config.eventsRuntime ??=`) the way the modern tasks
 * runtime is, because the modern leg builds a fresh `McpServer` per request.
 */
export class EventsRuntime {
  /** The SDK listen-router bus; the HTTP harness passes it to `createMcpHandler`. */
  readonly bus = new InMemoryServerEventBus();
  readonly listChanged: boolean;
  readonly nextPollMs: number;
  readonly advertiseOnLegacy: boolean;
  private readonly maxStreams: number;
  private readonly maxWebhookSubscriptions: number;
  private readonly types = new Map<string, EventType>();
  private readonly log: Occurrence[] = [];
  /**
   * Retention floors set by the `gap` preset: sequence numbers below one were
   * "lost". `allFloor` applies to every type; `typeFloors` to one type, for a
   * `gap` scoped by `name`.
   */
  private allFloor = 0;
  private readonly typeFloors = new Map<string, number>();
  private readonly streams = new Set<PushStream>();
  private readonly listens = new Set<ListenStream>();
  private readonly webhooks = new Map<string, WebhookSubscription>();
  private readonly armed: ArmedFailure[] = [];
  private readonly stats: EventsStats = {
    requests: {},
    legacyRequests: 0,
    errors: 0,
    openStreams: 0,
    listenStreams: 0,
    webhookSubscriptions: 0,
    emitted: 0,
  };

  constructor(config: EventsConfig = {}) {
    this.listChanged = config.listChanged ?? true;
    this.nextPollMs = config.nextPollMs ?? 1000;
    this.advertiseOnLegacy = config.advertiseOnLegacy ?? false;
    this.maxStreams = config.maxStreams ?? 16;
    this.maxWebhookSubscriptions = config.maxWebhookSubscriptions ?? 16;
    for (const type of builtInEventTypes()) {
      this.types.set(type.descriptor.name, type);
    }
  }

  /** The server's `capabilities.extensions[EVENTS_EXTENSION_KEY]` settings. */
  capabilitySettings(): { listChanged: boolean } {
    return { listChanged: this.listChanged };
  }

  getStats(): EventsStats {
    return {
      ...this.stats,
      requests: { ...this.stats.requests },
      openStreams: this.streams.size,
      listenStreams: this.listens.size,
      webhookSubscriptions: this.webhooks.size,
      emitted: this.log.length,
    };
  }

  countRequest(method: string, modern: boolean): void {
    if (!modern) {
      this.stats.legacyRequests += 1;
      return;
    }
    this.stats.requests[method] = (this.stats.requests[method] ?? 0) + 1;
  }

  countError(): void {
    this.stats.errors += 1;
  }

  // --- type registry ------------------------------------------------------

  eventTypeNames(): string[] {
    return [...this.types.keys()];
  }

  addEventType(name: string, delivery: DeliveryMode[]): "added" | "replaced" {
    const existed = this.types.has(name);
    this.types.set(
      name,
      dynamicEventType(
        name,
        delivery,
        existed
          ? `Dynamically replaced event type (${delivery.join(", ")})`
          : `Dynamically added event type (${delivery.join(", ")})`,
      ),
    );
    this.notifyListChanged();
    return existed ? "replaced" : "added";
  }

  /**
   * Remove a type: its push streams are terminated with `NotFound
   * {kind:"event"}`, its webhook subscriptions are dropped, and a later poll
   * answers `NotFound` because the name is gone.
   */
  removeEventType(name: string): boolean {
    if (!this.types.delete(name)) return false;
    for (const stream of [...this.streams]) {
      if (stream.name === name) stream.close(notFoundEvent(name));
    }
    for (const [key, sub] of this.webhooks) {
      if (sub.name === name) this.webhooks.delete(key);
    }
    this.notifyListChanged();
    return true;
  }

  private notifyListChanged(): void {
    if (!this.listChanged) return;
    for (const listen of this.listens) {
      listen.write("notifications/events/list_changed", {});
    }
  }

  // --- occurrences ---------------------------------------------------------

  /** Append occurrences and deliver them to every matching push stream. */
  emit(
    name: string,
    options: {
      data?: Record<string, unknown>;
      count?: number;
      ageMs?: number;
      eventId?: string;
    } = {},
  ): Occurrence[] {
    const type = this.types.get(name);
    if (!type) throw new Error(`Unknown event type: ${name}`);
    const count = options.count ?? 1;
    const emitted: Occurrence[] = [];
    for (let i = 0; i < count; i++) {
      const seq = this.log.length;
      const timeMs = Date.now() - (options.ageMs ?? 0);
      const occurrence: Occurrence = {
        seq,
        eventId:
          options.eventId !== undefined && count === 1
            ? options.eventId
            : `evt_${seq}`,
        name,
        timestamp: new Date(timeMs).toISOString(),
        timeMs,
        data: options.data ?? type.defaultData(seq),
      };
      this.log.push(occurrence);
      emitted.push(occurrence);
      for (const stream of this.streams) {
        if (stream.name === name && matches(stream.args, occurrence.data)) {
          stream.write(
            "notifications/events/event",
            this.toWire(occurrence, type, true),
          );
        }
      }
    }
    return emitted;
  }

  private toWire(
    occurrence: Occurrence,
    type: EventType,
    withCursor: boolean,
  ): Record<string, unknown> {
    return {
      eventId: occurrence.eventId,
      name: occurrence.name,
      timestamp: occurrence.timestamp,
      data: occurrence.data,
      ...(withCursor && type.replay
        ? { cursor: encodeCursor(occurrence.seq + 1) }
        : {}),
    };
  }

  private head(): number {
    return this.log.length;
  }

  /**
   * Where delivery starts for a supplied cursor, and whether that skipped
   * events: `null`/absent is "now"; a position below the retention floor is
   * advanced to it and reported as `truncated`. `ageFloor` is the `maxAgeMs`
   * cutoff, applied to **every** replayed occurrence by {@link replay} —
   * `emit_event.ageMs` can append an old occurrence after a fresh one, so the
   * log is not ordered by time and a prefix scan would miss it.
   */
  private startPosition(
    type: EventType,
    cursor: string | null | undefined,
    maxAgeMs: number | undefined,
  ): { position: number; truncated: boolean; ageFloor?: number } {
    if (cursor === null || cursor === undefined || !type.replay) {
      return { position: this.head(), truncated: false };
    }
    let position = decodeCursor(cursor);
    if (position > this.head()) {
      throw invalidParams(`Cursor is ahead of the server: ${cursor}`);
    }
    let truncated = false;
    const floor = Math.max(
      this.allFloor,
      this.typeFloors.get(type.descriptor.name) ?? 0,
    );
    if (position < floor) {
      position = floor;
      truncated = true;
    }
    return {
      position,
      truncated,
      ...(maxAgeMs !== undefined ? { ageFloor: Date.now() - maxAgeMs } : {}),
    };
  }

  /**
   * The matching occurrences from `position` on, at most `limit` of them:
   * those older than `ageFloor` are skipped and reported as `truncated`, and
   * `next` is the position after the last one examined.
   */
  private replay(
    type: EventType,
    args: Args,
    position: number,
    ageFloor: number | undefined,
    limit = Number.POSITIVE_INFINITY,
  ): {
    occurrences: Occurrence[];
    next: number;
    truncated: boolean;
    hasMore: boolean;
  } {
    const occurrences: Occurrence[] = [];
    let truncated = false;
    let at = position;
    for (; at < this.head(); at++) {
      const occurrence = this.log[at]!;
      if (occurrence.name !== type.descriptor.name) continue;
      if (!matches(args, occurrence.data)) continue;
      if (ageFloor !== undefined && occurrence.timeMs < ageFloor) {
        truncated = true;
        continue;
      }
      if (occurrences.length >= limit) {
        return { occurrences, next: at, truncated, hasMore: true };
      }
      occurrences.push(occurrence);
    }
    return { occurrences, next: at, truncated, hasMore: false };
  }

  /**
   * The `gap` preset: drop history (of one type when `name` is given, else of
   * all of them), and tell the affected push streams.
   */
  gap(name?: string): void {
    if (name === undefined) this.allFloor = this.head();
    else this.typeFloors.set(name, this.head());
    for (const stream of this.streams) {
      if (name !== undefined && stream.name !== name) continue;
      const type = this.types.get(stream.name);
      if (!type?.replay) continue;
      stream.write("notifications/events/active", {
        cursor: encodeCursor(this.head()),
        truncated: true,
        heartbeatMs: stream.heartbeatMs,
      });
    }
  }

  // --- failure injection ---------------------------------------------------

  arm(failure: ArmedFailure): void {
    this.armed.push(failure);
  }

  private takeArmed(
    method: string,
    name: string | undefined,
  ): EventsRpcError | undefined {
    const index = this.armed.findIndex(
      (f) =>
        (f.method === undefined || f.method === method) &&
        (f.name === undefined || f.name === name),
    );
    if (index === -1) return undefined;
    const [failure] = this.armed.splice(index, 1);
    return presetError(failure!.preset);
  }

  /** Terminate matching push streams with a preset's error. */
  terminate(preset: EventFailurePreset, name?: string): number {
    let count = 0;
    for (const stream of [...this.streams]) {
      if (name !== undefined && stream.name !== name) continue;
      stream.close(presetError(preset));
      count += 1;
    }
    return count;
  }

  /** Send a transient `notifications/events/error` to matching push streams. */
  streamError(name?: string): number {
    let count = 0;
    for (const stream of this.streams) {
      if (name !== undefined && stream.name !== name) continue;
      stream.write("notifications/events/error", {
        error: presetError("stream_error").toJson(),
      });
      count += 1;
    }
    return count;
  }

  // --- methods -------------------------------------------------------------

  private requireType(name: unknown): EventType {
    if (typeof name !== "string" || name.length === 0) {
      throw invalidParams("params.name is required");
    }
    const type = this.types.get(name);
    if (!type) throw notFoundEvent(name);
    return type;
  }

  private requireMode(type: EventType, mode: DeliveryMode): void {
    if (!type.descriptor.delivery.includes(mode)) {
      throw new EventsRpcError(
        EVENTS_ERROR_CODES.Unsupported,
        `${type.descriptor.name} does not support ${mode} delivery`,
        { feature: "deliveryMode", value: mode },
      );
    }
  }

  /** Validate the routing headers and consume an armed failure, if any. */
  preflight(req: Request, method: EventsMethod, params: Params): void {
    const name = typeof params.name === "string" ? params.name : "";
    validateRoutingHeaders(
      req,
      method,
      name,
      this.types.get(name),
      params.arguments,
    );
    const armed = this.takeArmed(
      method,
      method === "events/list" ? undefined : name,
    );
    if (armed) throw armed;
  }

  list(params: Params): Record<string, unknown> {
    const descriptors = [...this.types.values()].map((t) => t.descriptor);
    let start = 0;
    if (params.cursor !== undefined) {
      const parsed = Number(params.cursor);
      if (
        typeof params.cursor !== "string" ||
        !Number.isInteger(parsed) ||
        parsed < 0 ||
        parsed > descriptors.length
      ) {
        throw invalidParams(`Invalid cursor: ${String(params.cursor)}`);
      }
      start = parsed;
    }
    const next = start + EVENTS_PAGE_SIZE;
    return {
      resultType: "complete",
      events: descriptors.slice(start, next),
      ...(next < descriptors.length ? { nextCursor: String(next) } : {}),
    };
  }

  poll(params: Params): Record<string, unknown> {
    const type = this.requireType(params.name);
    this.requireMode(type, "poll");
    const args = validateArguments(type, params.arguments);
    const maxAgeMs = optionalNonNegativeInt(params.maxAgeMs, "maxAgeMs");
    const requested = optionalNonNegativeInt(params.maxEvents, "maxEvents");
    // Zero would return an empty batch with `hasMore: true` forever, so a
    // client draining the backlog would never make progress.
    if (requested === 0) throw invalidParams("maxEvents must be at least 1");
    const maxEvents = Math.min(requested ?? DEFAULT_MAX_EVENTS, MAX_MAX_EVENTS);
    const cursor = optionalCursor(params.cursor);
    const start = this.startPosition(type, cursor, maxAgeMs);
    const { occurrences, next, truncated, hasMore } = this.replay(
      type,
      args,
      start.position,
      start.ageFloor,
      maxEvents,
    );
    return {
      resultType: "complete",
      events: occurrences.map((o) => this.toWire(o, type, false)),
      ...(type.replay ? { cursor: encodeCursor(next) } : {}),
      truncated: type.replay ? start.truncated || truncated : false,
      hasMore,
      nextPollMs: this.nextPollMs,
    };
  }

  /**
   * Validate an `events/stream` and return what opening it needs. The SSE
   * response itself is written by {@link serveStream}.
   */
  openStream(params: Params): {
    type: EventType;
    args: Args;
    position: number;
    truncated: boolean;
    ageFloor?: number;
    heartbeatMs: number;
  } {
    const type = this.requireType(params.name);
    this.requireMode(type, "push");
    const args = validateArguments(type, params.arguments);
    const maxAgeMs = optionalNonNegativeInt(params.maxAgeMs, "maxAgeMs");
    const suggested = optionalNonNegativeInt(params.heartbeatMs, "heartbeatMs");
    if (this.streams.size >= this.maxStreams) {
      throw new EventsRpcError(
        EVENTS_ERROR_CODES.ResourceExhausted,
        "Too many open event streams",
        { limit: "subscriptions", max: this.maxStreams },
      );
    }
    const start = this.startPosition(
      type,
      optionalCursor(params.cursor),
      maxAgeMs,
    );
    const heartbeatMs = Math.min(
      Math.max(suggested ?? DEFAULT_HEARTBEAT_MS, MIN_HEARTBEAT_MS),
      MAX_HEARTBEAT_MS,
    );
    return { type, args, ...start, heartbeatMs };
  }

  /**
   * Backlog an opened stream replays right after its `active`, and whether
   * the `maxAgeMs` cutoff skipped any of it (which that `active` reports).
   */
  backlogFor(
    type: EventType,
    args: Args,
    position: number,
    ageFloor: number | undefined,
  ): { events: Record<string, unknown>[]; truncated: boolean } {
    const { occurrences, truncated } = this.replay(
      type,
      args,
      position,
      ageFloor,
    );
    return {
      events: occurrences.map((o) => this.toWire(o, type, true)),
      truncated,
    };
  }

  headCursor(type: EventType): Record<string, unknown> {
    return type.replay ? { cursor: encodeCursor(this.head()) } : {};
  }

  addStream(stream: PushStream): void {
    this.streams.add(stream);
  }

  removeStream(stream: PushStream): void {
    this.streams.delete(stream);
  }

  addListen(listen: ListenStream): void {
    this.listens.add(listen);
  }

  removeListen(listen: ListenStream): void {
    this.listens.delete(listen);
  }

  subscribe(params: Params, principal: string): Record<string, unknown> {
    const type = this.requireType(params.name);
    this.requireMode(type, "webhook");
    const args = validateArguments(type, params.arguments);
    const delivery = params.delivery;
    if (typeof delivery !== "object" || delivery === null) {
      throw invalidParams("delivery is required");
    }
    const d = delivery as Record<string, unknown>;
    if (d.mode !== "webhook") {
      throw invalidParams('delivery.mode must be "webhook"');
    }
    const url = validateCallbackUrl(d.url);
    validateSecret(d.secret);
    const maxAgeMs = optionalNonNegativeInt(params.maxAgeMs, "maxAgeMs");
    const ttl = params.ttlMs;
    if (ttl !== undefined && ttl !== null && !isNonNegativeInt(ttl)) {
      throw invalidParams("ttlMs must be a non-negative integer or null");
    }
    const failure = callbackEndpointFailure(url);
    if (failure) {
      throw new EventsRpcError(
        EVENTS_ERROR_CODES.CallbackEndpointError,
        "Callback endpoint failed verification",
        { reason: failure },
      );
    }
    // Validated before any state is touched, so a rejected cursor leaves no
    // subscription behind.
    const start = this.startPosition(
      type,
      optionalCursor(params.cursor),
      maxAgeMs,
    );
    const truncated =
      start.truncated ||
      this.replay(type, args, start.position, start.ageFloor).truncated;
    const key = canonicalJson([
      principal,
      url.href,
      type.descriptor.name,
      args,
    ]);
    const existing = this.webhooks.get(key);
    if (!existing && this.webhooks.size >= this.maxWebhookSubscriptions) {
      throw new EventsRpcError(
        EVENTS_ERROR_CODES.ResourceExhausted,
        "Too many webhook subscriptions",
        { limit: "subscriptions", max: this.maxWebhookSubscriptions },
      );
    }
    const refreshBefore =
      ttl === null
        ? null
        : new Date(
            Date.now() +
              Math.min(
                Math.max(
                  typeof ttl === "number" ? ttl : DEFAULT_WEBHOOK_TTL_MS,
                  MIN_WEBHOOK_TTL_MS,
                ),
                MAX_WEBHOOK_TTL_MS,
              ),
          ).toISOString();
    const subscription: WebhookSubscription = existing
      ? { ...existing, refreshBefore }
      : {
          id: `sub_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
          key,
          name: type.descriptor.name,
          url,
          createdAt: new Date(),
          refreshBefore,
        };
    this.webhooks.set(key, subscription);
    return {
      resultType: "complete",
      id: subscription.id,
      refreshBefore,
      ...(type.replay ? { cursor: encodeCursor(start.position) } : {}),
      truncated: type.replay ? truncated : false,
      ...(existing
        ? { deliveryStatus: cannedDeliveryStatus(url, existing.createdAt) }
        : {}),
    };
  }

  unsubscribe(params: Params, principal: string): Record<string, unknown> {
    const type = this.requireType(params.name);
    const args = validateArguments(type, params.arguments);
    const delivery = params.delivery as Record<string, unknown> | undefined;
    if (typeof delivery?.url !== "string") {
      throw invalidParams("delivery.url is required");
    }
    const key = canonicalJson([
      principal,
      validateCallbackUrl(delivery.url).href,
      type.descriptor.name,
      args,
    ]);
    if (!this.webhooks.delete(key)) {
      throw new EventsRpcError(
        EVENTS_ERROR_CODES.NotFound,
        "No matching webhook subscription",
        { kind: "subscription" },
      );
    }
    return { resultType: "complete" };
  }
}

type Params = Record<string, unknown>;

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function optionalNonNegativeInt(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isNonNegativeInt(value)) {
    throw invalidParams(`${field} must be a non-negative integer`);
  }
  return value;
}

function optionalCursor(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw invalidParams("cursor must be a string or null");
  return value;
}

// ---------------------------------------------------------------------------
// HTTP serving
// ---------------------------------------------------------------------------

interface RpcBody {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Params;
}

/**
 * The subscription-key principal: a digest of the bearer credential, so two
 * authenticated callers never share a webhook subscription, or `"anonymous"`
 * for an unauthenticated one (the fixture's documented deviation).
 */
function principalOf(authorization: string | undefined): string {
  if (!authorization) return "anonymous";
  return `bearer:${createHash("sha256").update(authorization).digest("hex").slice(0, 16)}`;
}

/** Whether a request carries a modern (2026-07-28+) per-request envelope. */
function isModernRequest(params: Params | undefined): boolean {
  const meta = params?._meta;
  if (typeof meta !== "object" || meta === null) return false;
  const version = (meta as Record<string, unknown>)[PROTOCOL_VERSION_META_KEY];
  return typeof version === "string" && version >= EVENTS_MIN_PROTOCOL_VERSION;
}

function isEventsMethod(method: unknown): method is EventsMethod {
  return (EVENTS_METHODS as readonly unknown[]).includes(method);
}

function sendError(
  res: Response,
  id: RpcBody["id"],
  error: EventsRpcError,
): void {
  res
    .status(error.httpStatus)
    .json({ jsonrpc: "2.0", id: id ?? null, error: error.toJson() });
}

function toRpcError(err: unknown): EventsRpcError {
  return err instanceof EventsRpcError
    ? err
    : new EventsRpcError(
        -32603,
        err instanceof Error ? err.message : String(err),
      );
}

/** Open an SSE response and return a frame writer. */
function openSse(res: Response): (frame: Record<string, unknown>) => void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  return (frame) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: message\ndata: ${JSON.stringify(frame)}\n\n`);
  };
}

function serveStream(
  runtime: EventsRuntime,
  res: Response,
  body: RpcBody,
  streamsById: Map<string | number, Set<PushStream>>,
): void {
  const id = body.id ?? 0;
  const opened = runtime.openStream(body.params ?? {});
  const backlog = runtime.backlogFor(
    opened.type,
    opened.args,
    opened.position,
    opened.ageFloor,
  );
  const writeFrame = openSse(res);
  const subMeta = { [SUBSCRIPTION_ID_META_KEY]: id };
  let heartbeat: NodeJS.Timeout | undefined;
  let closed = false;

  const armHeartbeat = () => {
    if (heartbeat !== undefined) clearTimeout(heartbeat);
    heartbeat = setTimeout(() => {
      write("notifications/events/heartbeat", runtime.headCursor(opened.type));
    }, opened.heartbeatMs);
  };
  const write = (method: string, params: Record<string, unknown>) => {
    if (closed) return;
    writeFrame({
      jsonrpc: "2.0",
      method,
      params: { ...params, _meta: { ...subMeta } },
    });
    armHeartbeat();
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat !== undefined) clearTimeout(heartbeat);
    runtime.removeStream(stream);
    const sharing = streamsById.get(id);
    sharing?.delete(stream);
    if (sharing?.size === 0) streamsById.delete(id);
  };
  const stream: PushStream = {
    id,
    name: opened.type.descriptor.name,
    args: opened.args,
    heartbeatMs: opened.heartbeatMs,
    write,
    close: (error) => {
      if (closed) return;
      if (error)
        write("notifications/events/terminated", { error: error.toJson() });
      // The `StreamEventsResult` final frame: a server-initiated close.
      writeFrame({
        jsonrpc: "2.0",
        id,
        result: { resultType: "complete", _meta: { ...subMeta } },
      });
      cleanup();
      res.end();
    },
  };

  runtime.addStream(stream);
  // Request ids are chosen per client, so two clients can each hold a stream
  // under the same id; `notifications/cancelled` acts only on an unambiguous one.
  streamsById.set(id, (streamsById.get(id) ?? new Set()).add(stream));
  // A client abort (HTTP) closes the response; release the subscription.
  res.on("close", cleanup);

  write("notifications/events/active", {
    ...(opened.type.replay ? { cursor: `cur_${opened.position}` } : {}),
    truncated: opened.type.replay
      ? opened.truncated || backlog.truncated
      : false,
    heartbeatMs: opened.heartbeatMs,
  });
  for (const event of backlog.events) {
    write("notifications/events/event", event);
  }
}

/** Honor a listen filter's core fields the way the SDK's router does. */
function honorCoreFilter(
  requested: Record<string, unknown>,
  capabilities: ServerCapabilities,
): Record<string, unknown> {
  const honored: Record<string, unknown> = {};
  if (requested.toolsListChanged === true && capabilities.tools?.listChanged) {
    honored.toolsListChanged = true;
  }
  if (
    requested.promptsListChanged === true &&
    capabilities.prompts?.listChanged
  ) {
    honored.promptsListChanged = true;
  }
  if (
    requested.resourcesListChanged === true &&
    capabilities.resources?.listChanged
  ) {
    honored.resourcesListChanged = true;
  }
  const uris = requested.resourceSubscriptions;
  if (
    Array.isArray(uris) &&
    uris.length > 0 &&
    capabilities.resources?.subscribe
  ) {
    honored.resourceSubscriptions = [...uris];
  }
  return honored;
}

function serveListen(
  runtime: EventsRuntime,
  res: Response,
  body: RpcBody,
  filter: Record<string, unknown>,
  getServer: () => {
    capabilities: ServerCapabilities;
    serverInfo: Record<string, unknown>;
  },
): void {
  const id = body.id ?? 0;
  const { capabilities, serverInfo } = getServer();
  const honored = honorCoreFilter(filter, capabilities);
  if (runtime.listChanged) honored.eventsListChanged = true;
  const writeFrame = openSse(res);
  const subMeta = { [SUBSCRIPTION_ID_META_KEY]: id };
  const write = (method: string, params: Record<string, unknown>) =>
    writeFrame({
      jsonrpc: "2.0",
      method,
      params: { ...params, _meta: { ...(params._meta as object), ...subMeta } },
    });
  write("notifications/subscriptions/acknowledged", { notifications: honored });
  if (Object.keys(honored).length === 0) {
    writeFrame({
      jsonrpc: "2.0",
      id,
      result: {
        resultType: "complete",
        _meta: { ...subMeta, [SERVER_INFO_META_KEY]: serverInfo },
      },
    });
    res.end();
    return;
  }
  const listen: ListenStream = { write };
  if (honored.eventsListChanged) runtime.addListen(listen);
  const unsubscribe = runtime.bus.subscribe((event) => {
    const uris = honored.resourceSubscriptions as string[] | undefined;
    switch (event.kind) {
      case "tools_list_changed":
        if (honored.toolsListChanged)
          write("notifications/tools/list_changed", {});
        return;
      case "prompts_list_changed":
        if (honored.promptsListChanged)
          write("notifications/prompts/list_changed", {});
        return;
      case "resources_list_changed":
        if (honored.resourcesListChanged) {
          write("notifications/resources/list_changed", {});
        }
        return;
      case "resource_updated":
        if (uris?.includes(event.uri)) {
          write("notifications/resources/updated", { uri: event.uri });
        }
        return;
    }
  });
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(": keepalive\n\n");
  }, LISTEN_KEEPALIVE_MS);
  res.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
    runtime.removeListen(listen);
  });
}

export interface EventsInterceptorOptions {
  /**
   * The era of the HTTP leg this is mounted on. On the `"legacy"` (2025
   * session-based) leg every `events/*` request is refused and counted
   * whatever envelope it carries, and no listen is ever intercepted — the
   * extension does not exist there. Default `"modern"`.
   */
  era?: "legacy" | "modern";
  /**
   * The capabilities and identity of the server a modern request would reach,
   * for honoring a listen filter's core fields. Called once per intercepted
   * listen.
   */
  describeServer: () => {
    capabilities: ServerCapabilities;
    serverInfo: Record<string, unknown>;
  };
}

/**
 * Express middleware serving the Events extension ahead of the SDK handler.
 * Mounted on both HTTP legs (modern and 2025 session-based), because the
 * legacy leg is where an `events/*` request must be refused and counted.
 */
export function createEventsInterceptor(
  getRuntime: () => EventsRuntime,
  options: EventsInterceptorOptions,
): RequestHandler {
  const streamsById = new Map<string | number, Set<PushStream>>();
  const legacyLeg = options.era === "legacy";
  return (req, res, next) => {
    const body = req.body as RpcBody | undefined;
    const method = body?.method;
    const runtime = getRuntime();

    // `notifications/cancelled` for an open push stream (the stdio-style
    // cancellation, accepted over HTTP too): close it with no final frame.
    if (method === "notifications/cancelled") {
      const requestId = body?.params?.requestId;
      const sharing =
        typeof requestId === "string" || typeof requestId === "number"
          ? streamsById.get(requestId)
          : undefined;
      // Ambiguous (two clients reused the id) or unknown: not ours to close.
      // An HTTP client releases its stream by aborting the response anyway.
      if (!sharing || sharing.size !== 1) {
        next();
        return;
      }
      [...sharing][0]!.close();
      res.status(202).end();
      return;
    }

    if (method === "subscriptions/listen") {
      const filter = body?.params?.notifications;
      if (
        legacyLeg ||
        !isModernRequest(body?.params) ||
        typeof filter !== "object" ||
        filter === null ||
        (filter as Record<string, unknown>).eventsListChanged !== true
      ) {
        next();
        return;
      }
      serveListen(
        runtime,
        res,
        body!,
        filter as Record<string, unknown>,
        options.describeServer,
      );
      return;
    }

    if (!isEventsMethod(method)) {
      next();
      return;
    }
    const id = body?.id;
    const params = body?.params ?? {};
    const modern = !legacyLeg && isModernRequest(params);
    runtime.countRequest(method, modern);
    if (!modern) {
      runtime.countError();
      sendError(
        res,
        id,
        new EventsRpcError(
          EVENTS_ERROR_CODES.MethodNotFound,
          `Method not found: ${method} (the Events extension requires protocol ${EVENTS_MIN_PROTOCOL_VERSION} or later)`,
        ),
      );
      return;
    }
    try {
      runtime.preflight(req, method, params);
      const principal = principalOf(req.header("authorization"));
      switch (method) {
        case "events/list":
          res.json({ jsonrpc: "2.0", id, result: runtime.list(params) });
          return;
        case "events/poll":
          res.json({ jsonrpc: "2.0", id, result: runtime.poll(params) });
          return;
        case "events/stream":
          serveStream(runtime, res, body!, streamsById);
          return;
        case "events/subscribe":
          res.json({
            jsonrpc: "2.0",
            id,
            result: runtime.subscribe(params, principal),
          });
          return;
        case "events/unsubscribe":
          res.json({
            jsonrpc: "2.0",
            id,
            result: runtime.unsubscribe(params, principal),
          });
          return;
      }
    } catch (err) {
      runtime.countError();
      sendError(res, id, toRpcError(err));
    }
  };
}

// ---------------------------------------------------------------------------
// Control tools
// ---------------------------------------------------------------------------

/** Names of the control tools `createMcpServer` registers with `events`. */
export const EVENTS_CONTROL_TOOL_NAMES = {
  emit: "emit_event",
  addType: "add_event_type",
  removeType: "remove_event_type",
  injectFailure: "inject_event_failure",
  stats: "get_event_stats",
} as const;

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export interface EventsControlTool {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (params: Record<string, unknown>) => Promise<CallToolResult>;
}

const DeliveryModeSchema = z.enum(["poll", "push", "webhook"]);

/** The control tools, closed over one runtime. */
export function createEventsControlTools(
  runtime: EventsRuntime,
): EventsControlTool[] {
  return [
    {
      name: EVENTS_CONTROL_TOOL_NAMES.emit,
      description:
        "Emit occurrence(s) of an event type: delivered live to matching push streams and returned by later polls",
      inputSchema: {
        name: z.string().describe("Event type name"),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Payload; defaults to a synthetic one for the type"),
        count: z.number().int().min(1).max(500).optional(),
        ageMs: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Backdate the occurrence timestamp (exercises maxAgeMs)"),
        eventId: z
          .string()
          .optional()
          .describe(
            "Explicit eventId (count 1 only) — repeat one to test dedup",
          ),
      },
      handler: async (params) => {
        const name = params.name as string;
        if (!runtime.eventTypeNames().includes(name)) {
          return textResult(`Unknown event type: ${name}`, true);
        }
        const emitted = runtime.emit(name, {
          data: params.data as Record<string, unknown> | undefined,
          count: params.count as number | undefined,
          ageMs: params.ageMs as number | undefined,
          eventId: params.eventId as string | undefined,
        });
        return jsonResult({
          emitted: emitted.map((o) => ({ eventId: o.eventId, seq: o.seq })),
        });
      },
    },
    {
      name: EVENTS_CONTROL_TOOL_NAMES.addType,
      description:
        "Add (or replace) an event type; sends notifications/events/list_changed to opted-in listen streams",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe(`Default "${EVENT_TYPE_NAMES.dynamic}"`),
        delivery: z.array(DeliveryModeSchema).min(1).optional(),
      },
      handler: async (params) => {
        const name =
          (params.name as string | undefined) ?? EVENT_TYPE_NAMES.dynamic;
        const delivery = (params.delivery as DeliveryMode[] | undefined) ?? [
          "poll",
          "push",
        ];
        const outcome = runtime.addEventType(name, delivery);
        return jsonResult({ name, outcome });
      },
    },
    {
      name: EVENTS_CONTROL_TOOL_NAMES.removeType,
      description:
        "Remove an event type: terminates its push streams with NotFound, drops its webhooks, sends list_changed",
      inputSchema: { name: z.string() },
      handler: async (params) => {
        const name = params.name as string;
        return runtime.removeEventType(name)
          ? jsonResult({ name, removed: true })
          : textResult(`Unknown event type: ${name}`, true);
      },
    },
    {
      name: EVENTS_CONTROL_TOOL_NAMES.injectFailure,
      description:
        "Trigger a named failure mode. error_* fail the next matching events/* request once; terminate_* end open push streams (and fail the next poll); stream_error sends a transient error; gap drops history (truncated); backlog emits many events (hasMore)",
      inputSchema: {
        preset: z.enum(EVENT_FAILURE_PRESETS),
        name: z.string().optional().describe("Limit to one event type"),
        method: z
          .enum(EVENTS_METHODS)
          .optional()
          .describe("error_* only: limit to one method"),
        count: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("backlog only (default 25)"),
      },
      handler: async (params) => {
        const preset = params.preset as EventFailurePreset;
        const name = params.name as string | undefined;
        if (preset.startsWith("error_")) {
          runtime.arm({
            preset,
            name,
            method: params.method as string | undefined,
          });
          return jsonResult({ preset, armed: true });
        }
        if (
          preset === "terminate_forbidden" ||
          preset === "terminate_schema_changed"
        ) {
          const terminated = runtime.terminate(preset, name);
          // Poll holds no server-side subscription: its termination signal is
          // the error on the next poll (spec §Subscription Termination).
          runtime.arm({ preset, name, method: "events/poll" });
          return jsonResult({ preset, terminated });
        }
        if (preset === "stream_error") {
          return jsonResult({ preset, notified: runtime.streamError(name) });
        }
        if (preset === "gap") {
          runtime.gap(name);
          return jsonResult({ preset });
        }
        const target = name ?? EVENT_TYPE_NAMES.allModes;
        if (!runtime.eventTypeNames().includes(target)) {
          return textResult(`Unknown event type: ${target}`, true);
        }
        const emitted = runtime.emit(target, {
          count: (params.count as number | undefined) ?? 25,
        });
        return jsonResult({ preset, emitted: emitted.length });
      },
    },
    {
      name: EVENTS_CONTROL_TOOL_NAMES.stats,
      description:
        "Counters: events/* requests by method, legacyRequests (sent without a modern envelope), errors, open streams, listens, webhooks",
      inputSchema: {},
      handler: async () => jsonResult(runtime.getStats()),
    },
  ];
}
