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
