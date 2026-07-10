/**
 * Persist inspector shell state across full-page OAuth redirects.
 * Serializes only liftable `*UiState` shells — not message logs, fetch bodies,
 * tool results, or managed primitive lists.
 */

import {
  EMPTY_APPS_UI,
  EMPTY_PROTOCOL_UI,
  EMPTY_LOGS_UI,
  EMPTY_NETWORK_UI,
  EMPTY_PROMPTS_UI,
  EMPTY_RESOURCES_UI,
  EMPTY_TASKS_UI,
  EMPTY_TOOLS_UI,
} from "../components/screens/screenUiState.js";
import type { AppsUiState } from "../components/screens/AppsScreen/AppsScreen.js";
import type { ProtocolUiState } from "../components/screens/ProtocolScreen/ProtocolScreen.js";
import type { LogsUiState } from "../components/screens/LoggingScreen/LoggingScreen.js";
import type { NetworkUiState } from "../components/screens/NetworkScreen/NetworkScreen.js";
import type { PromptsUiState } from "../components/screens/PromptsScreen/PromptsScreen.js";
import type { ResourcesUiState } from "../components/screens/ResourcesScreen/ResourcesScreen.js";
import type { TasksUiState } from "../components/screens/TasksScreen/TasksScreen.js";
import type { ToolsUiState } from "../components/screens/ToolsScreen/ToolsScreen.js";
import {
  INSPECTOR_SERVERS_TAB,
  type InspectorTabId,
  isInspectorTabId,
} from "./inspectorTabs.js";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import {
  oauthResumeSuccessMessage,
  stepUpInsufficientScopeMessage,
  type OAuthRecoverySource,
} from "@inspector/core/auth/oauthUx.js";
import { OAUTH_PENDING_SERVER_KEY } from "./oauthFlow.js";

export const OAUTH_RESUME_KEY = "mcp-inspector:oauth-resume";

export { OAUTH_PENDING_SERVER_KEY };

export type OAuthResumeAuthKind = "step_up" | "reauth";

export interface OAuthResumeSnapshot {
  version: 1;
  serverId: string;
  activeTab: string;
  authKind: OAuthResumeAuthKind;
  /**
   * Per-tab lifted UI state (`*UiState` only). Keys are {@link InspectorTabId}.
   */
  tabUi: Partial<Record<InspectorTabId, unknown>>;
  /** Hono remote session id for auth-state push after callback. */
  remoteSessionId?: string;
  /** Step-up challenge at redirect time; used to verify scope satisfaction after callback. */
  authChallenge?: AuthChallenge;
  /** Command-scoped recovery source when redirect was triggered by a user action. */
  recoverySource?: OAuthRecoverySource;
}

export interface LiftedTabUiState {
  toolsUi: ToolsUiState;
  promptsUi: PromptsUiState;
  resourcesUi: ResourcesUiState;
  appsUi: AppsUiState;
  tasksUi: TasksUiState;
  logsUi: LogsUiState;
  protocolUi: ProtocolUiState;
  networkUi: NetworkUiState;
}

export interface TabUiSetters {
  setToolsUi: (next: ToolsUiState) => void;
  setPromptsUi: (next: PromptsUiState) => void;
  setResourcesUi: (next: ResourcesUiState) => void;
  setAppsUi: (next: AppsUiState) => void;
  setTasksUi: (next: TasksUiState) => void;
  setLogsUi: (next: LogsUiState) => void;
  setProtocolUi: (next: ProtocolUiState) => void;
  setNetworkUi: (next: NetworkUiState) => void;
}

export function buildTabUiSnapshot(
  state: LiftedTabUiState,
): Partial<Record<InspectorTabId, unknown>> {
  return {
    Apps: state.appsUi,
    Tools: state.toolsUi,
    Prompts: state.promptsUi,
    Resources: state.resourcesUi,
    Tasks: state.tasksUi,
    Logs: state.logsUi,
    Protocol: state.protocolUi,
    Network: state.networkUi,
  };
}

export function restoreTabUiFromSnapshot(
  tabUi: Partial<Record<InspectorTabId, unknown>> | undefined,
  setters: TabUiSetters,
): void {
  if (!tabUi) {
    return;
  }
  for (const tabId of Object.keys(tabUi) as InspectorTabId[]) {
    if (!isInspectorTabId(tabId)) {
      continue;
    }
    const value = tabUi[tabId];
    switch (tabId) {
      case "Tools":
        setters.setToolsUi(
          (value as ToolsUiState | undefined) ?? EMPTY_TOOLS_UI,
        );
        break;
      case "Prompts":
        setters.setPromptsUi(
          (value as PromptsUiState | undefined) ?? EMPTY_PROMPTS_UI,
        );
        break;
      case "Resources":
        setters.setResourcesUi(
          (value as ResourcesUiState | undefined) ?? EMPTY_RESOURCES_UI,
        );
        break;
      case "Apps":
        setters.setAppsUi((value as AppsUiState | undefined) ?? EMPTY_APPS_UI);
        break;
      case "Tasks":
        setters.setTasksUi(
          (value as TasksUiState | undefined) ?? EMPTY_TASKS_UI,
        );
        break;
      case "Logs":
        setters.setLogsUi((value as LogsUiState | undefined) ?? EMPTY_LOGS_UI);
        break;
      case "Protocol":
        setters.setProtocolUi(
          (value as ProtocolUiState | undefined) ?? EMPTY_PROTOCOL_UI,
        );
        break;
      case "Network":
        setters.setNetworkUi(
          (value as NetworkUiState | undefined) ?? EMPTY_NETWORK_UI,
        );
        break;
      default: {
        const _exhaustive: never = tabId;
        void _exhaustive;
      }
    }
  }
}

export function writeOAuthResumeSnapshot(snapshot: OAuthResumeSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(OAUTH_RESUME_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort — privacy mode / quota.
  }
}

export function readOAuthResumeSnapshot(): OAuthResumeSnapshot | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = window.sessionStorage.getItem(OAUTH_RESUME_KEY);
    if (!raw) {
      return readLegacyPendingServerSnapshot();
    }
    const parsed = JSON.parse(raw) as OAuthResumeSnapshot;
    if (
      parsed?.version !== 1 ||
      typeof parsed.serverId !== "string" ||
      !isOAuthResumeAuthKind(parsed.authKind) ||
      typeof parsed.activeTab !== "string" ||
      !isValidTabUiSnapshot(parsed.tabUi)
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/** Read the pending snapshot and remove it from storage (one-shot). */
export function consumeOAuthResumeSnapshot(): OAuthResumeSnapshot | undefined {
  const snapshot = readOAuthResumeSnapshot();
  if (snapshot) {
    clearOAuthResumeSnapshot();
  }
  return snapshot;
}

function readLegacyPendingServerSnapshot(): OAuthResumeSnapshot | undefined {
  try {
    const serverId = window.sessionStorage.getItem(OAUTH_PENDING_SERVER_KEY);
    if (!serverId) {
      return undefined;
    }
    return {
      version: 1,
      serverId,
      activeTab: INSPECTOR_SERVERS_TAB,
      authKind: "reauth",
      tabUi: {},
    };
  } catch {
    return undefined;
  }
}

export function clearOAuthResumeSnapshot(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(OAUTH_RESUME_KEY);
    window.sessionStorage.removeItem(OAUTH_PENDING_SERVER_KEY);
  } catch {
    // ignore
  }
}

export function oauthResumeToastMessage(
  authKind: OAuthResumeAuthKind,
  options?: { recoverySource?: OAuthRecoverySource },
): string {
  return oauthResumeSuccessMessage(authKind, options);
}

/** Post-callback copy when step-up OAuth completed but scopes still do not satisfy the challenge. */
export function oauthResumeInsufficientScopeMessage(
  challenge: AuthChallenge,
): string {
  return stepUpInsufficientScopeMessage(challenge);
}

function isOAuthResumeAuthKind(value: unknown): value is OAuthResumeAuthKind {
  return value === "step_up" || value === "reauth";
}

function isValidTabUiSnapshot(
  tabUi: unknown,
): tabUi is Partial<Record<InspectorTabId, unknown>> {
  if (tabUi === undefined) {
    return true;
  }
  if (typeof tabUi !== "object" || tabUi === null || Array.isArray(tabUi)) {
    return false;
  }
  return Object.keys(tabUi).every((key) => isInspectorTabId(key));
}

/** Setters used when restoring App shell state after `/oauth/callback`. */
export interface OAuthResumeUiSetters extends TabUiSetters {
  setActiveTab: (tab: string) => void;
  clearToolCallState: () => void;
  clearGetPromptState: () => void;
  clearReadResourceState: () => void;
}

/** Restore tab selection, per-tab UI, and clear in-flight result panels. One-shot: callers must not invoke twice for the same redirect. */
export function applyOAuthResumeUi(
  snapshot: OAuthResumeSnapshot,
  setters: OAuthResumeUiSetters,
): void {
  restoreTabUiFromSnapshot(snapshot.tabUi, setters);
  setters.setActiveTab(snapshot.activeTab);
  setters.clearToolCallState();
  setters.clearGetPromptState();
  setters.clearReadResourceState();
}
