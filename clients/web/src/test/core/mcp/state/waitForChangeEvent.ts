import type {
  TypedEventTarget,
  TypedEventGeneric,
} from "@inspector/core/mcp/typedEventTarget";

/**
 * Default ceiling for a single change-event wait. Generous relative to the
 * near-instant fake-client dispatches these tests drive, but well under the
 * vitest per-test timeout so this rejection — not the runner's generic timeout
 * — is what surfaces.
 */
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Resolve when `target` dispatches `type`, rejecting with a readable message if
 * the event never arrives within `timeoutMs`.
 *
 * The timeout is the point of this helper. The connect-path gate tests assert
 * that a capability-less / empty-list refresh still dispatches its change event
 * (so the listener resolves once the connect-driven refresh has fully run).
 * Should a future optimization stop dispatching that redundant event, awaiting
 * it would otherwise hang to the vitest timeout with no clue why; here it fails
 * fast, naming the event that never fired.
 */
export function waitForChangeEvent<
  EventMap extends object,
  K extends keyof EventMap,
>(
  target: TypedEventTarget<EventMap>,
  type: K,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<EventMap[K]> {
  return new Promise<EventMap[K]>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for "${String(type)}" event`,
        ),
      );
    }, timeoutMs);
    target.addEventListener(
      type,
      (event: TypedEventGeneric<EventMap, K>) => {
        clearTimeout(timer);
        resolve(event.detail);
      },
      { once: true, signal: controller.signal },
    );
  });
}
