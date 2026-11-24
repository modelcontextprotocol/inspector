/**
 * Whether a connection may use the Events extension (SEP-3415).
 *
 * Two conditions, both required, and neither implies the other:
 *
 * - **A modern era.** The extension is defined for protocol revision
 *   `2026-07-28` and later only: it relies on per-request client capabilities,
 *   `server/discover` and `subscriptions/listen`, none of which a legacy
 *   connection has. Unlike Skills (#2234), whose `skills/*` methods work on
 *   either era, a legacy server that happens to declare the key is not offering
 *   something this client can use, so the era is checked here rather than left
 *   to the server's answer.
 * - **The server's advertisement.** "A client MUST NOT send [`events/*`] to a
 *   server that has not advertised the extension" (spec, Capability
 *   Negotiation, Fallback).
 *
 * Every `events/*` call site in `InspectorClient` goes through this, so the
 * "never send `events/*` where it is not offered" rule has one predicate.
 */

import type {
  ProtocolEra,
  ServerCapabilities,
} from "@modelcontextprotocol/client";
import { EVENTS_EXTENSION_KEY } from "./constants.js";

/** The server's settings object for the extension. */
export interface EventsExtensionSupport {
  /** Whether the server sends `notifications/events/list_changed`. */
  listChanged: boolean;
}

/**
 * The server's Events settings when the extension may be used on this
 * connection, otherwise `undefined`. A non-object value under the key is not an
 * advertisement: the spec maps the identifier to a settings object.
 */
export function getEventsExtension(
  capabilities: ServerCapabilities | undefined,
  era: ProtocolEra | undefined,
): EventsExtensionSupport | undefined {
  if (era !== "modern") return undefined;
  const settings: unknown = capabilities?.extensions?.[EVENTS_EXTENSION_KEY];
  if (settings === null || typeof settings !== "object") return undefined;
  if (Array.isArray(settings)) return undefined;
  return {
    listChanged: (settings as { listChanged?: unknown }).listChanged === true,
  };
}

/** True when `events/*` may be sent on this connection. */
export function isEventsSupported(
  capabilities: ServerCapabilities | undefined,
  era: ProtocolEra | undefined,
): boolean {
  return getEventsExtension(capabilities, era) !== undefined;
}
