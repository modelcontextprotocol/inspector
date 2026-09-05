import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { renderWithMantine } from "../test/renderWithMantine";
import {
  useInspectorStores,
  type UseInspectorStoresResult,
} from "./useInspectorStores";

// Every state manager is replaced by a no-op constructor that records its
// arguments, so these tests are about the *lifecycle* the hook owns — who is
// built, with what, and who is torn down — rather than about the stores.
const { built, destroyed, fakeState, listHook, pagedHook } = vi.hoisted(() => {
  const built: { name: string; args: unknown[]; destroy: () => void }[] = [];
  const destroyed: string[] = [];
  /** A no-op state manager that records how it was constructed. */
  const fakeState = (name: string) =>
    vi.fn(function (...args: unknown[]) {
      const instance = { destroy: vi.fn(() => destroyed.push(name)) };
      built.push({ name, args, destroy: instance.destroy });
      return instance;
    });
  /** An aggregate-list `core/react` hook returning a fixed list. */
  const listHook = (key: string, items: unknown[]) => () => ({
    [key]: items,
    error: null,
    listChanged: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    clearListChanged: vi.fn(),
  });
  /** A paged-list `core/react` hook returning a fixed page. */
  const pagedHook = (key: string, items: unknown[]) => () => ({
    [key]: items,
    nextCursor: undefined,
    pageCount: 1,
    error: null,
    loadPage: vi.fn().mockResolvedValue(undefined),
  });
  return { built, destroyed, fakeState, listHook, pagedHook };
});

vi.mock("@inspector/core/mcp/state/managedToolsState.js", () => ({
  ManagedToolsState: fakeState("managedToolsState"),
}));
vi.mock("@inspector/core/mcp/state/managedPromptsState.js", () => ({
  ManagedPromptsState: fakeState("managedPromptsState"),
}));
vi.mock("@inspector/core/mcp/state/managedResourcesState.js", () => ({
  ManagedResourcesState: fakeState("managedResourcesState"),
}));
vi.mock("@inspector/core/mcp/state/pagedToolsState.js", () => ({
  PagedToolsState: fakeState("pagedToolsState"),
}));
vi.mock("@inspector/core/mcp/state/pagedPromptsState.js", () => ({
  PagedPromptsState: fakeState("pagedPromptsState"),
}));
vi.mock("@inspector/core/mcp/state/pagedResourcesState.js", () => ({
  PagedResourcesState: fakeState("pagedResourcesState"),
}));
vi.mock("@inspector/core/mcp/state/managedResourceTemplatesState.js", () => ({
  ManagedResourceTemplatesState: fakeState("managedResourceTemplatesState"),
}));
vi.mock("@inspector/core/mcp/state/managedRequestorTasksState.js", () => ({
  ManagedRequestorTasksState: fakeState("managedRequestorTasksState"),
}));
vi.mock("@inspector/core/mcp/state/managedSkillsState.js", () => ({
  ManagedSkillsState: fakeState("managedSkillsState"),
}));
vi.mock("@inspector/core/mcp/state/resourceSubscriptionsState.js", () => ({
  ResourceSubscriptionsState: fakeState("resourceSubscriptionsState"),
}));
vi.mock("@inspector/core/mcp/state/messageLogState.js", () => ({
  MessageLogState: fakeState("messageLogState"),
}));
vi.mock("@inspector/core/mcp/state/fetchRequestLogState.js", () => ({
  FetchRequestLogState: fakeState("fetchRequestLogState"),
}));
vi.mock("@inspector/core/mcp/state/stderrLogState.js", () => ({
  StderrLogState: fakeState("stderrLogState"),
}));

// The `core/react` hooks are the store→React bridge and are tested in core;
// here they are stubs returning fixed lists, so the assertions about *which*
// list surfaces are about this hook's mode selection.
vi.mock("@inspector/core/react/useManagedTools.js", () => ({
  useManagedTools: listHook("tools", [{ name: "aggregate-tool" }]),
}));
vi.mock("@inspector/core/react/useManagedPrompts.js", () => ({
  useManagedPrompts: listHook("prompts", [{ name: "aggregate-prompt" }]),
}));
vi.mock("@inspector/core/react/useManagedResources.js", () => ({
  useManagedResources: listHook("resources", [{ uri: "aggregate://r" }]),
}));
vi.mock("@inspector/core/react/usePagedTools.js", () => ({
  usePagedTools: pagedHook("tools", [{ name: "paged-tool" }]),
}));
vi.mock("@inspector/core/react/usePagedPrompts.js", () => ({
  usePagedPrompts: pagedHook("prompts", [{ name: "paged-prompt" }]),
}));
vi.mock("@inspector/core/react/usePagedResources.js", () => ({
  usePagedResources: pagedHook("resources", [{ uri: "paged://r" }]),
}));
vi.mock("@inspector/core/react/useManagedResourceTemplates.js", () => ({
  useManagedResourceTemplates: () => ({
    resourceTemplates: [{ uriTemplate: "x://{id}" }],
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@inspector/core/react/useManagedRequestorTasks.js", () => ({
  useManagedRequestorTasks: () => ({
    tasks: [{ taskId: "t1" }],
    refresh: vi.fn().mockResolvedValue(undefined),
    clearCompleted: vi.fn(),
  }),
}));
vi.mock("@inspector/core/react/useManagedSkills.js", () => ({
  useManagedSkills: () => ({
    skills: [{ uri: "skill://s/SKILL.md" }],
    pageCount: 1,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@inspector/core/react/useResourceSubscriptions.js", () => ({
  useResourceSubscriptions: () => ({
    subscriptions: [{ uri: "sub://r" }],
    streamState: "listening",
  }),
}));
vi.mock("@inspector/core/react/useMessageLog.js", () => ({
  useMessageLog: () => ({ messages: [{ id: "m1" }] }),
}));
vi.mock("@inspector/core/react/useFetchRequestLog.js", () => ({
  useFetchRequestLog: () => ({ fetchRequests: [{ id: "f1" }] }),
}));
vi.mock("@inspector/core/react/useStderrLog.js", () => ({
  useStderrLog: () => ({ stderrLogs: [{ id: "s1" }] }),
}));

/**
 * A per-call identity token standing in for the client. Every store
 * constructor is mocked away below, so nothing here ever reads a property off
 * it — the assertions only check *which* value each constructor received, and
 * that a second `createStores` passes a different one. The double cast is what
 * that isolation buys: building a real `InspectorClient` would drag in a
 * transport and an environment to assert on object identity.
 */
const client = () =>
  ({ marker: Symbol("client") }) as unknown as InspectorClient;

const fetchLogOptions = {
  maxFetchRequests: 42,
  sessionId: "sess-1",
};

function harness(paginatedLists = false) {
  let latest: UseInspectorStoresResult | undefined;
  let renders = 0;
  function Probe({ paginated }: { paginated: boolean }) {
    latest = useInspectorStores({
      inspectorClient: null,
      connected: true,
      paginatedLists: paginated,
    });
    renders += 1;
    return null;
  }
  const { rerender } = renderWithMantine(<Probe paginated={paginatedLists} />);
  return {
    api: () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    renders: () => renders,
    run: (fn: (api: UseInspectorStoresResult) => void) =>
      act(() => {
        if (!latest) throw new Error("hook did not render");
        fn(latest);
      }),
    setPaginated: (next: boolean) =>
      act(() => rerender(<Probe paginated={next} />)),
  };
}

const STORE_NAMES = [
  "managedToolsState",
  "managedPromptsState",
  "managedResourcesState",
  "pagedToolsState",
  "pagedPromptsState",
  "pagedResourcesState",
  "managedResourceTemplatesState",
  "managedRequestorTasksState",
  "managedSkillsState",
  "resourceSubscriptionsState",
  "messageLogState",
  "fetchRequestLogState",
  "stderrLogState",
];

describe("useInspectorStores", () => {
  beforeEach(() => {
    built.length = 0;
    destroyed.length = 0;
  });

  describe("the lifecycle", () => {
    it("holds no stores before the first connect", () => {
      const h = harness();
      expect(h.api().stores).toBeNull();
      expect(h.api().fetchLogRef.current).toBeNull();
      expect(built).toHaveLength(0);
    });

    it("builds all thirteen stores against the client", () => {
      const h = harness();
      const c = client();
      h.run((api) => api.createStores(c, fetchLogOptions));
      expect(built.map((b) => b.name).sort()).toEqual([...STORE_NAMES].sort());
      for (const b of built) {
        expect(b.args[0]).toBe(c);
      }
      expect(Object.keys(h.api().stores ?? {}).sort()).toEqual(
        [...STORE_NAMES].sort(),
      );
    });

    it("hands the subscription store the resources state it just built", () => {
      const h = harness();
      h.run((api) => api.createStores(client(), fetchLogOptions));
      const subs = built.find((b) => b.name === "resourceSubscriptionsState");
      expect(subs?.args[1]).toBe(h.api().stores?.managedResourcesState);
    });

    it("passes the per-connect fetch-log options straight through", () => {
      const h = harness();
      h.run((api) => api.createStores(client(), fetchLogOptions));
      const log = built.find((b) => b.name === "fetchRequestLogState");
      expect(log?.args[1]).toBe(fetchLogOptions);
    });

    it("points fetchLogRef at the live fetch log", () => {
      const h = harness();
      h.run((api) => api.createStores(client(), fetchLogOptions));
      expect(h.api().fetchLogRef.current).toBe(
        h.api().stores?.fetchRequestLogState,
      );
    });

    it("tears the previous set down before building the next", () => {
      const h = harness();
      h.run((api) => api.createStores(client(), fetchLogOptions));
      const first = h.api().stores;
      h.run((api) => api.createStores(client(), fetchLogOptions));
      expect(destroyed.sort()).toEqual([...STORE_NAMES].sort());
      expect(h.api().stores).not.toBe(first);
    });

    it("advances the session nonce on both create and destroy", () => {
      // It names one connected session and must never repeat across a
      // reconnect — `SkillsScreen` keys async verification state on it, and a
      // repeated value would let one session's result land in another.
      const h = harness();
      const seen = new Set<number>([h.api().sessionNonce]);
      h.run((api) => api.createStores(client(), fetchLogOptions));
      seen.add(h.api().sessionNonce);
      h.run((api) => api.destroyStores());
      seen.add(h.api().sessionNonce);
      h.run((api) => api.createStores(client(), fetchLogOptions));
      seen.add(h.api().sessionNonce);
      expect(seen.size).toBe(4);
    });

    it("destroys and clears on destroyStores", () => {
      const h = harness();
      h.run((api) => api.createStores(client(), fetchLogOptions));
      h.run((api) => api.destroyStores());
      expect(destroyed.sort()).toEqual([...STORE_NAMES].sort());
      expect(h.api().stores).toBeNull();
      expect(h.api().fetchLogRef.current).toBeNull();
    });

    it("no-ops when destroyStores runs with nothing live", () => {
      const h = harness();
      h.run((api) => api.destroyStores());
      expect(destroyed).toHaveLength(0);
      expect(h.api().stores).toBeNull();
    });

    it("keeps createStores and destroyStores stable across renders", () => {
      const h = harness();
      const create = h.api().createStores;
      const destroy = h.api().destroyStores;
      h.run((api) => api.createStores(client(), fetchLogOptions));
      expect(h.renders()).toBeGreaterThan(1);
      expect(h.api().createStores).toBe(create);
      expect(h.api().destroyStores).toBe(destroy);
    });
  });

  describe("the display source", () => {
    it("reads the aggregate lists in all-pages mode", () => {
      const h = harness(false);
      expect(h.api().toolsPagination.items).toEqual([
        { name: "aggregate-tool" },
      ]);
      expect(h.api().promptsPagination.items).toEqual([
        { name: "aggregate-prompt" },
      ]);
      expect(h.api().resourcesPagination.items).toEqual([
        { uri: "aggregate://r" },
      ]);
    });

    it("switches to the paged lists when pagination is on", () => {
      const h = harness(false);
      h.setPaginated(true);
      expect(h.api().toolsPagination.items).toEqual([{ name: "paged-tool" }]);
      expect(h.api().promptsPagination.items).toEqual([
        { name: "paged-prompt" },
      ]);
      expect(h.api().resourcesPagination.items).toEqual([{ uri: "paged://r" }]);
    });

    it("surfaces the remaining store-backed views", () => {
      const h = harness();
      const api = h.api();
      expect(api.resourceTemplates).toEqual([{ uriTemplate: "x://{id}" }]);
      expect(api.tasks).toEqual([{ taskId: "t1" }]);
      expect(api.subscriptions).toEqual([{ uri: "sub://r" }]);
      expect(api.subscriptionStreamState).toBe("listening");
      expect(api.messages).toEqual([{ id: "m1" }]);
      expect(api.fetchRequests).toEqual([{ id: "f1" }]);
      expect(api.stderrLogs).toEqual([{ id: "s1" }]);
    });
  });
});
