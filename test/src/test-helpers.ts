/**
 * Test helpers for event-driven waits and polling.
 * Use these instead of arbitrary setTimeout/setInterval in E2E tests.
 */

import { vi } from "vitest";
import * as fs from "node:fs/promises";

export interface WaitForEventOptions {
  timeout?: number;
}

/**
 * Wait for a single event on an EventTarget. Resolves with the event detail,
 * or rejects after `timeout` ms if the event never fires.
 */
export function waitForEvent<T = unknown>(
  target: EventTarget,
  eventName: string,
  options?: WaitForEventOptions,
): Promise<T> {
  const timeoutMs = options?.timeout ?? 5000;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(eventName, handler);
      reject(
        new Error(`Timeout waiting for event '${eventName}' (${timeoutMs}ms)`),
      );
    }, timeoutMs);
    const handler = (e: Event) => {
      clearTimeout(timer);
      target.removeEventListener(eventName, handler);
      resolve((e as CustomEvent<T>).detail);
    };
    target.addEventListener(eventName, handler);
  });
}

export interface WaitForProgressCountOptions {
  timeout?: number;
}

/**
 * Wait until `progressNotification` has been received `expectedCount` times.
 * Returns the collected event details. Use for sendProgress and progress-linked-to-tasks tests.
 */
export function waitForProgressCount(
  client: {
    addEventListener: (type: string, fn: (e: Event) => void) => void;
    removeEventListener: (type: string, fn: (e: Event) => void) => void;
  },
  expectedCount: number,
  options?: WaitForProgressCountOptions,
): Promise<unknown[]> {
  const timeoutMs = options?.timeout ?? 5000;
  const events: unknown[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeEventListener("progressNotification", handler);
      reject(
        new Error(
          `Timeout waiting for ${expectedCount} progressNotification events (got ${events.length}) after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    const handler = (e: Event) => {
      events.push((e as CustomEvent).detail);
      if (events.length >= expectedCount) {
        clearTimeout(timer);
        client.removeEventListener("progressNotification", handler);
        resolve(events);
      }
    };
    client.addEventListener("progressNotification", handler);
  });
}

export interface WaitForStateFileOptions {
  timeout?: number;
  interval?: number;
}

const DEBUG_WAIT_FOR_STATE_FILE = process.env.DEBUG_WAIT_FOR_STATE_FILE === "1";

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
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
export async function waitForStateFile<T = unknown>(
  filePath: string,
  predicate: (parsed: unknown) => boolean,
  options?: WaitForStateFileOptions,
): Promise<T> {
  const { timeout = 2000, interval = 50 } = options ?? {};
  let result: T | undefined;
  let attemptCount = 0;

  await vi.waitFor(
    async () => {
      attemptCount += 1;
      let raw: string;
      try {
        raw = await fs.readFile(filePath, "utf-8");
      } catch (readErr) {
        const msg = (readErr as NodeJS.ErrnoException).code ?? String(readErr);
        if (DEBUG_WAIT_FOR_STATE_FILE) {
          console.error(
            `[waitForStateFile] attempt ${attemptCount} read failed:`,
            msg,
          );
        }
        throw new Error(
          `waitForStateFile failed: file read error (${msg}). File: ${filePath}. Attempts: ${attemptCount}. Run with DEBUG_WAIT_FOR_STATE_FILE=1 for per-attempt logs.`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        if (DEBUG_WAIT_FOR_STATE_FILE) {
          console.error(
            `[waitForStateFile] attempt ${attemptCount} JSON parse failed. Raw (first 300):`,
            truncate(raw, 300),
          );
        }
        throw new Error(
          `waitForStateFile failed: JSON parse error (file may be mid-write or corrupt). File: ${filePath}. Attempts: ${attemptCount}. Raw snippet: ${truncate(raw, 200)}. Run with DEBUG_WAIT_FOR_STATE_FILE=1 for per-attempt logs.`,
        );
      }
      const predOk = predicate(parsed);
      if (DEBUG_WAIT_FOR_STATE_FILE) {
        console.error(
          `[waitForStateFile] attempt ${attemptCount} parse ok, predicate: ${predOk}`,
        );
      }
      if (!predOk) {
        throw new Error(
          `waitForStateFile failed: predicate returned false. File: ${filePath}. Attempts: ${attemptCount}. Parsed snippet: ${truncate(JSON.stringify(parsed), 200)}. Run with DEBUG_WAIT_FOR_STATE_FILE=1 for per-attempt logs.`,
        );
      }
      result = parsed as T;
      return true;
    },
    { timeout, interval },
  );
  return result!;
}
