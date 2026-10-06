/**
 * Pure helpers behind the TUI Subscriptions tab (#2432).
 *
 * The live feed is read out of the protocol message log the TUI already keeps
 * (`MessageLogState`), rather than from a new store: every
 * `notifications/resources/updated` the server sends is already recorded there
 * with its timestamp, in both protocol eras, so a feed derived from it cannot
 * disagree with the Protocol tab about what arrived.
 */
import type { Resource } from "@modelcontextprotocol/client";
import type {
  InspectorResourceSubscription,
  MessageEntry,
} from "@inspector/core/mcp/types.js";

export const RESOURCE_UPDATED_METHOD = "notifications/resources/updated";

export interface ResourceUpdateEvent {
  id: string;
  timestamp: Date;
  uri: string;
}

/**
 * Every `notifications/resources/updated` in the log, newest first. Entries
 * without a string `params.uri` are skipped — they name nothing to show.
 */
export function resourceUpdateFeed(
  messages: readonly MessageEntry[],
): ResourceUpdateEvent[] {
  const feed: ResourceUpdateEvent[] = [];
  for (const entry of messages) {
    if (entry.direction !== "notification") continue;
    const message = entry.message;
    if (!("method" in message) || message.method !== RESOURCE_UPDATED_METHOD) {
      continue;
    }
    const uri = message.params?.uri;
    if (typeof uri !== "string") continue;
    feed.push({ id: entry.id, timestamp: entry.timestamp, uri });
  }
  return feed.reverse();
}

export interface SubscribableResource {
  resource: Resource;
  subscribed: boolean;
  lastUpdated?: Date;
}

/**
 * The rows the Subscriptions tab lists: every listed resource, then any
 * subscribed URI the list does not contain (a template-expanded URI, or one the
 * server has since dropped), so an active subscription can always be found and
 * cancelled from here.
 */
export function subscribableResources(
  resources: readonly Resource[],
  subscriptions: readonly InspectorResourceSubscription[],
): SubscribableResource[] {
  const byUri = new Map(subscriptions.map((s) => [s.resource.uri, s]));
  const rows: SubscribableResource[] = resources.map((resource) => {
    const sub = byUri.get(resource.uri);
    return {
      resource,
      subscribed: sub !== undefined,
      lastUpdated: sub?.lastUpdated,
    };
  });
  const listed = new Set(resources.map((r) => r.uri));
  for (const sub of subscriptions) {
    if (listed.has(sub.resource.uri)) continue;
    rows.push({
      resource: sub.resource,
      subscribed: true,
      lastUpdated: sub.lastUpdated,
    });
  }
  return rows;
}
