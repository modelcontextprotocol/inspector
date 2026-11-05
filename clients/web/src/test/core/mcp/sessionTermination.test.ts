/**
 * Unit coverage of `terminateSessionBestEffort` (#2924): which transports it
 * acts on, and that it never rejects — a refused or hung `DELETE` resolves
 * `false` so the caller's local teardown always runs. The live `DELETE` against
 * a real server is in `integration/mcp/inspectorClient-session-termination`.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SESSION_TERMINATE_TIMEOUT_MS,
  terminateSessionBestEffort,
} from "@inspector/core/mcp/sessionTermination.js";

function terminating(
  sessionId: string | undefined,
  terminateSession: () => Promise<void>,
) {
  return { sessionId, terminateSession: vi.fn(terminateSession) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("terminateSessionBestEffort", () => {
  it("does nothing for a transport with no terminateSession (stdio, SSE, remote)", async () => {
    expect(await terminateSessionBestEffort({ sessionId: "abc" })).toBe(false);
    expect(await terminateSessionBestEffort(null)).toBe(false);
    expect(await terminateSessionBestEffort(undefined)).toBe(false);
  });

  it("does nothing when the transport holds no session id", async () => {
    const t = terminating(undefined, () => Promise.resolve());
    expect(await terminateSessionBestEffort(t)).toBe(false);
    expect(t.terminateSession).not.toHaveBeenCalled();
  });

  it("resolves true when the server acknowledges", async () => {
    const t = terminating("abc", () => Promise.resolve());
    expect(await terminateSessionBestEffort(t)).toBe(true);
    expect(t.terminateSession).toHaveBeenCalledTimes(1);
  });

  it("resolves false, without rejecting, when the DELETE fails", async () => {
    const t = terminating("abc", () =>
      Promise.reject(new Error("Failed to terminate session")),
    );
    expect(await terminateSessionBestEffort(t)).toBe(false);
  });

  it("resolves false once the timeout elapses on a DELETE that never answers", async () => {
    vi.useFakeTimers();
    let rejectPending: (e: Error) => void = () => {};
    const t = terminating(
      "abc",
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPending = reject;
        }),
    );
    const result = terminateSessionBestEffort(t);
    await vi.advanceTimersByTimeAsync(SESSION_TERMINATE_TIMEOUT_MS);
    expect(await result).toBe(false);
    // The caller's close() aborting the DELETE later must not surface as an
    // unhandled rejection.
    rejectPending(new Error("aborted"));
    await Promise.resolve();
  });

  it("honours a caller-supplied timeout", async () => {
    vi.useFakeTimers();
    const t = terminating("abc", () => new Promise<void>(() => {}));
    const result = terminateSessionBestEffort(t, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toBe(false);
  });
});
