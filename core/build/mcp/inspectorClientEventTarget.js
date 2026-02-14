/**
 * Type-safe EventTarget for InspectorClient events
 *
 * This module provides a base class with overloaded addEventListener/removeEventListener
 * methods and a dispatchTypedEvent method that give compile-time type safety for event
 * names and event detail types.
 */
/**
 * Typed event class that extends CustomEvent with type-safe detail
 */
export class TypedEvent extends CustomEvent {
    constructor(type, detail) {
        super(type, { detail });
    }
}
/**
 * Type-safe EventTarget for InspectorClient events
 *
 * Provides overloaded addEventListener/removeEventListener methods that
 * give compile-time type safety for event names and event detail types.
 * Extends the standard EventTarget, so all standard EventTarget functionality
 * is still available.
 */
export class InspectorClientEventTarget extends EventTarget {
    /**
     * Dispatch a type-safe event
     * For void events, no detail parameter is required (or allowed)
     * For events with payloads, the detail parameter is required
     */
    dispatchTypedEvent(type, ...args) {
        const detail = args[0];
        this.dispatchEvent(new TypedEvent(type, detail));
    }
    // Implementation - must be compatible with all overloads
    addEventListener(type, listener, options) {
        super.addEventListener(type, listener, options);
    }
    // Implementation - must be compatible with all overloads
    removeEventListener(type, listener, options) {
        super.removeEventListener(type, listener, options);
    }
}
//# sourceMappingURL=inspectorClientEventTarget.js.map