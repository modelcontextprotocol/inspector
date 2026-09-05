import { useCallback, useRef, useState } from "react";
import type {
  Prompt,
  Resource,
  ResourceTemplateType as ResourceTemplate,
  Task,
  Tool,
} from "@modelcontextprotocol/client";
import type {
  FetchRequestEntry,
  InspectorResourceSubscription,
  MessageEntry,
  ResourceSubscriptionStreamState,
  StderrLogEntry,
} from "@inspector/core/mcp/types.js";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState.js";
import { ManagedPromptsState } from "@inspector/core/mcp/state/managedPromptsState.js";
import { ManagedResourcesState } from "@inspector/core/mcp/state/managedResourcesState.js";
import { PagedToolsState } from "@inspector/core/mcp/state/pagedToolsState.js";
import { PagedPromptsState } from "@inspector/core/mcp/state/pagedPromptsState.js";
import { PagedResourcesState } from "@inspector/core/mcp/state/pagedResourcesState.js";
import { ManagedResourceTemplatesState } from "@inspector/core/mcp/state/managedResourceTemplatesState.js";
import { ManagedRequestorTasksState } from "@inspector/core/mcp/state/managedRequestorTasksState.js";
import { ManagedSkillsState } from "@inspector/core/mcp/state/managedSkillsState.js";
import { ResourceSubscriptionsState } from "@inspector/core/mcp/state/resourceSubscriptionsState.js";
import { MessageLogState } from "@inspector/core/mcp/state/messageLogState.js";
import {
  FetchRequestLogState,
  type FetchRequestLogStateOptions,
} from "@inspector/core/mcp/state/fetchRequestLogState.js";
import { StderrLogState } from "@inspector/core/mcp/state/stderrLogState.js";
import { useManagedTools } from "@inspector/core/react/useManagedTools.js";
import { useManagedPrompts } from "@inspector/core/react/useManagedPrompts.js";
import { useManagedResources } from "@inspector/core/react/useManagedResources.js";
import { usePagedTools } from "@inspector/core/react/usePagedTools.js";
import { usePagedPrompts } from "@inspector/core/react/usePagedPrompts.js";
import { usePagedResources } from "@inspector/core/react/usePagedResources.js";
import { useManagedResourceTemplates } from "@inspector/core/react/useManagedResourceTemplates.js";
import { useManagedRequestorTasks } from "@inspector/core/react/useManagedRequestorTasks.js";
import { useManagedSkills } from "@inspector/core/react/useManagedSkills.js";
import { useResourceSubscriptions } from "@inspector/core/react/useResourceSubscriptions.js";
import { useMessageLog } from "@inspector/core/react/useMessageLog.js";
import { useFetchRequestLog } from "@inspector/core/react/useFetchRequestLog.js";
import { useStderrLog } from "@inspector/core/react/useStderrLog.js";
import { usePaginatedList, type PaginatedListModel } from "./usePaginatedList";

/**
 * The thirteen per-session state managers. They are created together (one
 * `InspectorClient`, one set of stores) and torn down together, so they are
 * held as one slot rather than thirteen — a partially-replaced set would leave
 * some stores listening to a client the others had already left.
 */
export interface InspectorStores {
  managedToolsState: ManagedToolsState;
  managedPromptsState: ManagedPromptsState;
  managedResourcesState: ManagedResourcesState;
  pagedToolsState: PagedToolsState;
  pagedPromptsState: PagedPromptsState;
  pagedResourcesState: PagedResourcesState;
  managedResourceTemplatesState: ManagedResourceTemplatesState;
  managedRequestorTasksState: ManagedRequestorTasksState;
  managedSkillsState: ManagedSkillsState;
  resourceSubscriptionsState: ResourceSubscriptionsState;
  messageLogState: MessageLogState;
  fetchRequestLogState: FetchRequestLogState;
  stderrLogState: StderrLogState;
}

export interface UseInspectorStoresParams {
  /** The live client, or `null` before the first connect. */
  inspectorClient: InspectorClient | null;
  /** Whether the client is connected (masks paged progress when not). */
  connected: boolean;
  /** The active server's `paginatedLists` setting (#1721). */
  paginatedLists: boolean;
}

/** The `FetchRequestLogState` options that vary per server / per connect. */
export type FetchLogOptions = Pick<
  FetchRequestLogStateOptions,
  "sessionStorage" | "logger" | "maxFetchRequests" | "sessionId"
>;

export interface UseInspectorStoresResult {
  /** The live stores, or `null` before the first connect / after teardown. */
  stores: InspectorStores | null;
  /**
   * Bumped on every `createStores` **and** every `destroyStores`, so it names
   * one connected session and never repeats across a reconnect.
   *
   * Screens that hold async state keyed by *content* need this in the key:
   * `SkillsScreen` stays mounted across a disconnect, so a verification still
   * in flight for server A could otherwise land after a switch to server B and
   * report a verdict for an identical-looking entry that was never read from B
   * (#2234).
   */
  sessionNonce: number;
  /**
   * Build a fresh set of stores for `client`, tearing down whatever set is
   * live first. Stable, so callers need no dependency on the current stores.
   */
  createStores: (
    client: InspectorClient,
    fetchLogOptions: FetchLogOptions,
  ) => void;
  /**
   * Destroy the live stores and clear the slot. Each `destroy()` unsubscribes
   * that store from its client's events. Stable, and a no-op when nothing is
   * live.
   */
  destroyStores: () => void;
  /**
   * Always points at the live `FetchRequestLogState`, so a synchronous
   * pre-redirect hook can read the current Network log without being rebound
   * each time the active server (and its log state) changes.
   */
  fetchLogRef: React.RefObject<FetchRequestLogState | null>;

  // --- Aggregate ("all pages") list sources ---
  /** Re-fetch the whole aggregate list. Bypasses the pagination mode split. */
  refreshTools: () => Promise<unknown>;
  refreshPrompts: () => Promise<unknown>;
  refreshResources: () => Promise<unknown>;
  /** Fetch one page; `undefined` cursor = page 1 (replaces the paged list). */
  loadToolsPage: (cursor?: string) => Promise<unknown>;
  loadPromptsPage: (cursor?: string) => Promise<unknown>;
  loadResourcesPage: (cursor?: string) => Promise<unknown>;
  toolsListChanged: boolean;
  clearToolsListChanged: () => void;
  promptsListChanged: boolean;
  clearPromptsListChanged: () => void;
  resourcesListChanged: boolean;
  clearResourcesListChanged: () => void;
  resourceTemplates: ResourceTemplate[];
  resourceTemplatesLoadError: Error | null;
  refreshResourceTemplates: () => Promise<unknown>;

  // --- The display source for each list, by mode (#1721) ---
  toolsPagination: PaginatedListModel<Tool>;
  promptsPagination: PaginatedListModel<Prompt>;
  resourcesPagination: PaginatedListModel<Resource>;

  // --- Everything else the stores expose ---
  tasks: Task[];
  refreshTasks: () => Promise<unknown>;
  clearCompletedTasks: () => void;
  /** The server's skills (SEP-2640); empty when it declared no extension. */
  skills: SkillEntry[];
  /** Pages the last `skills/list` walk took. */
  skillsPageCount: number;
  skillsLoadError: Error | null;
  refreshSkills: () => Promise<unknown>;
  subscriptions: InspectorResourceSubscription[];
  subscriptionStreamState: ResourceSubscriptionStreamState;
  messages: MessageEntry[];
  fetchRequests: FetchRequestEntry[];
  stderrLogs: StderrLogEntry[];
}

/**
 * Owns the per-session state managers and the `core/react` hooks that read
 * them, so App.tsx sees one lifecycle (create / destroy) and the finished
 * lists rather than twelve state slots and their wiring.
 *
 * The lists come back already resolved for the active mode: in paginated mode
 * the paged stores drive the panels, otherwise the aggregate ones do.
 */
export function useInspectorStores({
  inspectorClient,
  connected,
  paginatedLists,
}: UseInspectorStoresParams): UseInspectorStoresResult {
  const [stores, setStores] = useState<InspectorStores | null>(null);
  // See `sessionNonce` above. A counter rather than the store object's identity
  // because it has to be usable as part of a string key.
  const [sessionNonce, setSessionNonce] = useState(0);
  // Mirrors `stores` so `destroyStores` can read the live set without taking a
  // dependency on it — which is what keeps every caller's callback stable.
  const storesRef = useRef<InspectorStores | null>(null);
  const fetchLogRef = useRef<FetchRequestLogState | null>(null);

  const destroyStores = useCallback(() => {
    const live = storesRef.current;
    if (live) {
      for (const store of Object.values(live)) {
        store.destroy();
      }
    }
    storesRef.current = null;
    fetchLogRef.current = null;
    setStores(null);
    setSessionNonce((n) => n + 1);
  }, []);

  const createStores = useCallback(
    (client: InspectorClient, fetchLogOptions: FetchLogOptions) => {
      destroyStores();
      // ResourceSubscriptionsState consults the managed resources list to
      // resolve subscribed URIs to full Resource objects (so the subscription
      // tile shows the server-supplied name/title), so it is handed the
      // freshly created state directly rather than read back from React.
      const managedResourcesState = new ManagedResourcesState(client);
      const fetchRequestLogState = new FetchRequestLogState(
        client,
        fetchLogOptions,
      );
      const next: InspectorStores = {
        managedToolsState: new ManagedToolsState(client),
        managedPromptsState: new ManagedPromptsState(client),
        managedResourcesState,
        pagedToolsState: new PagedToolsState(client),
        pagedPromptsState: new PagedPromptsState(client),
        pagedResourcesState: new PagedResourcesState(client),
        managedResourceTemplatesState: new ManagedResourceTemplatesState(
          client,
        ),
        managedRequestorTasksState: new ManagedRequestorTasksState(client),
        managedSkillsState: new ManagedSkillsState(client),
        resourceSubscriptionsState: new ResourceSubscriptionsState(
          client,
          managedResourcesState,
        ),
        messageLogState: new MessageLogState(client),
        fetchRequestLogState,
        stderrLogState: new StderrLogState(client),
      };
      storesRef.current = next;
      fetchLogRef.current = fetchRequestLogState;
      setStores(next);
      setSessionNonce((n) => n + 1);
    },
    [destroyStores],
  );

  // Each hook degrades to an empty result while its store is null, so the
  // pre-connect render is well-defined without a branch here.
  const {
    tools: managedTools,
    error: toolsLoadError,
    listChanged: toolsListChanged,
    refresh: refreshTools,
    clearListChanged: clearToolsListChanged,
  } = useManagedTools(inspectorClient, stores?.managedToolsState ?? null);
  const {
    prompts: managedPrompts,
    error: promptsLoadError,
    listChanged: promptsListChanged,
    refresh: refreshPrompts,
    clearListChanged: clearPromptsListChanged,
  } = useManagedPrompts(inspectorClient, stores?.managedPromptsState ?? null);
  const {
    resources: managedResources,
    error: resourcesLoadError,
    listChanged: resourcesListChanged,
    refresh: refreshResources,
    clearListChanged: clearResourcesListChanged,
  } = useManagedResources(
    inspectorClient,
    stores?.managedResourcesState ?? null,
  );
  const {
    resourceTemplates,
    error: resourceTemplatesLoadError,
    refresh: refreshResourceTemplates,
  } = useManagedResourceTemplates(
    inspectorClient,
    stores?.managedResourceTemplatesState ?? null,
  );
  // Paged (paginated) list sources. When `paginatedLists` is on the managed
  // states skip their all-page walk and these drive the sidebar instead (#1721).
  const {
    tools: pagedTools,
    nextCursor: pagedToolsCursor,
    pageCount: pagedToolsPageCount,
    error: pagedToolsLoadError,
    loadPage: loadToolsPage,
  } = usePagedTools(inspectorClient, stores?.pagedToolsState ?? null);
  const {
    prompts: pagedPrompts,
    nextCursor: pagedPromptsCursor,
    pageCount: pagedPromptsPageCount,
    error: pagedPromptsLoadError,
    loadPage: loadPromptsPage,
  } = usePagedPrompts(inspectorClient, stores?.pagedPromptsState ?? null);
  const {
    resources: pagedResources,
    nextCursor: pagedResourcesCursor,
    pageCount: pagedResourcesPageCount,
    error: pagedResourcesLoadError,
    loadPage: loadResourcesPage,
  } = usePagedResources(inspectorClient, stores?.pagedResourcesState ?? null);

  const toolsPagination = usePaginatedList({
    connected,
    paginated: paginatedLists,
    managedItems: managedTools,
    managedRefresh: refreshTools,
    managedError: toolsLoadError,
    pagedItems: pagedTools,
    pagedNextCursor: pagedToolsCursor,
    pagedPageCount: pagedToolsPageCount,
    pagedError: pagedToolsLoadError,
    loadPage: loadToolsPage,
  });
  const promptsPagination = usePaginatedList({
    connected,
    paginated: paginatedLists,
    managedItems: managedPrompts,
    managedRefresh: refreshPrompts,
    managedError: promptsLoadError,
    pagedItems: pagedPrompts,
    pagedNextCursor: pagedPromptsCursor,
    pagedPageCount: pagedPromptsPageCount,
    pagedError: pagedPromptsLoadError,
    loadPage: loadPromptsPage,
  });
  const resourcesPagination = usePaginatedList({
    connected,
    paginated: paginatedLists,
    managedItems: managedResources,
    managedRefresh: refreshResources,
    managedError: resourcesLoadError,
    pagedItems: pagedResources,
    pagedNextCursor: pagedResourcesCursor,
    pagedPageCount: pagedResourcesPageCount,
    pagedError: pagedResourcesLoadError,
    loadPage: loadResourcesPage,
  });

  const {
    tasks,
    refresh: refreshTasks,
    clearCompleted: clearCompletedTasks,
  } = useManagedRequestorTasks(
    inspectorClient,
    stores?.managedRequestorTasksState ?? null,
  );
  // Skills (SEP-2640). The store no-ops when the server declared no extension,
  // so this hook is unconditional like the rest — the Skills *tab* is what is
  // gated, in `InspectorView`.
  const {
    skills,
    pageCount: skillsPageCount,
    error: skillsLoadError,
    refresh: refreshSkills,
  } = useManagedSkills(inspectorClient, stores?.managedSkillsState ?? null);
  const { subscriptions, streamState: subscriptionStreamState } =
    useResourceSubscriptions(stores?.resourceSubscriptionsState ?? null);
  const { messages } = useMessageLog(stores?.messageLogState ?? null);
  const { fetchRequests } = useFetchRequestLog(
    stores?.fetchRequestLogState ?? null,
  );
  const { stderrLogs } = useStderrLog(stores?.stderrLogState ?? null);

  return {
    stores,
    sessionNonce,
    createStores,
    destroyStores,
    fetchLogRef,
    refreshTools,
    refreshPrompts,
    refreshResources,
    loadToolsPage,
    loadPromptsPage,
    loadResourcesPage,
    toolsListChanged,
    clearToolsListChanged,
    promptsListChanged,
    clearPromptsListChanged,
    resourcesListChanged,
    clearResourcesListChanged,
    resourceTemplates,
    resourceTemplatesLoadError,
    refreshResourceTemplates,
    toolsPagination,
    promptsPagination,
    resourcesPagination,
    tasks,
    refreshTasks,
    clearCompletedTasks,
    skills,
    skillsPageCount,
    skillsLoadError,
    refreshSkills,
    subscriptions,
    subscriptionStreamState,
    messages,
    fetchRequests,
    stderrLogs,
  };
}
