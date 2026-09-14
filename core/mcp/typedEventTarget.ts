/**
 * Generic type-safe EventTarget for any domain (InspectorClient, state managers, etc.).
 * Extends EventTarget so instances are valid EventTargets; uses overloads to preserve
 * base-class assignability while providing typed addEventListener/removeEventListener.
 */

/**
 * Typed event class that extends CustomEvent with type-safe detail.
 * For void events the detail is omitted; CustomEvent normalizes that to `null`,
 * so listeners receive `null` (not `undefined`) for such events.
 */
export class TypedEventGeneric<
  EventMap extends object,
  K extends keyof EventMap,
> extends CustomEvent<EventMap[K]> {
  constructor(type: K, detail?: EventMap[K]) {
    super(type as string, { detail });
  }
}

/**
 * Type-safe EventTarget parameterized by an event map (event name → detail type).
 * Extends EventTarget so instances are assignable to EventTarget. Uses the same
 * overload pattern as the DOM: typed overloads for our API plus a base-compatible
 * implementation so the subclass remains assignable to EventTarget.
 */
export class TypedEventTarget<EventMap extends object> extends EventTarget {
  /**
   * Per-event-type dispatch counter. Read through `getEventRevision` by
   * `useStoreSnapshot` (core/react) to tell "nothing has happened on this
   * event since I last looked" from "something has", without comparing the
   * snapshot's contents (#1955).
   */
  private readonly eventRevisions = new Map<string, number>();

  /**
   * How many times an event of this type has been dispatched from this
   * target. Monotonic per type, and per type only: an `errorChange` does not
   * advance `toolsChange`, so a subscriber to one is not re-read because of
   * the other.
   *
   * The counter — not the list's contents — is what a `useSyncExternalStore`
   * snapshot is cached against. That distinction is load-bearing rather than
   * an optimization: these stores hand out a defensive copy, so comparing
   * contents is the only alternative, and a contents comparison cannot see an
   * in-place mutation of an entry the list already holds. `MessageLogState`
   * does exactly that when a response is folded into its request entry
   * (filling in `response`/`duration`), and it dispatches — so the counter
   * moves and the fold reaches the UI, where a shallow compare would report
   * "unchanged" and never re-render it.
   */
  getEventRevision(type: keyof EventMap & string): number {
    return this.eventRevisions.get(type) ?? 0;
  }

  /**
   * Overridden solely to advance the counter. It sits on `dispatchEvent`
   * rather than on `dispatchTypedEvent` because that is the one funnel every
   * dispatch passes through — the typed helper below delegates to it, and so
   * does a hand-rolled `dispatchEvent(new CustomEvent(...))`, which the tests
   * use extensively. A counter bumped only in the typed helper would be
   * silently stale for those, i.e. exactly where nobody would look for it.
   *
   * Bumped BEFORE dispatching: the state mutation always precedes the
   * dispatch, so by the time a listener runs the counter must already reflect
   * it, or a snapshot read from inside that listener would return the cached
   * pre-change value.
   */
  override dispatchEvent(event: Event): boolean {
    this.eventRevisions.set(
      event.type,
      (this.eventRevisions.get(event.type) ?? 0) + 1,
    );
    return super.dispatchEvent(event);
  }

  dispatchTypedEvent<K extends keyof EventMap>(
    type: K,
    ...args: EventMap[K] extends void ? [] : [detail: EventMap[K]]
  ): void {
    const detail =
      (args[0] as EventMap[K] | undefined) ?? (undefined as EventMap[K]);
    this.dispatchEvent(new TypedEventGeneric<EventMap, K>(type, detail));
  }

  addEventListener<K extends keyof EventMap>(
    type: K,
    listener: (event: TypedEventGeneric<EventMap, K>) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener:
      | ((event: TypedEventGeneric<EventMap, keyof EventMap>) => void)
      | EventListenerOrEventListenerObject
      | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options,
    );
  }

  removeEventListener<K extends keyof EventMap>(
    type: K,
    listener: (event: TypedEventGeneric<EventMap, K>) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener:
      | ((event: TypedEventGeneric<EventMap, keyof EventMap>) => void)
      | EventListenerOrEventListenerObject
      | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options,
    );
  }
}
