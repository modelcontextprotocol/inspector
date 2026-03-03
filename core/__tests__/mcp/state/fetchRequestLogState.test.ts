/**
 * FetchRequestLogState tests use a mock protocol that dispatches "fetchRequest"
 * and "saveSession" to assert the manager's list, events, and session save/restore.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { FetchRequestEntry } from "../../../mcp/types.js";
import type { InspectorClientSessionState } from "../../../mcp/sessionStorage.js";
import { FetchRequestLogState } from "../../../mcp/state/fetchRequestLogState.js";

class MockFetchRequestProtocol extends EventTarget {
  dispatchFetchRequest(entry: FetchRequestEntry): void {
    this.dispatchEvent(new CustomEvent("fetchRequest", { detail: entry }));
  }

  dispatchSaveSession(sessionId: string): void {
    this.dispatchEvent(
      new CustomEvent("saveSession", { detail: { sessionId } }),
    );
  }
}

function createFetchRequestEntry(id: string): FetchRequestEntry {
  return {
    id: `fetch-${id}`,
    timestamp: new Date(),
    method: "GET",
    url: `https://example.com/${id}`,
    requestHeaders: {},
    category: "transport",
  };
}

type InspectorClient =
  import("../../../mcp/inspectorClient.js").InspectorClient;

describe("FetchRequestLogState", () => {
  let protocol: MockFetchRequestProtocol;
  let state: FetchRequestLogState | null = null;

  afterEach(() => {
    state?.destroy();
    state = null;
  });

  it("starts with empty fetch requests", () => {
    protocol = new MockFetchRequestProtocol();
    state = new FetchRequestLogState(protocol as unknown as InspectorClient);
    expect(state.getFetchRequests()).toEqual([]);
  });

  it("on protocol fetchRequest appends entry and dispatches fetchRequest + fetchRequestsChange", () => {
    protocol = new MockFetchRequestProtocol();
    state = new FetchRequestLogState(protocol as unknown as InspectorClient);
    const entry = createFetchRequestEntry("1");

    const singleDetails: FetchRequestEntry[] = [];
    const listDetails: FetchRequestEntry[][] = [];
    state.addEventListener("fetchRequest", (e) => singleDetails.push(e.detail));
    state.addEventListener("fetchRequestsChange", (e) =>
      listDetails.push(e.detail),
    );

    protocol.dispatchFetchRequest(entry);

    expect(state.getFetchRequests()).toHaveLength(1);
    expect(state.getFetchRequests()[0]).toBe(entry);
    expect(singleDetails).toHaveLength(1);
    expect(singleDetails[0]).toBe(entry);
    expect(listDetails).toHaveLength(1);
    expect(listDetails[0]).toHaveLength(1);
  });

  it("maxFetchRequests option trims oldest when at capacity", () => {
    protocol = new MockFetchRequestProtocol();
    state = new FetchRequestLogState(protocol as unknown as InspectorClient, {
      maxFetchRequests: 3,
    });
    protocol.dispatchFetchRequest(createFetchRequestEntry("1"));
    protocol.dispatchFetchRequest(createFetchRequestEntry("2"));
    protocol.dispatchFetchRequest(createFetchRequestEntry("3"));
    expect(state.getFetchRequests()).toHaveLength(3);
    protocol.dispatchFetchRequest(createFetchRequestEntry("4"));
    expect(state.getFetchRequests()).toHaveLength(3);
    expect(state.getFetchRequests().map((r) => r.id)).toEqual([
      "fetch-2",
      "fetch-3",
      "fetch-4",
    ]);
  });

  it("clearFetchRequests() empties list and dispatches fetchRequestsChange only when non-empty", () => {
    protocol = new MockFetchRequestProtocol();
    state = new FetchRequestLogState(protocol as unknown as InspectorClient);
    const listDetails: FetchRequestEntry[][] = [];
    state.addEventListener("fetchRequestsChange", (e) =>
      listDetails.push(e.detail),
    );
    state.clearFetchRequests();
    expect(listDetails).toHaveLength(0);

    protocol.dispatchFetchRequest(createFetchRequestEntry("1"));
    expect(listDetails).toHaveLength(1);
    state.clearFetchRequests();
    expect(state.getFetchRequests()).toEqual([]);
    expect(listDetails).toHaveLength(2);
    expect(listDetails[1]).toEqual([]);
  });

  it("destroy() unsubscribes and clears state", () => {
    protocol = new MockFetchRequestProtocol();
    state = new FetchRequestLogState(protocol as unknown as InspectorClient);
    protocol.dispatchFetchRequest(createFetchRequestEntry("1"));
    state.destroy();
    expect(state.getFetchRequests()).toEqual([]);
    protocol.dispatchFetchRequest(createFetchRequestEntry("2"));
    expect(state.getFetchRequests()).toEqual([]);
  });

  it("with sessionStorage + sessionId, saveSession event triggers save with current fetch requests", async () => {
    protocol = new MockFetchRequestProtocol();
    let savedState: InspectorClientSessionState | undefined;
    const sessionStorage = {
      saveSession: vi.fn(async (id: string, s: InspectorClientSessionState) => {
        savedState = s;
      }),
      loadSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => {}),
    };
    state = new FetchRequestLogState(protocol as unknown as InspectorClient, {
      sessionStorage,
      sessionId: "test-session",
    });
    protocol.dispatchFetchRequest(createFetchRequestEntry("1"));
    protocol.dispatchSaveSession("test-session");
    await vi.waitFor(() => {
      expect(sessionStorage.saveSession).toHaveBeenCalledWith("test-session", {
        fetchRequests: expect.any(Array),
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      });
    });
    expect(savedState!.fetchRequests).toHaveLength(1);
    expect(savedState!.fetchRequests[0].id).toBe("fetch-1");
  });

  it("with sessionStorage + sessionId, restores fetch requests from loadSession on creation", async () => {
    protocol = new MockFetchRequestProtocol();
    const restored = [
      {
        ...createFetchRequestEntry("restored-1"),
        id: "restored-1",
        timestamp: new Date(1000),
      },
    ];
    const sessionStorage = {
      saveSession: vi.fn(async () => {}),
      loadSession: vi.fn(async () => ({
        fetchRequests: restored,
        createdAt: 1000,
        updatedAt: 1000,
      })),
      deleteSession: vi.fn(async () => {}),
    };
    state = new FetchRequestLogState(protocol as unknown as InspectorClient, {
      sessionStorage,
      sessionId: "test-session",
    });
    await vi.waitFor(
      () => {
        expect(state!.getFetchRequests()).toHaveLength(1);
        expect(state!.getFetchRequests()[0].id).toBe("restored-1");
      },
      { timeout: 500, interval: 20 },
    );
  });
});
