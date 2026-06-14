import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FetchRequestEntry } from "@inspector/core/mcp/types";
import { FetchRequestLogState } from "@inspector/core/mcp/state/fetchRequestLogState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import type {
  InspectorClientStorage,
  InspectorClientSessionState,
} from "@inspector/core/mcp/sessionStorage";

function entry(id: string, url = `https://x/${id}`): FetchRequestEntry {
  return {
    id,
    timestamp: new Date(2026, 4, 13),
    method: "GET",
    url,
    requestHeaders: {},
    category: "transport",
  };
}

function makeStorage(
  initial: Record<string, InspectorClientSessionState> = {},
): InspectorClientStorage & {
  saves: Array<{ id: string; state: InspectorClientSessionState }>;
} {
  const store = new Map(Object.entries(initial));
  const saves: Array<{ id: string; state: InspectorClientSessionState }> = [];
  return {
    saves,
    async saveSession(sessionId, state) {
      saves.push({ id: sessionId, state });
      store.set(sessionId, state);
    },
    async loadSession(sessionId) {
      return store.get(sessionId);
    },
    async deleteSession(sessionId) {
      store.delete(sessionId);
    },
  };
}

describe("FetchRequestLogState", () => {
  let client: FakeInspectorClient;
  let state: FetchRequestLogState;

  type LoggerOption = NonNullable<
    ConstructorParameters<typeof FetchRequestLogState>[1]
  >["logger"];

  // Stub logger exposing just the `warn` method exercised on the drop path,
  // cast to the FetchRequestLogStateOptions["logger"] type. Returns both the
  // logger and the spy so a test can assert the diagnostic was emitted.
  function makeWarnLogger(): {
    logger: LoggerOption;
    warn: ReturnType<typeof vi.fn>;
  } {
    const warn = vi.fn();
    return { logger: { warn } as unknown as LoggerOption, warn };
  }

  // Build a state wired to a stub logger so the diagnostic on the rotated-out
  // drop path can be asserted.
  function makeLoggedState(
    logger: LoggerOption,
    extra: Partial<
      NonNullable<ConstructorParameters<typeof FetchRequestLogState>[1]>
    > = {},
  ): FetchRequestLogState {
    return new FetchRequestLogState(client, { logger, ...extra });
  }

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new FetchRequestLogState(client);
  });

  it("starts empty and returns defensive copies", () => {
    expect(state.getFetchRequests()).toEqual([]);
    expect(state.getFetchRequests()).not.toBe(state.getFetchRequests());
  });

  it("appends entries and dispatches fetchRequest + fetchRequestsChange", () => {
    const seenSingle: FetchRequestEntry[] = [];
    const seenFull: FetchRequestEntry[][] = [];
    state.addEventListener("fetchRequest", (e) => seenSingle.push(e.detail));
    state.addEventListener("fetchRequestsChange", (e) =>
      seenFull.push(e.detail),
    );

    client.dispatchTypedEvent("fetchRequest", entry("a"));
    client.dispatchTypedEvent("fetchRequest", entry("b"));

    expect(state.getFetchRequests().map((e) => e.id)).toEqual(["a", "b"]);
    expect(seenSingle).toHaveLength(2);
    expect(seenFull).toHaveLength(2);
  });

  it("trims the oldest entries when maxFetchRequests is exceeded", () => {
    const small = new FetchRequestLogState(client, { maxFetchRequests: 2 });
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    client.dispatchTypedEvent("fetchRequest", entry("b"));
    client.dispatchTypedEvent("fetchRequest", entry("c"));
    expect(small.getFetchRequests().map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("does not trim when maxFetchRequests is 0", () => {
    const big = new FetchRequestLogState(client, { maxFetchRequests: 0 });
    for (let i = 0; i < 5; i++) {
      client.dispatchTypedEvent("fetchRequest", entry(`m${i}`));
    }
    expect(big.getFetchRequests()).toHaveLength(5);
  });

  it("clearFetchRequests dispatches when the list was non-empty", () => {
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    let dispatched = false;
    state.addEventListener("fetchRequestsChange", () => (dispatched = true));
    state.clearFetchRequests();
    expect(dispatched).toBe(true);
    expect(state.getFetchRequests()).toEqual([]);
  });

  it("clearFetchRequests is a no-op when empty", () => {
    let dispatched = false;
    state.addEventListener("fetchRequestsChange", () => (dispatched = true));
    state.clearFetchRequests();
    expect(dispatched).toBe(false);
  });

  it("patches the matching entry's responseBody and re-emits on fetchRequestBodyUpdate", () => {
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    client.dispatchTypedEvent("fetchRequest", entry("b"));
    const seen: FetchRequestEntry[][] = [];
    state.addEventListener("fetchRequestsChange", (e) => seen.push(e.detail));

    client.dispatchTypedEvent("fetchRequestBodyUpdate", {
      id: "b",
      responseBody: "hello",
    });

    const entries = state.getFetchRequests();
    expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(entries[0]?.responseBody).toBeUndefined();
    expect(entries[1]?.responseBody).toBe("hello");
    expect(seen).toHaveLength(1);
  });

  it("silently ignores a body update for an unknown id when the log is not full (benign straggler)", () => {
    // Below capacity, an idx === -1 means the entry was cleared or never
    // existed — not a rotation drop — so it must NOT warn or emit the dropped
    // event (which would mislead the user into raising the log size).
    const { logger, warn } = makeWarnLogger();
    const logged = makeLoggedState(logger, { maxFetchRequests: 1000 });
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    let changes = 0;
    let dropped = 0;
    logged.addEventListener("fetchRequestsChange", () => changes++);
    logged.addEventListener("fetchRequestBodyDropped", () => dropped++);
    client.dispatchTypedEvent("fetchRequestBodyUpdate", {
      id: "nonexistent",
      responseBody: "x",
    });
    expect(changes).toBe(0);
    expect(dropped).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("traces and emits when the entry rotated out before the body arrived", () => {
    const { logger, warn } = makeWarnLogger();
    const logged = makeLoggedState(logger, { maxFetchRequests: 1 });
    const dropped: { id: string; maxFetchRequests: number }[] = [];
    logged.addEventListener("fetchRequestBodyDropped", (e) =>
      dropped.push(e.detail),
    );
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    // A newer request evicts "a" before its deferred body update arrives.
    client.dispatchTypedEvent("fetchRequest", entry("b"));
    client.dispatchTypedEvent("fetchRequestBodyUpdate", {
      id: "a",
      responseBody: "late",
    });
    expect(logged.getFetchRequests().map((e) => e.id)).toEqual(["b"]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchRequestId: "a",
        maxFetchRequests: 1,
      }),
      expect.stringContaining("rotated out"),
    );
    expect(dropped).toEqual([{ id: "a", maxFetchRequests: 1 }]);
  });

  it("does not flag a rotation drop when the log is unlimited (maxFetchRequests = 0)", () => {
    // With no cap, entries never rotate out, so an unknown id is always a
    // benign straggler — never a data-loss event.
    const { logger, warn } = makeWarnLogger();
    const logged = makeLoggedState(logger, { maxFetchRequests: 0 });
    let dropped = 0;
    logged.addEventListener("fetchRequestBodyDropped", () => dropped++);
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    client.dispatchTypedEvent("fetchRequestBodyUpdate", {
      id: "gone",
      responseBody: "x",
    });
    expect(warn).not.toHaveBeenCalled();
    expect(dropped).toBe(0);
  });

  it("setMaxFetchRequests trims live when shrunk and re-emits", () => {
    const sized = new FetchRequestLogState(client, { maxFetchRequests: 5 });
    for (let i = 0; i < 5; i++) {
      client.dispatchTypedEvent("fetchRequest", entry(`e${i}`));
    }
    const seen: string[][] = [];
    sized.addEventListener("fetchRequestsChange", (e) =>
      seen.push(e.detail.map((x) => x.id)),
    );
    sized.setMaxFetchRequests(2);
    // Trims to the newest 2 and emits once.
    expect(sized.getFetchRequests().map((e) => e.id)).toEqual(["e3", "e4"]);
    expect(seen).toEqual([["e3", "e4"]]);
  });

  it("setMaxFetchRequests is a no-op when unchanged or when growing within bounds", () => {
    const sized = new FetchRequestLogState(client, { maxFetchRequests: 2 });
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    client.dispatchTypedEvent("fetchRequest", entry("b"));
    let changes = 0;
    sized.addEventListener("fetchRequestsChange", () => changes++);
    sized.setMaxFetchRequests(2); // unchanged
    sized.setMaxFetchRequests(10); // grown — nothing to trim
    expect(changes).toBe(0);
    expect(sized.getFetchRequests().map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does NOT clear on connect or disconnect", () => {
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    client.dispatchTypedEvent("connect");
    expect(state.getFetchRequests().map((e) => e.id)).toEqual(["a"]);
    client.setStatus("disconnected");
    expect(state.getFetchRequests().map((e) => e.id)).toEqual(["a"]);
  });

  it("persists entries via saveSession when sessionStorage is provided", () => {
    const storage = makeStorage();
    const sessionState = new FetchRequestLogState(client, {
      sessionStorage: storage,
    });
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    client.dispatchTypedEvent("saveSession", { sessionId: "sess-1" });
    expect(storage.saves).toHaveLength(1);
    expect(storage.saves[0]!.id).toBe("sess-1");
    expect(storage.saves[0]!.state.fetchRequests.map((e) => e.id)).toEqual([
      "a",
    ]);
    sessionState.destroy();
  });

  it("swallows saveSession errors (fire and forget)", async () => {
    const storage = makeStorage();
    storage.saveSession = vi.fn().mockRejectedValue(new Error("boom"));
    new FetchRequestLogState(client, { sessionStorage: storage });
    expect(() =>
      client.dispatchTypedEvent("saveSession", { sessionId: "sess-1" }),
    ).not.toThrow();
    await Promise.resolve();
    expect(storage.saveSession).toHaveBeenCalled();
  });

  it("hydrates from storage when sessionId is provided and entries exist", async () => {
    const storage = makeStorage({
      "sess-restore": {
        fetchRequests: [entry("r1"), entry("r2")],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    const hydrated = new FetchRequestLogState(client, {
      sessionStorage: storage,
      sessionId: "sess-restore",
    });
    // hydrate is async via .then(); resolve microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(hydrated.getFetchRequests().map((e) => e.id)).toEqual(["r1", "r2"]);
    hydrated.destroy();
  });

  it("hydrate respects maxFetchRequests trimming", async () => {
    const storage = makeStorage({
      "sess-trim": {
        fetchRequests: [entry("r1"), entry("r2"), entry("r3")],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    const hydrated = new FetchRequestLogState(client, {
      sessionStorage: storage,
      sessionId: "sess-trim",
      maxFetchRequests: 2,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(hydrated.getFetchRequests().map((e) => e.id)).toEqual(["r2", "r3"]);
  });

  it("merges restored entries ahead of live ones, deduping by id, when load resolves after a live append", async () => {
    // Mirrors the `/oauth/callback` race: the resuming connect appends live
    // entries while the persisted pre-redirect log is still loading. The
    // restored (older) entries must land in front without clobbering the live
    // ones, and an id present in both must not duplicate.
    let resolveLoad:
      | ((s: InspectorClientSessionState | undefined) => void)
      | undefined;
    const storage: InspectorClientStorage = {
      async saveSession() {},
      loadSession: () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      async deleteSession() {},
    };
    const hydrated = new FetchRequestLogState(client, {
      sessionStorage: storage,
      sessionId: "sess-merge",
    });
    // Live entries arrive before the load resolves.
    client.dispatchTypedEvent("fetchRequest", entry("token"));
    client.dispatchTypedEvent("fetchRequest", entry("transport"));
    // Restored set includes the two pre-redirect entries plus a duplicate of
    // a live one ("token").
    resolveLoad?.({
      fetchRequests: [entry("discovery"), entry("register"), entry("token")],
      createdAt: 0,
      updatedAt: 0,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(hydrated.getFetchRequests().map((e) => e.id)).toEqual([
      "discovery",
      "register",
      "token",
      "transport",
    ]);
    hydrated.destroy();
  });

  it("hydrate is a no-op when restored entries are all already present", async () => {
    const storage = makeStorage({
      "sess-dup": {
        fetchRequests: [entry("a")],
        createdAt: 0,
        updatedAt: 0,
      },
    });
    const hydrated = new FetchRequestLogState(client, {
      sessionStorage: storage,
      sessionId: "sess-dup",
    });
    const changes: FetchRequestEntry[][] = [];
    hydrated.addEventListener("fetchRequestsChange", (e) =>
      changes.push(e.detail),
    );
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    changes.length = 0; // ignore the live-append dispatch
    await Promise.resolve();
    await Promise.resolve();
    // The only restored entry ("a") is already present → no merge, no event.
    expect(hydrated.getFetchRequests().map((e) => e.id)).toEqual(["a"]);
    expect(changes).toEqual([]);
    hydrated.destroy();
  });

  it("ignores hydration when destroy() happens first", async () => {
    let resolveLoad:
      | ((s: InspectorClientSessionState | undefined) => void)
      | undefined;
    const storage: InspectorClientStorage = {
      async saveSession() {},
      loadSession: () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      async deleteSession() {},
    };
    const hydrated = new FetchRequestLogState(client, {
      sessionStorage: storage,
      sessionId: "sess-late",
    });
    hydrated.destroy();
    resolveLoad?.({
      fetchRequests: [entry("late")],
      createdAt: 0,
      updatedAt: 0,
    });
    await Promise.resolve();
    expect(hydrated.getFetchRequests()).toEqual([]);
  });

  it("destroy stops listening and clears state", () => {
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    state.destroy();
    expect(state.getFetchRequests()).toEqual([]);
    client.dispatchTypedEvent("fetchRequest", entry("b"));
    expect(state.getFetchRequests()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
