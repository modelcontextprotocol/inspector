/**
 * Generic type-safe EventTarget for any domain (InspectorClient, state managers, etc.).
 * Extends EventTarget so instances are valid EventTargets; uses overloads to preserve
 * base-class assignability while providing typed addEventListener/removeEventListener.
 */

/**
 * Typed event class that extends CustomEvent with type-safe detail.
 * For void events, detail is undefined.
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
