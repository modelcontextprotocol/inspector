import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RemoteSessionSummary } from "@inspector/core/mcp/remote/index.js";
import type { ActiveSessionsApiOptions } from "../lib/activeSessions";
import { useActiveSessions } from "./useActiveSessions";

function session(sessionId: string): RemoteSessionSummary {
  return {
    sessionId,
    transport: "stdio",
    createdAt: "2026-03-01T00:00:00.000Z",
    consumerAttached: false,
    lastConsumerSeenAt: null,
    queuedEvents: 0,
    transportDead: false,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function apiWith(fetchFn: typeof fetch): () => ActiveSessionsApiOptions {
  return () => ({ baseUrl: "http://host", fetchFn });
}

describe("useActiveSessions", () => {
  it("starts closed and makes no request until opened", () => {
    const fetchFn = vi.fn<typeof fetch>();
    const { result } = renderHook(() => useActiveSessions(apiWith(fetchFn)));
    expect(result.current.opened).toBe(false);
    expect(result.current.sessions).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("opening fetches the list; closing hides it", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ sessions: [session("a")] }));
    const api = apiWith(fetchFn);
    const { result } = renderHook(() => useActiveSessions(api));

    act(() => result.current.open());
    expect(result.current.opened).toBe(true);
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.loading).toBe(false);
    expect(result.current.capturedAt).toBeGreaterThan(0);

    act(() => result.current.close());
    expect(result.current.opened).toBe(false);
  });

  it("surfaces a failed list as an error, and clears it on the next success", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: "nope" }, 500))
      .mockResolvedValueOnce(json({ sessions: [] }));
    const api = apiWith(fetchFn);
    const { result } = renderHook(() => useActiveSessions(api));

    await act(() => result.current.refresh());
    expect(result.current.error).toBe("Listing sessions failed: nope");

    await act(() => result.current.refresh());
    expect(result.current.error).toBeUndefined();
  });

  it("drops a response that lands after a newer request", async () => {
    let releaseSlow: (r: Response) => void = () => {};
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (releaseSlow = resolve)),
      )
      .mockResolvedValueOnce(json({ sessions: [session("fresh")] }));
    const api = apiWith(fetchFn);
    const { result } = renderHook(() => useActiveSessions(api));

    let slow: Promise<void> = Promise.resolve();
    act(() => {
      slow = result.current.refresh();
    });
    await act(() => result.current.refresh());
    expect(result.current.sessions.map((s) => s.sessionId)).toEqual(["fresh"]);

    await act(async () => {
      releaseSlow(json({ sessions: [session("stale")] }));
      await slow;
    });
    expect(result.current.sessions.map((s) => s.sessionId)).toEqual(["fresh"]);
    expect(result.current.loading).toBe(false);
  });

  it("drops a stale failure the same way", async () => {
    let failSlow: (e: Error) => void = () => {};
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () => new Promise<Response>((_resolve, reject) => (failSlow = reject)),
      )
      .mockResolvedValueOnce(json({ sessions: [] }));
    const api = apiWith(fetchFn);
    const { result } = renderHook(() => useActiveSessions(api));

    let slow: Promise<void> = Promise.resolve();
    act(() => {
      slow = result.current.refresh();
    });
    await act(() => result.current.refresh());
    await act(async () => {
      failSlow(new Error("late"));
      await slow;
    });
    expect(result.current.error).toBeUndefined();
  });

  it("terminate deletes the session and re-lists", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ sessions: [] }));
    const api = apiWith(fetchFn);
    const { result } = renderHook(() => useActiveSessions(api));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.terminate("a");
    });
    expect(result.current.terminatingId).toBe("a");
    await act(() => pending);

    expect(result.current.terminatingId).toBeUndefined();
    expect(fetchFn.mock.calls.map(([, init]) => init?.method)).toEqual([
      "DELETE",
      "GET",
    ]);
  });

  it("a failed terminate reports the error and does not re-list over it", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: "Session not found" }, 404));
    const api = apiWith(fetchFn);
    const { result } = renderHook(() => useActiveSessions(api));

    await act(() => result.current.terminate("gone"));
    expect(result.current.error).toBe(
      "Terminating the session failed: Session not found",
    );
    expect(result.current.terminatingId).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
