import { useCallback } from "react";
import { notifications } from "@mantine/notifications";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { MessageLogState } from "@inspector/core/mcp/state/messageLogState.js";
import type { FetchRequestLogState } from "@inspector/core/mcp/state/fetchRequestLogState.js";
import type { StderrLogState } from "@inspector/core/mcp/state/stderrLogState.js";
import type { Tool } from "@modelcontextprotocol/client";
import type {
  FetchRequestEntry,
  MessageEntry,
  StderrLogEntry,
} from "@inspector/core/mcp/types.js";
import type { LogEntryData } from "../components/elements/LogEntry/LogEntry";
import { buildExportFilename, downloadJsonFile } from "../lib/downloadFile";
import {
  replayProtocolRequest,
  type ReplayParamsOverride,
} from "../lib/protocolReplay";

/** One Protocol panel section, split by pin membership. */
export type ProtocolSection = "pinned" | "history";

export interface UseExportActionsParams {
  /** The active server's id, stamped into every export filename. */
  activeServerId?: string;
  /**
   * Only the clearing method of each store is named, rather than the whole
   * class: that is all these handlers touch, and a narrower parameter lets a
   * test supply a structurally-checked double instead of a cast-away stand-in.
   */
  messageLogState: Pick<MessageLogState, "clearMessages"> | null;
  fetchRequestLogState: Pick<FetchRequestLogState, "clearFetchRequests"> | null;
  stderrLogState: Pick<StderrLogState, "clearStderrLogs"> | null;
  /** The Protocol view's entries (the message log). */
  messages: MessageEntry[];
  /** The Network view's entries. */
  fetchRequests: FetchRequestEntry[];
  /** The Logs view's entries. */
  logs: LogEntryData[];
  /** The Console view's entries. */
  stderrLogs: StderrLogEntry[];
  /** Protocol entries the user pinned, by entry id. */
  pinnedProtocolIds: Set<string>;
  setPinnedProtocolIds: (next: Set<string>) => void;
  /** Needed to re-issue a replayed request; `null` when disconnected. */
  inspectorClient: InspectorClient | null;
  /** The tool list a replayed `tools/call` is validated against. */
  tools: Tool[];
}

export interface ExportActions {
  onClearLogs: () => void;
  onClearProtocol: () => void;
  onClearNetwork: () => void;
  onClearConsole: () => void;
  onExportLogs: () => void;
  onExportProtocol: () => void;
  onExportNetwork: () => void;
  onExportConsole: () => void;
  onClearProtocolSection: (section: ProtocolSection) => void;
  onExportProtocolSection: (section: ProtocolSection) => void;
  /**
   * Replay a Protocol entry. `overrideParams` replaces the entry's own params,
   * which is how the Edit-and-replay editor dispatches (#2151) — same code
   * path, same method gate, same failure toast.
   */
  onReplayProtocol: (id: string, overrideParams?: ReplayParamsOverride) => void;
}

/**
 * The Clear / Export / Replay handlers for the four log-ish views (Logs,
 * Protocol, Network, Console).
 *
 * Every export is a no-op on an empty list rather than a download of `[]`, and
 * every filename is stamped with the active server so two servers' exports do
 * not collide in the download folder.
 */
export function useExportActions({
  activeServerId,
  messageLogState,
  fetchRequestLogState,
  stderrLogState,
  messages,
  fetchRequests,
  logs,
  stderrLogs,
  pinnedProtocolIds,
  setPinnedProtocolIds,
  inspectorClient,
  tools,
}: UseExportActionsParams): ExportActions {
  const onClearLogs = useCallback(() => {
    if (!messageLogState) return;
    // Clear only the log notifications, not the entire request/response
    // history (which the Protocol screen renders from the same source).
    messageLogState.clearMessages(
      (m) =>
        m.direction === "notification" &&
        "method" in m.message &&
        m.message.method === "notifications/message",
    );
  }, [messageLogState]);

  // Panel-level Clear clears the (unpinned) history and keeps pinned entries —
  // pinning is the way to protect an entry from Clear. This matches the button's
  // `disabled={unpinnedEntries.length === 0}` gating and the per-section model,
  // and leaves pinnedProtocolIds valid (the pins it references still exist).
  const onClearProtocol = useCallback(() => {
    messageLogState?.clearMessages((m) => !pinnedProtocolIds.has(m.id));
  }, [messageLogState, pinnedProtocolIds]);

  const onClearNetwork = useCallback(() => {
    fetchRequestLogState?.clearFetchRequests();
  }, [fetchRequestLogState]);

  const onClearConsole = useCallback(() => {
    stderrLogState?.clearStderrLogs();
  }, [stderrLogState]);

  const onExportNetwork = useCallback(() => {
    if (fetchRequests.length === 0) return;
    downloadJsonFile(
      buildExportFilename("network", activeServerId),
      JSON.stringify(fetchRequests, null, 2),
    );
  }, [fetchRequests, activeServerId]);

  const onExportProtocol = useCallback(() => {
    if (messages.length === 0) return;
    downloadJsonFile(
      buildExportFilename("protocol", activeServerId),
      JSON.stringify(messages, null, 2),
    );
  }, [messages, activeServerId]);

  const onExportLogs = useCallback(() => {
    if (logs.length === 0) return;
    downloadJsonFile(
      buildExportFilename("logs", activeServerId),
      JSON.stringify(logs, null, 2),
    );
  }, [logs, activeServerId]);

  const onExportConsole = useCallback(() => {
    if (stderrLogs.length === 0) return;
    downloadJsonFile(
      buildExportFilename("console", activeServerId),
      JSON.stringify(stderrLogs, null, 2),
    );
  }, [stderrLogs, activeServerId]);

  // Clear just one section: remove its entries from the log by pin membership.
  // Clearing the pinned section also drops the (now-stale) pinned id set.
  const onClearProtocolSection = useCallback(
    (section: ProtocolSection) => {
      const isPinned = section === "pinned";
      messageLogState?.clearMessages((m) =>
        isPinned ? pinnedProtocolIds.has(m.id) : !pinnedProtocolIds.has(m.id),
      );
      if (isPinned) setPinnedProtocolIds(new Set());
    },
    [messageLogState, pinnedProtocolIds, setPinnedProtocolIds],
  );

  // Export just one section's entries (by pin membership) to a JSON file.
  const onExportProtocolSection = useCallback(
    (section: ProtocolSection) => {
      const isPinned = section === "pinned";
      const subset = messages.filter((m) =>
        isPinned ? pinnedProtocolIds.has(m.id) : !pinnedProtocolIds.has(m.id),
      );
      if (subset.length === 0) return;
      downloadJsonFile(
        buildExportFilename(
          isPinned ? "protocol-pinned" : "protocol-unpinned",
          activeServerId,
        ),
        JSON.stringify(subset, null, 2),
      );
    },
    [messages, pinnedProtocolIds, activeServerId],
  );

  // Replay a Protocol entry: re-issue its original request so the fresh
  // request+response appear as a new Protocol entry (protocol-local). A reason
  // string (unsupported method / missing tool) surfaces as a toast; a genuine
  // call error already shows up as the replayed entry's Error status, so only a
  // pre-flight failure (nothing logged) needs the fallback toast.
  const onReplayProtocol = useCallback(
    (id: string, overrideParams?: ReplayParamsOverride) => {
      if (!inspectorClient) return;
      const entry = messages.find((m) => m.id === id);
      if (!entry || !("method" in entry.message)) return;
      const { method } = entry.message;
      // See `ReplayParamsOverride`: `null` is an edit to no params at all,
      // `undefined` is no edit — so only the latter falls back to the entry's.
      const params =
        overrideParams === undefined
          ? "params" in entry.message
            ? (entry.message.params as Record<string, unknown> | undefined)
            : undefined
          : (overrideParams ?? undefined);
      void replayProtocolRequest(inspectorClient, method, params, tools)
        .then((reason) => {
          if (reason) {
            notifications.show({
              title: "Can't replay",
              message: reason,
              color: "yellow",
            });
          }
        })
        .catch((err: unknown) => {
          notifications.show({
            title: "Replay failed",
            message: err instanceof Error ? err.message : String(err),
            color: "red",
          });
        });
    },
    [inspectorClient, messages, tools],
  );

  return {
    onClearLogs,
    onClearProtocol,
    onClearNetwork,
    onClearConsole,
    onExportLogs,
    onExportProtocol,
    onExportNetwork,
    onExportConsole,
    onClearProtocolSection,
    onExportProtocolSection,
    onReplayProtocol,
  };
}
