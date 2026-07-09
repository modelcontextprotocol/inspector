// Empty-state defaults for each screen's lifted `ui` object — the value App
// seeds its per-screen UI state with and resets to on disconnect (#1417). The
// `*UiState` interfaces live alongside their screens; the defaults are gathered
// here (a non-component module) so the screen files can keep a single component
// export under the react-refresh rule, mirroring logLevels.ts / fetchCategories.ts.
import type { ToolsUiState } from "./ToolsScreen/ToolsScreen";
import type { PromptsUiState } from "./PromptsScreen/PromptsScreen";
import type { ResourcesUiState } from "./ResourcesScreen/ResourcesScreen";
import type { AppsUiState } from "./AppsScreen/AppsScreen";
import type { TasksUiState } from "./TasksScreen/TasksScreen";
import type { LogsUiState } from "./LoggingScreen/LoggingScreen";
import type { HistoryUiState } from "./HistoryScreen/HistoryScreen";
import type { NetworkUiState } from "./NetworkScreen/NetworkScreen";
import type { ConsoleUiState } from "./ConsoleScreen/ConsoleScreen";
import { ALL_LEVELS_VISIBLE } from "./LoggingScreen/logLevels";
import { ALL_CATEGORIES_VISIBLE } from "./NetworkScreen/fetchCategories";

export const EMPTY_TOOLS_UI: ToolsUiState = {
  selectedToolName: undefined,
  formValues: {},
  search: "",
  runAsTask: false,
};

export const EMPTY_PROMPTS_UI: PromptsUiState = {
  selectedPromptName: undefined,
  argumentValues: {},
  submittedFor: undefined,
  search: "",
};

export const EMPTY_RESOURCES_UI: ResourcesUiState = {
  selectedResourceUri: undefined,
  selectedTemplateUri: undefined,
  originatingTemplateUri: undefined,
  search: "",
  openSections: undefined,
};

export const EMPTY_APPS_UI: AppsUiState = {
  selectedAppName: undefined,
  formValues: {},
  search: "",
};

export const EMPTY_TASKS_UI: TasksUiState = {
  search: "",
  statusFilter: undefined,
};

export const EMPTY_LOGS_UI: LogsUiState = {
  filterText: "",
  visibleLevels: ALL_LEVELS_VISIBLE,
};

export const EMPTY_HISTORY_UI: HistoryUiState = {
  search: "",
  methodFilter: undefined,
  visibleDirections: { client: true, server: true },
};

export const EMPTY_NETWORK_UI: NetworkUiState = {
  filterText: "",
  visibleCategories: ALL_CATEGORIES_VISIBLE,
};

export const EMPTY_CONSOLE_UI: ConsoleUiState = {
  filterText: "",
};

/** Registry for OAuth resume snapshot restore (data-only; setters live in App). */
export const TAB_UI_REGISTRY = {
  Apps: { empty: EMPTY_APPS_UI },
  Tools: { empty: EMPTY_TOOLS_UI },
  Prompts: { empty: EMPTY_PROMPTS_UI },
  Resources: { empty: EMPTY_RESOURCES_UI },
  Tasks: { empty: EMPTY_TASKS_UI },
  Logs: { empty: EMPTY_LOGS_UI },
  History: { empty: EMPTY_HISTORY_UI },
  Network: { empty: EMPTY_NETWORK_UI },
} as const;
