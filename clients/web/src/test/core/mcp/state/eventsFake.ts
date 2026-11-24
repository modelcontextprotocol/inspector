/**
 * A FakeInspectorClient that also presents the optional Events surface
 * (#3028). Kept beside the events store tests rather than in the shared fake,
 * so the many stores that never reach events keep a client without it — which
 * is itself a case the stores must handle ("not supported").
 */
import { vi } from "vitest";
import {
  FakeInspectorClient,
  type FakeInspectorClientOptions,
} from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import type {
  EventType,
  PollEventsParams,
  PollEventsResult,
  StreamEventsParams,
  StreamEventsResult,
} from "@inspector/core/extension/events/schemas.js";
import {
  EVENTS_SUBSCRIPTION_ID_META_KEY,
  type EventsStreamNotificationMethod,
} from "@inspector/core/extension/events/constants.js";
import type { ExcludedEventType } from "@inspector/core/extension/events/headers.js";
import type { EventsExtensionSupport } from "@inspector/core/extension/events/support.js";
import type { RequestMetadata } from "@inspector/core/mcp/types.js";

export interface EventsPage {
  events: EventType[];
  nextCursor?: string;
  excluded: ExcludedEventType[];
}

export function eventType(name: string): EventType {
  return { name, delivery: ["poll"], inputSchema: { type: "object" } };
}

export class EventsFakeClient extends FakeInspectorClient {
  eventsExtension: EventsExtensionSupport | undefined = { listChanged: true };
  eventPages: EventsPage[] = [];

  constructor(options: FakeInspectorClientOptions = {}) {
    super(options);
  }

  getEventsExtension(): EventsExtensionSupport | undefined {
    return this.eventsExtension;
  }

  // Typed by signature so `mock.calls` carries the cursor a test asserts on.
  listEvents = vi.fn<
    (cursor?: string, metadata?: RequestMetadata) => Promise<EventsPage>
  >(async () => this.eventPages.shift() ?? { events: [], excluded: [] });

  listAllEvents = vi.fn<
    (options?: {
      metadata?: RequestMetadata;
    }) => Promise<{ events: EventType[] }>
  >(async () => {
    const events: EventType[] = [];
    while (this.eventPages.length > 0) {
      events.push(...(this.eventPages.shift()?.events ?? []));
    }
    return { events };
  });
}

/** One `events/stream` the fake has opened, held until the test settles it. */
export interface FakeStream {
  id: number;
  eventType: EventType;
  params: Omit<StreamEventsParams, "name">;
  signal: AbortSignal | undefined;
  resolve: (result: StreamEventsResult) => void;
  reject: (error: unknown) => void;
}

/**
 * An {@link EventsFakeClient} that also runs subscriptions (#3029): polls
 * answer from a queue, and streams stay open until the test resolves or
 * rejects them, or the caller aborts them.
 */
export class EventsEngineFakeClient extends EventsFakeClient {
  pollResults: Array<PollEventsResult | Error> = [];
  streams: FakeStream[] = [];
  private nextStreamId = 1;

  pollEvents = vi.fn<
    (
      eventType: EventType,
      params?: Omit<PollEventsParams, "name">,
      metadata?: RequestMetadata,
      options?: { signal?: AbortSignal },
    ) => Promise<PollEventsResult>
  >(async (_eventType, params) => {
    const next = this.pollResults.shift();
    if (next instanceof Error) throw next;
    return (
      next ?? {
        events: [],
        cursor: params?.cursor ?? null,
        truncated: false,
        hasMore: false,
        nextPollMs: 1000,
      }
    );
  });

  streamEvents = vi.fn<
    (
      eventType: EventType,
      params?: Omit<StreamEventsParams, "name">,
      options?: {
        signal?: AbortSignal;
        onSubscriptionId?: (id: string | number) => void;
        metadata?: RequestMetadata;
      },
    ) => Promise<StreamEventsResult>
  >(
    (eventType, params = {}, options = {}) =>
      new Promise<StreamEventsResult>((resolve, reject) => {
        const id = this.nextStreamId++;
        options.onSubscriptionId?.(id);
        options.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
        this.streams.push({
          id,
          eventType,
          params,
          signal: options.signal,
          resolve,
          reject,
        });
      }),
  );

  /** The newest stream opened. */
  lastStream(): FakeStream {
    const stream = this.streams.at(-1);
    if (!stream) throw new Error("no stream opened");
    return stream;
  }

  /** Deliver a push notification tagged with `subscriptionId`. */
  notify(
    method: EventsStreamNotificationMethod,
    subscriptionId: string | number,
    params: Record<string, unknown> = {},
  ): void {
    this.dispatchTypedEvent("eventsStreamNotification", {
      method,
      params: {
        ...params,
        _meta: { [EVENTS_SUBSCRIPTION_ID_META_KEY]: subscriptionId },
      },
    });
  }
}
