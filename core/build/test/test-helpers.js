/**
 * Test helpers for event-driven waits and polling.
 * Use these instead of arbitrary setTimeout/setInterval in E2E tests.
 */
import { vi } from "vitest";
import * as fs from "node:fs/promises";
/**
 * Wait for a single event on an EventTarget. Resolves with the event detail,
 * or rejects after `timeout` ms if the event never fires.
 */
export function waitForEvent(target, eventName, options) {
    const timeoutMs = options?.timeout ?? 5000;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            target.removeEventListener(eventName, handler);
            reject(new Error(`Timeout waiting for event '${eventName}' (${timeoutMs}ms)`));
        }, timeoutMs);
        const handler = (e) => {
            clearTimeout(timer);
            target.removeEventListener(eventName, handler);
            resolve(e.detail);
        };
        target.addEventListener(eventName, handler);
    });
}
/**
 * Wait until `progressNotification` has been received `expectedCount` times.
 * Returns the collected event details. Use for sendProgress and progress-linked-to-tasks tests.
 */
export function waitForProgressCount(client, expectedCount, options) {
    const timeoutMs = options?.timeout ?? 5000;
    const events = [];
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            client.removeEventListener("progressNotification", handler);
            reject(new Error(`Timeout waiting for ${expectedCount} progressNotification events (got ${events.length}) after ${timeoutMs}ms`));
        }, timeoutMs);
        const handler = (e) => {
            events.push(e.detail);
            if (events.length >= expectedCount) {
                clearTimeout(timer);
                client.removeEventListener("progressNotification", handler);
                resolve(events);
            }
        };
        client.addEventListener("progressNotification", handler);
    });
}
const DEBUG_WAIT_FOR_STATE_FILE = process.env.DEBUG_WAIT_FOR_STATE_FILE === "1";
function truncate(s, maxLen) {
    if (s.length <= maxLen)
        return s;
    return s.slice(0, maxLen) + `... (${s.length} chars total)`;
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
export async function waitForStateFile(filePath, predicate, options) {
    const { timeout = 2000, interval = 50 } = options ?? {};
    let result;
    let attemptCount = 0;
    await vi.waitFor(async () => {
        attemptCount += 1;
        let raw;
        try {
            raw = await fs.readFile(filePath, "utf-8");
        }
        catch (readErr) {
            const msg = readErr.code ?? String(readErr);
            if (DEBUG_WAIT_FOR_STATE_FILE) {
                console.error(`[waitForStateFile] attempt ${attemptCount} read failed:`, msg);
            }
            throw new Error(`waitForStateFile failed: file read error (${msg}). File: ${filePath}. Attempts: ${attemptCount}. Run with DEBUG_WAIT_FOR_STATE_FILE=1 for per-attempt logs.`);
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            if (DEBUG_WAIT_FOR_STATE_FILE) {
                console.error(`[waitForStateFile] attempt ${attemptCount} JSON parse failed. Raw (first 300):`, truncate(raw, 300));
            }
            throw new Error(`waitForStateFile failed: JSON parse error (file may be mid-write or corrupt). File: ${filePath}. Attempts: ${attemptCount}. Raw snippet: ${truncate(raw, 200)}. Run with DEBUG_WAIT_FOR_STATE_FILE=1 for per-attempt logs.`);
        }
        const predOk = predicate(parsed);
        if (DEBUG_WAIT_FOR_STATE_FILE) {
            console.error(`[waitForStateFile] attempt ${attemptCount} parse ok, predicate: ${predOk}`);
        }
        if (!predOk) {
            throw new Error(`waitForStateFile failed: predicate returned false. File: ${filePath}. Attempts: ${attemptCount}. Parsed snippet: ${truncate(JSON.stringify(parsed), 200)}. Run with DEBUG_WAIT_FOR_STATE_FILE=1 for per-attempt logs.`);
        }
        result = parsed;
        return true;
    }, { timeout, interval });
    return result;
}
//# sourceMappingURL=test-helpers.js.map