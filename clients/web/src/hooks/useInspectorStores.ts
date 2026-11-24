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
import type { SkillEntry } from "@inspector/core/extension/skills/schemas.js";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import type { ExcludedEventType } from "@inspector/core/extension/events/headers.js";
import type {
  EventLogEntry,
  EventSubscription,
} from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { InspectorClientProtocol } from "@inspector/core/mcp/inspectorClientProtocol.js";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState.js";
import { ManagedPromptsState } from "@inspector/core/mcp/state/managedPromptsState.js";
import { ManagedResourcesState } from "@inspector/core/mcp/state/managedResourcesState.js";
import { PagedToolsState } from "@inspector/core/mcp/state/pagedToolsState.js";
import { PagedPromptsState } from "@inspector/core/mcp/state/pagedPromptsState.js";
import { PagedResourcesState } from "@inspector/core/mcp/state/pagedResourcesState.js";
import { ManagedResourceTemplatesState } from "@inspector/core/mcp/state/managedResourceTemplatesState.js";
import { ManagedRequestorTasksState } from "@inspector/core/mcp/state/managedRequestorTasksState.js";
import { ManagedSkillsState } from "@inspector/core/mcp/state/managedSkillsState.js";
import { ManagedEventsState } from "@inspector/core/mcp/state/managedEventsState.js";
import { PagedEventsState } from "@inspector/core/mcp/state/pagedEventsState.js";
import { EventSubscriptionsState } from "@inspector/core/mcp/state/eventSubscriptionsState.js";
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
import { useManagedEvents } from "@inspector/core/react/useManagedEvents.js";
import { usePagedEvents } from "@inspector/core/react/usePagedEvents.js";
import {
  useEventLog,
  useEventSubscriptions,
} from "@inspector/core/react/useEventSubscriptions.js";
import { useStoreSnapshot } from "@inspector/core/react/useStoreSnapshot.js";
import { useResourceSubscriptions } from "@inspector/core/react/useResourceSubscriptions.js";
import { useMessageLog } from "@inspector/core/react/useMessageLog.js";
import { useFetchRequestLog } from "@inspector/core/react/useFetchRequestLog.js";
import { useStderrLog } from "@inspector/core/react/useStderrLog.js";
import { animationFrameScheduler } from "@inspector/core/react/notifyScheduler.js";
import { usePaginatedList, type PaginatedListModel } from "./usePaginatedList";

/**
 * The per-session state managers. They are created together (one
 * `InspectorClient`, one set of stores) and torn down together, so they are
 * held as one slot rather than one per store — a partially-replaced set would
 * leave some stores listening to a client the others had already left.
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
  /** Events (SEP-3415, #3030): the event types, all pages or one at a time. */
  managedEventsState: ManagedEventsState;
  pagedEventsState: PagedEventsState;
  /** The client-owned poll/push subscription registry (#3029). */
  eventSubscriptionsState: EventSubscriptionsState;
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
  // --- Events (SEP-3415, #3030) ---
  eventsPagination: PaginatedListModel<EventType>;
  /** Excluded for invalid `x-mcp-header`s, from whichever source is active. */
  excludedEventTypes: ExcludedEventType[];
  eventsListChanged: boolean;
  clearEventsListChanged: () => void;
  refreshEvents: () => Promise<unknown>;
  loadEventsPage: (cursor?: string) => Promise<unknown>;
  eventSubscriptions: EventSubscription[];
  eventLog: EventLogEntry[];
  subscriptions: InspectorResourceSubscription[];
  subscriptionStreamState: ResourceSubscriptionStreamState;
  messages: MessageEntry[];
  fetchRequests: FetchRequestEntry[];
  stderrLogs: StderrLogEntry[];
}

/**
 * The re-list a contract-changing termination triggers (#3029). The engine
 * decides its resubscribe offer from the full list the managed store walks; in
 * paginated mode the tab shows the paged store instead, so page 1 is reloaded
 * too, or the sidebar and form would keep the stale descriptor the offer was
 * not based on. That reload's failure is the paged store's to show; it does
 * not fail the re-list.
 */
export async function relistEvents(
  client: InspectorClient,
  managed: ManagedEventsState,
  paged: PagedEventsState,
): Promise<EventType[]> {
  const eventTypes = await managed.refresh();
  if (client.getServerSettings()?.paginatedLists) {
    // Cleared first: a Load-more still in flight would otherwise make this
    // page-1 load a no-op under the store's in-flight guard and then commit
    // its stale page. Clearing ends that load's generation.
    paged.clear();
    await paged.loadPage(undefined).catch(() => {});
  }
  return eventTypes;
}

/** Module scope: a `useStoreSnapshot` fallback and reader must be stable. */
const NO_EXCLUDED_EVENT_TYPES: ExcludedEventType[] = [];
// Typed by the protocol, where the Events surface is optional: a client
// without it (an older implementation, a test double) has excluded nothing.
const readExcludedEventTypes = (
  client: InspectorClientProtocol,
): ExcludedEventType[] =>
  client.getExcludedEventTypes?.() ?? NO_EXCLUDED_EVENT_TYPES;

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
      // The subscription engine re-lists through the managed store on a
      // contract-changing termination, so the list the Events tab shows is the
      // one its resubscribe offer was based on.
      const managedEventsState = new ManagedEventsState(client);
      const pagedEventsState = new PagedEventsState(client);
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
        managedEventsState,
        pagedEventsState,
        eventSubscriptionsState: new EventSubscriptionsState(client, {
          relist: () =>
            relistEvents(client, managedEventsState, pagedEventsState),
        }),
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
    loaded: managedToolsLoaded,
    refresh: refreshTools,
    clearListChanged: clearToolsListChanged,
  } = useManagedTools(inspectorClient, stores?.managedToolsState ?? null);
  const {
    prompts: managedPrompts,
    error: promptsLoadError,
    listChanged: promptsListChanged,
    loaded: managedPromptsLoaded,
    refresh: refreshPrompts,
    clearListChanged: clearPromptsListChanged,
  } = useManagedPrompts(inspectorClient, stores?.managedPromptsState ?? null);
  const {
    resources: managedResources,
    error: resourcesLoadError,
    listChanged: resourcesListChanged,
    loaded: managedResourcesLoaded,
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
    managedLoaded: managedToolsLoaded,
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
    managedLoaded: managedPromptsLoaded,
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
    managedLoaded: managedResourcesLoaded,
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
  // Events (SEP-3415, #3030). The stores no-op unless the connection offers
  // the extension, so these are unconditional too; the tab is what is gated.
  const {
    eventTypes: managedEventTypes,
    error: eventsLoadError,
    listChanged: eventsListChanged,
    loaded: managedEventsLoaded,
    refresh: refreshEvents,
    clearListChanged: clearEventsListChanged,
  } = useManagedEvents(inspectorClient, stores?.managedEventsState ?? null);
  const {
    eventTypes: pagedEventTypes,
    excluded: pagedExcludedEventTypes,
    nextCursor: pagedEventsCursor,
    pageCount: pagedEventsPageCount,
    error: pagedEventsLoadError,
    loadPage: loadEventsPage,
  } = usePagedEvents(inspectorClient, stores?.pagedEventsState ?? null);
  const eventsPagination = usePaginatedList({
    connected,
    paginated: paginatedLists,
    managedItems: managedEventTypes,
    managedRefresh: refreshEvents,
    managedError: eventsLoadError,
    managedLoaded: managedEventsLoaded,
    pagedItems: pagedEventTypes,
    pagedNextCursor: pagedEventsCursor,
    pagedPageCount: pagedEventsPageCount,
    pagedError: pagedEventsLoadError,
    loadPage: loadEventsPage,
  });
  // The aggregate walk reports its exclusions on the client; a paged walk
  // collects them page by page in its own store.
  const managedExcludedEventTypes = useStoreSnapshot(
    inspectorClient,
    "excludedEventTypesChange",
    readExcludedEventTypes,
    NO_EXCLUDED_EVENT_TYPES,
  );
  const excludedEventTypes = paginatedLists
    ? pagedExcludedEventTypes
    : managedExcludedEventTypes;
  const eventSubscriptions = useEventSubscriptions(
    stores?.eventSubscriptionsState ?? null,
  );
  // Coalesced like the other logs: a backlog drain appends many at once.
  const eventLog = useEventLog(
    stores?.eventSubscriptionsState ?? null,
    animationFrameScheduler,
  );
  const { subscriptions, streamState: subscriptionStreamState } =
    useResourceSubscriptions(stores?.resourceSubscriptionsState ?? null);
  // The three logs dispatch once per entry, and these lists are read by `App`,
  // so each notification re-rendered the whole page — capping a load test at
  // ~10 calls/s with the monitoring sidebar open (#2928). Coalescing to the
  // animation frame makes a burst cost one render per frame instead of one per
  // message; the hooks still re-read the live store, so no entry is lost.
  const { messages } = useMessageLog(
    stores?.messageLogState ?? null,
    animationFrameScheduler,
  );
  const { fetchRequests } = useFetchRequestLog(
    stores?.fetchRequestLogState ?? null,
    animationFrameScheduler,
  );
  const { stderrLogs } = useStderrLog(
    stores?.stderrLogState ?? null,
    animationFrameScheduler,
  );

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
    eventsPagination,
    excludedEventTypes,
    eventsListChanged,
    clearEventsListChanged,
    refreshEvents,
    loadEventsPage,
    eventSubscriptions,
    eventLog,
    subscriptions,
    subscriptionStreamState,
    messages,
    fetchRequests,
    stderrLogs,
  };
}
