import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type {
  LoggingLevel,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import type { JsonValue } from "@inspector/core/mcp/index.js";
import type {
  InspectorServerSettings,
  ServerEntry,
} from "@inspector/core/mcp/types.js";
import { DEFAULT_TASK_TTL_MS } from "@inspector/core/mcp/types.js";
import {
  getUrlElicitationsFromError,
  UrlElicitationLoopError,
} from "@inspector/core/mcp/urlElicitation.js";
import { ToolCallCancelledError } from "@inspector/core/mcp/toolCallCancelledError.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { ServerListReloadError } from "@inspector/core/react/useServers.js";
import type { SessionRef } from "./useSessionRef";
import type { LastPersistedSettings } from "./useLastPersistedSettings";
import type { PaginatedListsOverride } from "./usePaginatedListsOverride";
import type { PaginatedListModel } from "./usePaginatedList";
import type { TabUiStateSetters } from "./useTabUiState";
import type { OAuthRecovery } from "./useOAuthRecovery";
import { refreshingPersist } from "../lib/refreshingPersist";
import type {
  ToolCallState,
  ToolsUiState,
} from "../components/screens/ToolsScreen/ToolsScreen";
import type { GetPromptState } from "../components/screens/PromptsScreen/PromptsScreen";
import type { ReadResourceState } from "../components/screens/ResourcesScreen/ResourcesScreen";
import type { SkillFileContents } from "../utils/skillFileBytes";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas.js";
import { UrlElicitationErrorToastMessage } from "../components/elements/Toasts/UrlElicitationErrorToastMessage";
import {
  errorCodeOf,
  errorMessage,
  formatErrorDetails,
} from "../utils/errorFormat";
import { EMPTY_SETTINGS } from "../utils/serverSettingsDefaults";
import type { StepUpSource } from "../utils/stepUp";

/**
 * The three in-flight result panels, plus the two ways something other than a
 * command writes to them.
 *
 * Split out of `useServerCommands` below only because of call order — the same
 * reason `useHandshakeTelemetry` sits beside `useConnectionLifecycle`.
 * `useOAuthRecovery` drops these panels on a session reset and routes a
 * step-up failure into whichever one issued the command, and it runs *before*
 * the commands hook, which consumes that hook's recovery wrappers. So the
 * state has to exist earlier than the hook that otherwise owns it; keeping the
 * pair here rather than in `App.tsx` keeps both halves in the file that owns
 * the panels.
 */
export interface ResultPanels {
  toolCallState: ToolCallState | undefined;
  getPromptState: GetPromptState | undefined;
  readResourceState: ReadResourceState | undefined;
  setToolCallState: Dispatch<SetStateAction<ToolCallState | undefined>>;
  setGetPromptState: Dispatch<SetStateAction<GetPromptState | undefined>>;
  setReadResourceState: Dispatch<SetStateAction<ReadResourceState | undefined>>;
  /** Drops every in-flight result panel. */
  clearResultPanels: () => void;
  /**
   * Routes a step-up failure or cancellation to the panel that issued the
   * command. `app` and `ambient` have no panel of their own — the App bridge
   * surfaces its own message and an ambient challenge was never user-initiated
   * — so they fall through to the no-op arm.
   */
  setSourceScopedError: (source: StepUpSource, message: string) => void;
}

/** See {@link ResultPanels}. */
export function useResultPanels(): ResultPanels {
  // In-flight call panel state. Tracked here (rather than inside the
  // respective screens) so the panels can reflect pending → ok/error
  // transitions and so `onClear*` handlers can reset the panel without
  // remounting the screen.
  const [toolCallState, setToolCallState] = useState<ToolCallState | undefined>(
    undefined,
  );
  const [getPromptState, setGetPromptState] = useState<
    GetPromptState | undefined
  >(undefined);
  const [readResourceState, setReadResourceState] = useState<
    ReadResourceState | undefined
  >(undefined);

  const clearResultPanels = useCallback(() => {
    setToolCallState(undefined);
    setGetPromptState(undefined);
    setReadResourceState(undefined);
  }, []);

  const setSourceScopedError = useCallback(
    (source: StepUpSource, message: string) => {
      switch (source) {
        case "tool":
          setToolCallState({ status: "error", error: message });
          break;
        case "prompt":
          setGetPromptState((prev) =>
            prev ? { ...prev, status: "error", error: message } : prev,
          );
          break;
        case "resource":
          setReadResourceState((prev) =>
            prev ? { ...prev, status: "error", error: message } : prev,
          );
          break;
        default:
          break;
      }
    },
    [],
  );

  return {
    toolCallState,
    getPromptState,
    readResourceState,
    setToolCallState,
    setGetPromptState,
    setReadResourceState,
    clearResultPanels,
    setSourceScopedError,
  };
}

export interface UseServerCommandsOptions {
  /** The stable session mirror from `useSessionRef` (#2129). */
  sessionRef: SessionRef;
  servers: ServerEntry[];
  activeServerId: string | undefined;
  /** The active server's catalog entry — its `taskTtl` bounds a task call. */
  activeServer: ServerEntry | undefined;
  inspectorClient: InspectorClient | null;
  /** Whether the session is live; gates the loads a mode flip implies. */
  connected: boolean;
  /** Negotiated server capabilities — decides whether a call is taskable. */
  capabilities: ServerCapabilities | undefined;
  /** The aggregated tool list a `tools/call` resolves its name against. */
  tools: Tool[];
  /** The panels these commands write into; see {@link ResultPanels}. */
  panels: ResultPanels;
  /** The selected tool, so a *different* selection drops the stale result. */
  selectedToolKey: string | undefined;
  setToolsUi: TabUiStateSetters["setToolsUi"];
  /** Opens the raw-error modal for a non-spec URLElicitationRequired. */
  setUrlElicitationErrorDetails: (
    details: { toolName: string; details: string } | null,
  ) => void;
  /** The optimistic log levels the Logs tab renders. */
  setCurrentLogLevel: (level: LoggingLevel) => void;
  setModernLogLevel: (level: LoggingLevel | null) => void;
  /** The task id of the in-flight tool call, if it was task-augmented. */
  activeToolCallTaskIdRef: { current: string | undefined };
  clearCompletedTasks: () => void;
  refreshTasks: () => Promise<unknown>;
  /** Re-walk `skills/list` (SEP-2640). */
  refreshSkills: () => Promise<unknown>;

  // --- The list stores and their two fetch modes (#1721). ---
  paginatedLists: boolean;
  paginatedListsOverride: PaginatedListsOverride;
  toolsPagination: PaginatedListModel<Tool>;
  promptsPagination: PaginatedListModel<unknown>;
  resourcesPagination: PaginatedListModel<unknown>;
  refreshTools: () => Promise<unknown>;
  refreshPrompts: () => Promise<unknown>;
  refreshResources: () => Promise<unknown>;
  refreshResourceTemplates: () => Promise<unknown>;
  clearToolsListChanged: () => void;
  clearPromptsListChanged: () => void;
  clearResourcesListChanged: () => void;
  loadToolsPage: (cursor: string | undefined) => Promise<unknown>;
  loadPromptsPage: (cursor: string | undefined) => Promise<unknown>;
  loadResourcesPage: (cursor: string | undefined) => Promise<unknown>;

  // --- Persisting the pagination setting (#1721/#2089/#2095). ---
  /** What each settings write actually put on disk, per server (#2089). */
  lastPersistedSettings: LastPersistedSettings;
  /** Re-applies one settings value to the live client, in full. */
  applyLiveServerSettings: (settings: InspectorServerSettings) => void;
  updateServerSettings: (
    id: string,
    settings: InspectorServerSettings,
  ) => Promise<void>;
  refreshInitialConfig: () => void;

  // --- The OAuth recovery surface every command routes through (#2153). ---
  handleCommandScopedAuthRecovery: OAuthRecovery["handleCommandScopedAuthRecovery"];
  runWithCommandAuthRecovery: OAuthRecovery["runWithCommandAuthRecovery"];
  runCommandInBackground: OAuthRecovery["runCommandInBackground"];
}

export interface ServerCommands {
  onCallTool: (
    name: string,
    args: Record<string, unknown>,
    runAsTask?: boolean,
  ) => Promise<void>;
  onClearToolResult: () => void;
  onToolsUiChange: (next: ToolsUiState) => void;
  onGetPrompt: (name: string, args: Record<string, string>) => Promise<void>;
  onReadResource: (uri: string) => Promise<void>;
  /** Reads a `resource_link`'s contents inline, returning them directly. */
  onReadResourceContents: (
    uri: string,
  ) => Promise<Awaited<ReturnType<InspectorClient["readResource"]>>["result"]>;
  /**
   * Read one skill file's contents (SEP-2640), for digest verification. Returns
   * the single content block that answers the URI, narrowed to the two fields
   * the digest is taken over.
   */
  onReadSkillFile: (uri: string) => Promise<SkillFileContents>;
  /** Re-fetch one skill entry through `skills/get` (SEP-2640). */
  onGetSkill: (uri: string) => Promise<SkillEntry>;
  onSubscribeResource: (uri: string) => void;
  onUnsubscribeResource: (uri: string) => void;
  onCompleteArgument: (
    ref:
      | { type: "ref/resource"; uri: string }
      | { type: "ref/prompt"; name: string },
    argumentName: string,
    argumentValue: string,
    context: Record<string, string>,
  ) => Promise<string[]>;
  onCancelTask: (taskId: string) => Promise<void>;
  onCancelToolCall: () => void;
  onClearCompletedTasks: () => void;
  onSetLogLevel: (level: LoggingLevel) => void;
  onSetModernLogLevel: (level: LoggingLevel | null) => void;
  onRefreshTools: () => void;
  onRefreshPrompts: () => void;
  onRefreshResources: () => void;
  onRefreshSkills: () => void;
  onRefreshTasks: () => void;
  onTogglePaginatedLists: (value: boolean) => void;
  onLoadMoreTools: () => void;
  onLoadMorePrompts: () => void;
  onLoadMoreResources: () => void;
}

/**
 * Every command the screens issue against the live server: calling a tool,
 * getting a prompt, reading and subscribing to a resource, completing an
 * argument, cancelling a task or a call, setting a log level, refreshing or
 * paging a list, and flipping the pagination mode. Lifted out of `App.tsx` by
 * phase-2 step 4 of the decomposition (#2155, under #2129/#2126).
 *
 * It is one hook because every one of these routes through the same edge —
 * the command-scoped auth recovery `useOAuthRecovery` publishes (#2153). A
 * command that hits a lapsed authorization has to reach the *same* recovery,
 * or two of them would prompt differently for one server. That dependency is
 * also why this cluster cannot precede the OAuth one.
 *
 * The move is deliberately inert: nothing here changes behavior, #2095's
 * per-server pagination override included.
 */
export function useServerCommands({
  sessionRef,
  servers,
  activeServerId,
  activeServer,
  inspectorClient,
  connected,
  capabilities,
  tools,
  panels,
  selectedToolKey,
  setToolsUi,
  setUrlElicitationErrorDetails,
  setCurrentLogLevel,
  setModernLogLevel,
  activeToolCallTaskIdRef,
  clearCompletedTasks,
  refreshTasks,
  refreshSkills,
  paginatedLists,
  paginatedListsOverride,
  toolsPagination,
  promptsPagination,
  resourcesPagination,
  refreshTools,
  refreshPrompts,
  refreshResources,
  refreshResourceTemplates,
  clearToolsListChanged,
  clearPromptsListChanged,
  clearResourcesListChanged,
  loadToolsPage,
  loadPromptsPage,
  loadResourcesPage,
  lastPersistedSettings,
  applyLiveServerSettings,
  updateServerSettings,
  refreshInitialConfig,
  handleCommandScopedAuthRecovery,
  runWithCommandAuthRecovery,
  runCommandInBackground,
}: UseServerCommandsOptions): ServerCommands {
  const { setToolCallState, setGetPromptState, setReadResourceState } = panels;

  const onCallTool = useCallback(
    async (
      name: string,
      args: Record<string, unknown>,
      runAsTask?: boolean,
    ) => {
      if (!inspectorClient) return;
      const tool = tools.find((t: Tool) => t.name === name);
      if (!tool) return;
      // Route through the task pipeline when the caller asked to (or the tool
      // requires it) — but only if the server advertises task tool calls. Per
      // spec a tool's `taskSupport` is considered only when the server declares
      // `tasks.requests.tools.call`, so without it we never task-augment (even a
      // "required" tool, which then surfaces callTool's "requires task support"
      // error). The created task shows up on the Tasks screen via the
      // `requestorTaskUpdated` events callToolStream dispatches, and its live
      // status/progress surface as toasts + progress bar.
      // Legacy servers advertise task tool calls via
      // `tasks.requests.tools.call`. Modern servers (SEP-2663) instead negotiate
      // the `io.modelcontextprotocol/tasks` extension and are server-directed:
      // task creation is decided per-request by the server, so declaring the
      // extension on the call (which the task path does) is what makes a returned
      // task handle legal ("unsolicited handles"). Either era routes the flagged
      // call through the streaming task pipeline.
      const serverSupportsTaskToolCalls =
        !!capabilities?.tasks?.requests?.tools?.call ||
        inspectorClient.isTasksExtensionNegotiated();
      const asTask =
        serverSupportsTaskToolCalls &&
        (runAsTask || tool.execution?.taskSupport === "required");
      // Drop any prior call's task id before starting; a task-augmented call
      // repopulates it via the `toolCallTaskUpdated` listener below, an ordinary
      // call leaves it cleared (#1455).
      activeToolCallTaskIdRef.current = undefined;
      setToolCallState({ status: "pending" });
      try {
        // ToolsScreen types the args as `Record<string, unknown>` (it accepts
        // anything the user types into the schema form). `callTool` requires
        // `Record<string, JsonValue>` — narrow at the boundary instead of
        // claiming the object is empty (which the previous `as Record<string,
        // never>` cast did, misleadingly).
        const invocation = asTask
          ? await inspectorClient.callToolStream(
              tool,
              args as Record<string, JsonValue>,
              undefined,
              undefined,
              { ttl: activeServer?.settings?.taskTtl || DEFAULT_TASK_TTL_MS },
            )
          : await inspectorClient.callTool(
              tool,
              args as Record<string, JsonValue>,
            );
        setToolCallState({
          status: invocation.success ? "ok" : "error",
          result: invocation.result ?? undefined,
          error: invocation.error,
        });
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError) {
          setToolCallState(undefined);
          if (activeServerId) {
            await handleCommandScopedAuthRecovery(err, {
              serverId: activeServerId,
              source: "tool",
            });
          }
          return;
        }
        // The user cancelled the in-flight call (Cancel button → cancelToolCall).
        // The cancellation notification was already sent to the server, so just
        // clear the executing state — surfacing it as an error would read as a
        // failure rather than the deliberate cancel it was (#1458).
        if (err instanceof ToolCallCancelledError) {
          setToolCallState(undefined);
          notifications.show({
            title: "Tool call cancelled",
            message: "A cancellation request was sent to the server.",
            color: "gray",
            autoClose: 3000,
          });
          return;
        }
        // The server kept asking for a URL the user already completed this call,
        // so callTool aborted to avoid an endless re-prompt loop. Surface that
        // explicitly rather than as a generic failure.
        if (err instanceof UrlElicitationLoopError) {
          setToolCallState({ status: "error", error: err.message });
          notifications.show({
            autoClose: false,
            title: "URL elicitation loop",
            color: "yellow",
            message: (
              <Text size="sm">
                The server requested the same URL again after you completed it (
                {err.url}), so the call was cancelled to avoid an endless loop.
              </Text>
            ),
          });
          return;
        }
        // A URLElicitationRequired (-32042) error that reaches here carried no
        // elicitations (a non-spec response — the with-list case is handled and
        // retried inside callTool). There's no URL to open, so surface a short
        // toast that links to the raw error rather than a bare error panel.
        const urlElicitations = getUrlElicitationsFromError(err);
        if (urlElicitations !== null && urlElicitations.length === 0) {
          const details = {
            toolName: name,
            details: formatErrorDetails(err),
          };
          setToolCallState({ status: "error", error: errorMessage(err) });
          notifications.show({
            autoClose: false,
            title: "URL elicitation required",
            color: "yellow",
            message: (
              <UrlElicitationErrorToastMessage
                onViewDetails={() => setUrlElicitationErrorDetails(details)}
              />
            ),
          });
          return;
        }
        setToolCallState({
          status: "error",
          error: errorMessage(err),
          errorCode: errorCodeOf(err),
        });
      }
    },
    [
      inspectorClient,
      tools,
      activeServer,
      capabilities,
      activeServerId,
      handleCommandScopedAuthRecovery,
      activeToolCallTaskIdRef,
      setToolCallState,
      setUrlElicitationErrorDetails,
    ],
  );

  const onClearToolResult = useCallback(() => {
    setToolCallState(undefined);
  }, [setToolCallState]);

  // Tools UI changes flow through here so selecting a *different* tool also
  // drops the previous tool's result — the result panel renders `toolCallState`
  // regardless of selection, so without this a stale result would linger under
  // the newly-selected tool (which has no result of its own yet). Search and
  // form edits keep `selectedToolKey` unchanged, so they leave the result be.
  // Depends on `selectedToolKey` only (not the whole `toolsUi`), so a search
  // keystroke doesn't churn the callback identity.
  const onToolsUiChange = useCallback(
    (next: ToolsUiState) => {
      if (next.selectedToolKey !== selectedToolKey) {
        setToolCallState(undefined);
      }
      setToolsUi(next);
    },
    [selectedToolKey, setToolsUi, setToolCallState],
  );
  const onGetPrompt = useCallback(
    async (name: string, args: Record<string, string>) => {
      if (!inspectorClient) return;
      // Tag the in-flight + final state with the prompt name so the
      // PromptsScreen can guard against showing a stale result for a
      // prompt the user has already navigated away from.
      setGetPromptState({ status: "pending", promptName: name });
      try {
        const invocation = await inspectorClient.getPrompt(name, args);
        setGetPromptState({
          status: "ok",
          promptName: name,
          result: invocation.result,
        });
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError) {
          setGetPromptState(undefined);
          if (activeServerId) {
            await handleCommandScopedAuthRecovery(err, {
              serverId: activeServerId,
              source: "prompt",
            });
          }
          return;
        }
        setGetPromptState({
          status: "error",
          promptName: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [
      inspectorClient,
      activeServerId,
      handleCommandScopedAuthRecovery,
      setGetPromptState,
    ],
  );

  const onReadResource = useCallback(
    async (uri: string) => {
      if (!inspectorClient) return;
      setReadResourceState({ status: "pending", uri });
      try {
        const invocation = await inspectorClient.readResource(uri);
        setReadResourceState({
          status: "ok",
          uri,
          result: invocation.result,
          lastUpdated: invocation.timestamp,
        });
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError) {
          setReadResourceState(undefined);
          if (activeServerId) {
            await handleCommandScopedAuthRecovery(err, {
              serverId: activeServerId,
              source: "resource",
            });
          }
          return;
        }
        setReadResourceState({
          status: "error",
          uri,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [
      inspectorClient,
      activeServerId,
      handleCommandScopedAuthRecovery,
      setReadResourceState,
    ],
  );

  // Read-on-demand handler for `resource_link` blocks in a tool result. Unlike
  // `onReadResource` (which drives the Resources screen's preview panel via
  // shared state), this returns the contents directly so each ResourceLink can
  // own and inline its own fetched content.
  const onReadResourceContents = useCallback(
    async (uri: string) => {
      if (!inspectorClient) throw new Error("Client is not connected");
      const read = () => inspectorClient.readResource(uri);
      try {
        const invocation = await read();
        return invocation.result;
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError && activeServerId) {
          const satisfied = await handleCommandScopedAuthRecovery(err, {
            serverId: activeServerId,
            source: "resource",
          });
          if (satisfied) {
            const retry = await read();
            return retry.result;
          }
        }
        throw err;
      }
    },
    [inspectorClient, activeServerId, handleCommandScopedAuthRecovery],
  );

  // Both route through the shared recovery like every other command (#2174).
  // They used to discard the promise with a bare `void`, which neither the
  // callee nor anything else owned: `subscribeToResource` throws when the
  // client is disconnected, when the server declares no subscription support,
  // and (wrapped) on a failed request, so a subscribe that failed did nothing
  // visible and surfaced only as an unhandled rejection.
  //
  // The source is `ambient`, not `resource`. A `resource` step-up failure is
  // routed into `readResourceState` — the *preview* panel — which describes a
  // read of whatever resource is selected, not this subscribe; marking it
  // errored would contradict a read that succeeded. Subscribing has no panel
  // of its own (the tile only flips its button label), which is the same
  // position the refreshes and the pagination toggle are in, and they are
  // `ambient` for the same reason.
  //
  // Both pass an `errorTitle`: nothing else records these failures, so without
  // one the button would go on silently doing nothing.
  const onSubscribeResource = useCallback(
    (uri: string) => {
      if (!inspectorClient) return;
      runCommandInBackground(
        () => inspectorClient.subscribeToResource(uri),
        "ambient",
        "Failed to subscribe to resource",
      );
    },
    [inspectorClient, runCommandInBackground],
  );

  const onUnsubscribeResource = useCallback(
    (uri: string) => {
      if (!inspectorClient) return;
      runCommandInBackground(
        () => inspectorClient.unsubscribeFromResource(uri),
        "ambient",
        "Failed to unsubscribe from resource",
      );
    },
    [inspectorClient, runCommandInBackground],
  );

  const onCompleteArgument = useCallback(
    async (
      ref:
        | { type: "ref/resource"; uri: string }
        | { type: "ref/prompt"; name: string },
      argumentName: string,
      argumentValue: string,
      context: Record<string, string>,
    ): Promise<string[]> => {
      if (!inspectorClient) return [];
      const result = await runWithCommandAuthRecovery(
        () =>
          inspectorClient.getCompletions(
            ref,
            argumentName,
            argumentValue,
            context,
          ),
        "tool",
      );
      return result?.values ?? [];
    },
    [inspectorClient, runWithCommandAuthRecovery],
  );

  const onCancelTask = useCallback(
    async (taskId: string) => {
      if (!inspectorClient) return;
      try {
        await runWithCommandAuthRecovery(
          () => inspectorClient.cancelRequestorTask(taskId),
          "tool",
        );
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError) {
          return;
        }
        notifications.show({
          title: "Failed to cancel task",
          message: err instanceof Error ? err.message : String(err),
          color: "red",
        });
      }
    },
    [inspectorClient, runWithCommandAuthRecovery],
  );

  // Cancel the in-flight tool call. A task-augmented call (run-as-task) has a
  // server-side task, so cancel that via the tasks API (#1455) — the cancelled
  // status then flows back through the managed task store and toasts, the same
  // as cancelling from the Tasks screen. An ordinary call has no task, so abort
  // its request: the SDK sends a `notifications/cancelled` to the server (the
  // MCP cancellation flow) and the pending call rejects with a
  // ToolCallCancelledError that `onCallTool` clears as a cancellation (#1458).
  const onCancelToolCall = useCallback(() => {
    if (!inspectorClient) return;
    const taskId = activeToolCallTaskIdRef.current;
    if (taskId) {
      // Clear the ref before the call resolves so a rapid second Cancel click
      // doesn't re-cancel the now-terminating task (which would surface a
      // spurious "Failed to cancel task" toast).
      activeToolCallTaskIdRef.current = undefined;
      void onCancelTask(taskId);
      return;
    }
    inspectorClient.cancelToolCall();
  }, [inspectorClient, onCancelTask, activeToolCallTaskIdRef]);

  const onClearCompletedTasks = useCallback(() => {
    clearCompletedTasks();
  }, [clearCompletedTasks]);

  const onSetLogLevel = useCallback(
    (level: LoggingLevel) => {
      setCurrentLogLevel(level);
      if (!inspectorClient) return;
      // Nothing else records a `logging/setLevel` failure, and the optimistic
      // level above already moved — so report it, or the selector would sit on
      // a level the server never accepted with no explanation.
      runCommandInBackground(
        () => inspectorClient.setLoggingLevel(level),
        "ambient",
        "Failed to set log level",
      );
    },
    [inspectorClient, runCommandInBackground, setCurrentLogLevel],
  );

  // Modern era (#1629): no request is sent — the client stores the level and
  // stamps it on every subsequent request's `_meta`. `null` opts back out.
  const onSetModernLogLevel = useCallback(
    (level: LoggingLevel | null) => {
      setModernLogLevel(level);
      inspectorClient?.setModernLogLevel(level ?? undefined);
    },
    [inspectorClient, setModernLogLevel],
  );

  // Refresh acts per pagination mode: in paginated mode reload page 1 (the
  // paged state); in all-pages mode re-fetch the whole aggregate with auth
  // recovery (the pre-existing path). See usePaginatedList / #1721.
  const onRefreshTools = useCallback(() => {
    if (paginatedLists) {
      // Paginated refresh reloads page 1 of the paged store, bypassing the
      // managed hook's refresh — so acknowledge the list-changed indicator here
      // (the managed state lit it on `list_changed`; nothing else clears it in
      // paginated mode) (#1721).
      clearToolsListChanged();
      runCommandInBackground(() => toolsPagination.onRefresh(), "ambient");
    } else {
      runCommandInBackground(() => refreshTools(), "ambient");
    }
  }, [
    paginatedLists,
    toolsPagination,
    refreshTools,
    clearToolsListChanged,
    runCommandInBackground,
  ]);
  const onRefreshPrompts = useCallback(() => {
    if (paginatedLists) {
      clearPromptsListChanged();
      runCommandInBackground(() => promptsPagination.onRefresh(), "ambient");
    } else {
      runCommandInBackground(() => refreshPrompts(), "ambient");
    }
  }, [
    paginatedLists,
    promptsPagination,
    refreshPrompts,
    clearPromptsListChanged,
    runCommandInBackground,
  ]);
  const onRefreshResources = useCallback(() => {
    if (paginatedLists) {
      clearResourcesListChanged();
      runCommandInBackground(() => resourcesPagination.onRefresh(), "ambient");
      // Resource templates always use the managed (aggregate) path.
      runCommandInBackground(() => refreshResourceTemplates(), "ambient");
    } else {
      runCommandInBackground(async () => {
        await refreshResources();
        await refreshResourceTemplates();
      }, "ambient");
    }
  }, [
    paginatedLists,
    resourcesPagination,
    refreshResources,
    refreshResourceTemplates,
    clearResourcesListChanged,
    runCommandInBackground,
  ]);
  // The per-list sidebar toggle edits the server-wide `paginatedLists` setting:
  // optimistic override for an instant flip, live push so the managed state's
  // gating reads it now, and a persisted PUT so it survives reconnects (#1721).
  const onTogglePaginatedLists = useCallback(
    (value: boolean) => {
      const current = servers.find((s) => s.id === activeServerId);
      if (!current || activeServerId === undefined) return;
      // Recorded against this server rather than app-wide, so it survives a
      // switch away and back (#2095). Ordered after the id guard because the
      // record is keyed by that id; with no active server there is nothing the
      // toggle could have been flipped for.
      paginatedListsOverride.record(activeServerId, value);
      // Not `current.settings` directly: that entry only advances on a
      // successful list read, so once one has failed it describes disk as it
      // was *before* the writes made since. Build on the last write known to
      // have landed while that is the fresher account (#2089).
      const next: InspectorServerSettings = {
        ...(lastPersistedSettings.resolve(activeServerId) ?? EMPTY_SETTINGS),
        paginatedLists: value,
      };
      inspectorClient?.setServerSettings(next);
      // Drive the load that the mode change implies (data-loading stays out of
      // React effects; the paged stores own only the connect-time load). To
      // paginated: pull page 1 into each paged store. To all-pages: refetch
      // each managed aggregate that was gated off. Only when connected.
      if (connected) {
        // Wrap in ambient auth recovery so a mid-session 401 triggers re-auth
        // rather than surfacing raw, matching the all-pages refresh path.
        if (value) {
          runCommandInBackground(() => loadToolsPage(undefined), "ambient");
          runCommandInBackground(() => loadPromptsPage(undefined), "ambient");
          runCommandInBackground(() => loadResourcesPage(undefined), "ambient");
        } else {
          runCommandInBackground(() => refreshTools(), "ambient");
          runCommandInBackground(() => refreshPrompts(), "ambient");
          runCommandInBackground(() => refreshResources(), "ambient");
        }
      }
      // Refreshed like every other secret-store mutation: this resends the
      // server's rehydrated secrets, so it can trigger the pending
      // plaintext-to-encrypted upgrade even though the user only toggled
      // pagination (#1950 review r22).
      // Announced before the request goes out, so two toggles in flight at once
      // are ordered by when they were issued rather than by which one's list
      // reload finished first (#2089).
      const write = lastPersistedSettings.begin(activeServerId);
      // This value is on disk now. Remember it as the rollback baseline for
      // whatever is written next, since the `servers` entry it was derived
      // from will keep describing the old value if the reload behind this
      // write — or any later one — fails (#2089).
      //
      // Re-apply it when this write is the settled one: an overlapping toggle
      // that failed *first* rolled the UI and the live client back to a
      // baseline this write has since replaced, and if the list read behind
      // this write failed too, nothing else would ever correct them. Through
      // the *current* client, not this continuation's closure: a reconnect to
      // the same server passes the id check while the captured instance is
      // already destroyed.
      const settlePaginationWrite = () => {
        const settled = write.landed(next);
        if (!settled) return;
        // The override is keyed by server, so it is re-applied whatever is
        // active now — it is this server's value and is only ever displayed
        // while this server is the active one. The live client is not: it
        // belongs to whichever server is connected (#2095).
        paginatedListsOverride.record(
          activeServerId,
          next.paginatedLists ?? false,
        );
        if (sessionRef.current.activeServerId === activeServerId) {
          applyLiveServerSettings(next);
        }
      };
      void refreshingPersist(updateServerSettings, refreshInitialConfig)(
        activeServerId,
        next,
      )
        .then(settlePaginationWrite)
        .catch((err: unknown) => {
          // A `ServerListReloadError` means the PUT landed and only reading the
          // list back failed, so the new setting IS on disk (#1914). That is a
          // landed write, not a failed one: rolling back would put the UI and
          // the live client on the *old* value and contradict disk. Settle it
          // exactly as the success path does and report only the failed reload.
          if (err instanceof ServerListReloadError) {
            settlePaginationWrite();
            notifications.show({
              title:
                "Pagination setting saved, but the server list did not reload",
              message: err.message,
              color: "red",
            });
            return;
          }
          // This write is over and never reached disk, so it stops counting as
          // in flight: an earlier write still running is the settled state once
          // it lands, and is what re-applies the UI this rollback is about to
          // set (#2089).
          write.failed();
          // Persist failed: revert the optimistic override and roll the live
          // client setting back, so the UI and client reflect the value that's
          // actually on disk rather than the failed edit (#1721).
          //
          // The baseline is resolved *here*, not captured when this write was
          // issued: another toggle can land in between, and its value is what
          // disk holds by the time this one fails. The override is set to that
          // baseline rather than cleared, because clearing it falls back to
          // `persistedPaginatedLists` — read from a `servers` entry that may be
          // stale, showing the same wrong value from the other side (#2089).
          //
          // The override is recorded whatever is active by the time this
          // rejection arrives: it is keyed by this write's server and is only
          // ever displayed while that server is the active one, so a switch in
          // between costs nothing and dropping it would leave the stale entry
          // to answer for A the next time it comes back (#2095).
          //
          // The live client is the half that stays gated — it belongs to
          // whichever server is connected now, so pushing this server's value
          // into it after a switch would apply it to another one. It is taken
          // from the ref for the same reason the success path does: a reconnect
          // to the same server passes the id check while this continuation's
          // captured instance is already destroyed.
          const baseline =
            lastPersistedSettings.resolve(activeServerId) ?? EMPTY_SETTINGS;
          paginatedListsOverride.record(
            activeServerId,
            baseline.paginatedLists ?? false,
          );
          if (sessionRef.current.activeServerId === activeServerId) {
            applyLiveServerSettings(baseline);
          }
          notifications.show({
            title: "Failed to save pagination setting",
            message: err instanceof Error ? err.message : String(err),
            color: "red",
          });
        });
    },
    [
      sessionRef,
      servers,
      activeServerId,
      lastPersistedSettings,
      paginatedListsOverride,
      applyLiveServerSettings,
      inspectorClient,
      updateServerSettings,
      refreshInitialConfig,
      connected,
      loadToolsPage,
      loadPromptsPage,
      loadResourcesPage,
      refreshTools,
      refreshPrompts,
      refreshResources,
      runCommandInBackground,
    ],
  );
  // Wrap Load-next-page in ambient auth recovery too, so a paginated fetch
  // that hits a 401 recovers like the all-pages path (#1721).
  const onLoadMoreTools = useCallback(
    () => runCommandInBackground(() => toolsPagination.onLoadMore(), "ambient"),
    [toolsPagination, runCommandInBackground],
  );
  const onLoadMorePrompts = useCallback(
    () =>
      runCommandInBackground(() => promptsPagination.onLoadMore(), "ambient"),
    [promptsPagination, runCommandInBackground],
  );
  const onLoadMoreResources = useCallback(
    () =>
      runCommandInBackground(() => resourcesPagination.onLoadMore(), "ambient"),
    [resourcesPagination, runCommandInBackground],
  );
  // Skill files are fetched on demand, never pre-fetched: SEP-2640 is explicit
  // that a `resources/read` of a skill file is not a load and confers no
  // standing, so the Inspector reads only what the user asks it to verify.
  // Routed through `onReadResourceContents` so a skill read gets the same
  // auth-recovery retry every other read does.
  const onReadSkillFile = useCallback(
    async (uri: string): Promise<SkillFileContents> => {
      const result = await onReadResourceContents(uri);
      // `resources/read` answers the URI it was asked for, so a single-block
      // response is that block even when the server echoes the URI back in a
      // slightly different form; an exact match wins when there are several.
      const block =
        result.contents.find((c) => c.uri === uri) ??
        (result.contents.length === 1 ? result.contents[0] : undefined);
      if (!block) {
        throw new Error(`resources/read returned no content for ${uri}`);
      }
      // `contents` is a union of the text and blob shapes, each with its own
      // payload field required — so `in` is what narrows it, not a `typeof` on
      // a property one arm does not declare.
      return {
        ...("text" in block ? { text: block.text } : { blob: block.blob }),
        ...(typeof block.mimeType === "string"
          ? { mimeType: block.mimeType }
          : {}),
      };
    },
    [onReadResourceContents],
  );

  // `skills/get` is the extension's second required method, and the Skills tab
  // calls it on demand so a server author can see their own handler answer —
  // and see whether it agrees with what their `skills/list` advertised.
  const onGetSkill = useCallback(
    async (uri: string): Promise<SkillEntry> => {
      if (!inspectorClient) throw new Error("Client is not connected");
      return inspectorClient.getSkill(uri);
    },
    [inspectorClient],
  );

  const onRefreshSkills = useCallback(() => {
    runCommandInBackground(
      () => refreshSkills(),
      "ambient",
      "Failed to refresh skills",
    );
  }, [refreshSkills, runCommandInBackground]);

  const onRefreshTasks = useCallback(() => {
    runCommandInBackground(
      () => refreshTasks(),
      "ambient",
      "Failed to refresh tasks",
    );
  }, [refreshTasks, runCommandInBackground]);

  return {
    onCallTool,
    onClearToolResult,
    onToolsUiChange,
    onGetPrompt,
    onReadResource,
    onReadResourceContents,
    onReadSkillFile,
    onGetSkill,
    onSubscribeResource,
    onUnsubscribeResource,
    onCompleteArgument,
    onCancelTask,
    onCancelToolCall,
    onClearCompletedTasks,
    onSetLogLevel,
    onSetModernLogLevel,
    onRefreshTools,
    onRefreshPrompts,
    onRefreshResources,
    onRefreshSkills,
    onRefreshTasks,
    onTogglePaginatedLists,
    onLoadMoreTools,
    onLoadMorePrompts,
    onLoadMoreResources,
  };
}
