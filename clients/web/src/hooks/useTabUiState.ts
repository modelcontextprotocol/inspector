import { useCallback, useMemo, useState } from "react";
import type { ConsoleUiState } from "../components/screens/ConsoleScreen/ConsoleScreen";
import {
  EMPTY_APPS_UI,
  EMPTY_CONSOLE_UI,
  EMPTY_LOGS_UI,
  EMPTY_NETWORK_UI,
  EMPTY_PROMPTS_UI,
  EMPTY_PROTOCOL_UI,
  EMPTY_RESOURCES_UI,
  EMPTY_SKILLS_UI,
  EMPTY_TASKS_UI,
  EMPTY_TOOLS_UI,
} from "../components/screens/screenUiState";
import type { LiftedTabUiState, TabUiSetters } from "../lib/oauthResume";
import { INSPECTOR_SERVERS_TAB } from "../utils/inspectorTabs";

/**
 * The per-screen `ui` objects, keyed exactly as {@link LiftedTabUiState} keys
 * them so the OAuth-resume snapshot can be built straight from this object.
 * `consoleUi` is the one addition — the Console screen is not snapshotted
 * across an OAuth redirect (its entries survive in `StderrLogState`), but its
 * search filter is lifted here with the rest.
 */
export interface TabUiState extends LiftedTabUiState {
  consoleUi: ConsoleUiState;
}

/** Matching setters, named as {@link TabUiSetters} names them. */
export interface TabUiStateSetters extends TabUiSetters {
  setConsoleUi: (next: ConsoleUiState) => void;
}

export interface TabUiStateResult {
  /** Every screen's lifted UI object. */
  ui: TabUiState;
  /** Stable per-screen setters. The object identity is stable too. */
  setUi: TabUiStateSetters;
  activeTab: string;
  setActiveTab: (next: string) => void;
  /** Protocol entries the user pinned, by entry id. */
  pinnedProtocolIds: Set<string>;
  setPinnedProtocolIds: (next: Set<string>) => void;
  /** Pin/unpin one Protocol entry. */
  togglePinProtocol: (id: string) => void;
  /**
   * Reset every screen's UI object and the pin set to their empty defaults.
   * Its identity never changes, so naming it in the dependency array of the
   * session-reset callback that drives it — which `exhaustive-deps` requires,
   * since the rule cannot infer stability across a custom-hook boundary —
   * costs that callback no churn. Deliberately leaves `activeTab` alone: the
   * tab the user is on is shell state, reset separately on an *explicit*
   * disconnect.
   */
  resetTabUiState: () => void;
}

/**
 * Per-screen selection / search / filter state, one object per screen.
 *
 * Lifted out of the individual screens because the screens unmount on tab
 * switch, so screen-local state would be lost on plain navigation. It is
 * cleared only on disconnect (via `resetTabUiState`) or an explicit user
 * action (#1414/#1417).
 */
export function useTabUiState(): TabUiStateResult {
  const [toolsUi, setToolsUi] = useState(EMPTY_TOOLS_UI);
  const [promptsUi, setPromptsUi] = useState(EMPTY_PROMPTS_UI);
  const [resourcesUi, setResourcesUi] = useState(EMPTY_RESOURCES_UI);
  const [appsUi, setAppsUi] = useState(EMPTY_APPS_UI);
  const [skillsUi, setSkillsUi] = useState(EMPTY_SKILLS_UI);
  const [tasksUi, setTasksUi] = useState(EMPTY_TASKS_UI);
  const [logsUi, setLogsUi] = useState(EMPTY_LOGS_UI);
  const [protocolUi, setProtocolUi] = useState(EMPTY_PROTOCOL_UI);
  const [networkUi, setNetworkUi] = useState(EMPTY_NETWORK_UI);
  const [consoleUi, setConsoleUi] = useState(EMPTY_CONSOLE_UI);
  // Session-scoped — the ids reference message-log entries, which clear on
  // disconnect, so this resets with the rest of the per-screen state.
  const [pinnedProtocolIds, setPinnedProtocolIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeTab, setActiveTab] = useState<string>(INSPECTOR_SERVERS_TAB);

  const ui: TabUiState = useMemo(
    () => ({
      toolsUi,
      promptsUi,
      resourcesUi,
      appsUi,
      skillsUi,
      tasksUi,
      logsUi,
      protocolUi,
      networkUi,
      consoleUi,
    }),
    [
      toolsUi,
      promptsUi,
      resourcesUi,
      appsUi,
      skillsUi,
      tasksUi,
      logsUi,
      protocolUi,
      networkUi,
      consoleUi,
    ],
  );

  // `useState` setters are stable, so this object is built once and its
  // identity never changes — safe to pass straight into a memo dependency.
  const setUi: TabUiStateSetters = useMemo(
    () => ({
      setToolsUi,
      setPromptsUi,
      setResourcesUi,
      setAppsUi,
      setSkillsUi,
      setTasksUi,
      setLogsUi,
      setProtocolUi,
      setNetworkUi,
      setConsoleUi,
    }),
    [],
  );

  // ProtocolListPanel sorts pinned entries to the top.
  const togglePinProtocol = useCallback((id: string) => {
    setPinnedProtocolIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const resetTabUiState = useCallback(() => {
    setToolsUi(EMPTY_TOOLS_UI);
    setPromptsUi(EMPTY_PROMPTS_UI);
    setResourcesUi(EMPTY_RESOURCES_UI);
    setAppsUi(EMPTY_APPS_UI);
    setSkillsUi(EMPTY_SKILLS_UI);
    setTasksUi(EMPTY_TASKS_UI);
    setLogsUi(EMPTY_LOGS_UI);
    setProtocolUi(EMPTY_PROTOCOL_UI);
    setPinnedProtocolIds(new Set());
    setNetworkUi(EMPTY_NETWORK_UI);
    // Only the search filter resets here; the stderr entries themselves live in
    // StderrLogState, which deliberately survives connect/disconnect so a failed
    // launch's output stays visible for diagnosis (#1621).
    setConsoleUi(EMPTY_CONSOLE_UI);
  }, []);

  return {
    ui,
    setUi,
    activeTab,
    setActiveTab,
    pinnedProtocolIds,
    setPinnedProtocolIds,
    togglePinProtocol,
    resetTabUiState,
  };
}
