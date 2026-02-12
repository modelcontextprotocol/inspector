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

/**
 * Poll state file until `predicate(parsed)` returns true, then return the parsed value.
 * Uses vi.waitFor under the hood. For use with Zustand persist state.json files.
 */
export async function waitForStateFile<T = unknown>(
  filePath: string,
  predicate: (parsed: unknown) => boolean,
  options?: WaitForStateFileOptions,
): Promise<T> {
  const { timeout = 2000, interval = 50 } = options ?? {};
  let result: T | undefined;
  await vi.waitFor(
    async () => {
      const raw = await fs.readFile(filePath, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        // File may be mid-write or contain partial/corrupt JSON; retry
        throw new Error("waitForStateFile predicate not met");
      }
      if (!predicate(parsed)) {
        throw new Error("waitForStateFile predicate not met");
      }
      result = parsed as T;
      return true;
    },
    { timeout, interval },
  );
  return result!;
}
