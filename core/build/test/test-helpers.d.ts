/**
 * Test helpers for event-driven waits and polling.
 * Use these instead of arbitrary setTimeout/setInterval in E2E tests.
 */
export interface WaitForEventOptions {
    timeout?: number;
}
/**
 * Wait for a single event on an EventTarget. Resolves with the event detail,
 * or rejects after `timeout` ms if the event never fires.
 */
export declare function waitForEvent<T = unknown>(target: EventTarget, eventName: string, options?: WaitForEventOptions): Promise<T>;
export interface WaitForProgressCountOptions {
    timeout?: number;
}
/**
 * Wait until `progressNotification` has been received `expectedCount` times.
 * Returns the collected event details. Use for sendProgress and progress-linked-to-tasks tests.
 */
export declare function waitForProgressCount(client: {
    addEventListener: (type: string, fn: (e: Event) => void) => void;
    removeEventListener: (type: string, fn: (e: Event) => void) => void;
}, expectedCount: number, options?: WaitForProgressCountOptions): Promise<unknown[]>;
export interface WaitForStateFileOptions {
    timeout?: number;
    interval?: number;
}
/**
 * Poll state file until `predicate(parsed)` returns true, then return the parsed value.
 * Uses vi.waitFor under the hood. For use with Zustand persist state.json files.
 *
 * On failure, the thrown error includes:
 * - Whether the failure was a JSON parse error or predicate returned false.
 * - A truncated snippet of what was read (to distinguish partial write vs wrong content).
 * - Attempt count (to see if we timed out early or after many retries).
 *
 * Run with DEBUG_WAIT_FOR_STATE_FILE=1 to log every attempt (parse ok/fail, predicate result).
 */
export declare function waitForStateFile<T = unknown>(filePath: string, predicate: (parsed: unknown) => boolean, options?: WaitForStateFileOptions): Promise<T>;
//# sourceMappingURL=test-helpers.d.ts.map