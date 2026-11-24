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
import type { EventType } from "@inspector/core/extension/events/schemas.js";
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
