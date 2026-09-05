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
  EMPTY_SKILLS_UI,
  EMPTY_TASKS_UI,
  EMPTY_TOOLS_UI,
} from "../components/screens/screenUiState.js";
import type { AppsUiState } from "../components/screens/AppsScreen/AppsScreen.js";
import type { ProtocolUiState } from "../components/screens/ProtocolScreen/ProtocolScreen.js";
import type { LogsUiState } from "../components/screens/LoggingScreen/LoggingScreen.js";
import type { NetworkUiState } from "../components/screens/NetworkScreen/NetworkScreen.js";
import type { PromptsUiState } from "../components/screens/PromptsScreen/PromptsScreen.js";
import type { ResourcesUiState } from "../components/screens/ResourcesScreen/ResourcesScreen.js";
import type { SkillsUiState } from "../components/screens/SkillsScreen/SkillsScreen.js";
import type { TasksUiState } from "../components/screens/TasksScreen/TasksScreen.js";
import type { ToolsUiState } from "../components/screens/ToolsScreen/ToolsScreen.js";
import {
  INSPECTOR_SERVERS_TAB,
  type InspectorTabId,
  isInspectorTabId,
} from "../utils/inspectorTabs.js";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import {
  oauthResumeSuccessMessage,
  stepUpInsufficientScopeMessage,
  type OAuthRecoverySource,
} from "@inspector/core/auth/oauthUx.js";
import { OAUTH_PENDING_SERVER_KEY } from "../utils/oauthFlow.js";
import type { OAuthResumeAuthKind } from "../utils/pendingReauth.js";

export const OAUTH_RESUME_KEY = "mcp-inspector:oauth-resume";

export { OAUTH_PENDING_SERVER_KEY };

export type { OAuthResumeAuthKind };

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
  /**
   * Identifies the redirect attempt that wrote this snapshot (#2165).
   *
   * Stamped by {@link writeOAuthResumeSnapshot} and matched by
   * {@link clearOwnOAuthResumeSnapshot}, so an attempt that fails before
   * navigating cannot delete a *later* attempt's snapshot. Nothing else reads
   * it: the callback identifies its server by `serverId`, as before.
   *
   * Optional because a snapshot written by an older build (across a redirect
   * that spans an upgrade) has none, and dropping such a snapshot would strand
   * a live callback.
   */
  attemptId?: string;
}

export interface LiftedTabUiState {
  toolsUi: ToolsUiState;
  promptsUi: PromptsUiState;
  resourcesUi: ResourcesUiState;
  appsUi: AppsUiState;
  skillsUi: SkillsUiState;
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
  setSkillsUi: (next: SkillsUiState) => void;
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
    Skills: state.skillsUi,
    Tasks: state.tasksUi,
    Logs: state.logsUi,
    Protocol: state.protocolUi,
    Network: state.networkUi,
  };
}

/**
 * A snapshot written before #2001 carries `selectedToolName` (a tool's name)
 * where {@link ToolsUiState} now expects `selectedToolKey` (its `index:name`
 * row identity). A snapshot only lives for the length of one OAuth redirect,
 * so this matters exactly when the app is upgraded mid-redirect — and the name
 * cannot be mapped to a row key here, since the tools list is fetched after
 * reconnect, long after restore. So the stale selection is dropped rather than
 * carried as a stray field that would be re-serialized on the next redirect;
 * the rest of the tab state (search text, form values) is restored intact and
 * the screen opens on its "select a tool" placeholder.
 */
function normalizeToolsUi(value: unknown): ToolsUiState {
  const ui = { ...((value as ToolsUiState | undefined) ?? EMPTY_TOOLS_UI) };
  delete (ui as ToolsUiState & { selectedToolName?: string }).selectedToolName;
  return ui;
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
        setters.setToolsUi(normalizeToolsUi(value));
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
      case "Skills":
        setters.setSkillsUi(
          (value as SkillsUiState | undefined) ?? EMPTY_SKILLS_UI,
        );
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

/**
 * Persist the snapshot, returning the **`attemptId`** it was stored under —
 * the identifier {@link clearOwnOAuthResumeSnapshot} matches on (#2165), not
 * the serialized snapshot and not anything to compare bytes against.
 *
 * A fresh id is minted per write unless the caller supplied one, so two
 * redirect attempts are always distinguishable even when their snapshots are
 * byte-identical.
 *
 * `undefined` when nothing was stored (no `window`, privacy mode, quota), so a
 * caller holding one knows a clear is meaningful.
 */
export function writeOAuthResumeSnapshot(
  snapshot: OAuthResumeSnapshot,
): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const attemptId = snapshot.attemptId ?? newAttemptId();
  try {
    window.sessionStorage.setItem(
      OAUTH_RESUME_KEY,
      JSON.stringify({ ...snapshot, attemptId }),
    );
    return attemptId;
  } catch {
    // Best-effort — privacy mode / quota.
    return undefined;
  }
}

/**
 * A per-attempt identifier. `randomUUID` where it exists (it needs a secure
 * context, which a `file://` page or a plain-HTTP non-loopback host is not),
 * and otherwise a value that only has to be unique among the handful of
 * redirect attempts one page can have in flight — never a security token.
 *
 * The fallback chain matters even so. `crypto.getRandomValues` is *not*
 * gated on a secure context and exists in every browser that has `crypto` at
 * all — so precisely the situation `randomUUID` is unavailable in still has a
 * CSPRNG on hand, and declining to use it would be a gratuitous downgrade
 * (CodeQL `js/insecure-randomness`, alert 72, flags exactly that). `Math.random`
 * survives only as the last resort for a `crypto`-less global.
 */
function newAttemptId(): string {
  const uuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (uuid) {
    return uuid();
  }
  // Called directly rather than through a bound alias: CodeQL's
  // `js/insecure-randomness` browser model recognizes a secure RNG by the
  // literal `crypto.getRandomValues(...)` method call, and an alias does not
  // match it — so the indirection would leave the `Math.random` last resort
  // below classified as an unmitigated source (Copilot).
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

/**
 * Clear the snapshot **only if it is still the one this attempt wrote** (#2165).
 *
 * `prepareOAuthRedirect` has no single-flight guard, so a redirect that fails
 * before navigating can reject after a *later* attempt has already written its
 * own snapshot. An unconditional clear there would delete the newer attempt's
 * callback-routing state — a worse failure than the stale snapshot it is
 * trying to avoid, since that redirect is actually in flight.
 *
 * Matched on the snapshot's `attemptId` rather than on its bytes: two
 * concurrent redirects for the same server with the same shell state serialize
 * identically while carrying *different* authorization URLs, which the
 * snapshot does not record — so a byte comparison would report them as the
 * same attempt and delete the wrong one.
 *
 * Returns whether anything was removed.
 */
export function clearOwnOAuthResumeSnapshot(
  attemptId: string | undefined,
): boolean {
  if (typeof window === "undefined" || attemptId === undefined) {
    return false;
  }
  try {
    const raw = window.sessionStorage.getItem(OAUTH_RESUME_KEY);
    if (!raw) {
      return false;
    }
    const stored = JSON.parse(raw) as Partial<OAuthResumeSnapshot>;
    if (stored?.attemptId !== attemptId) {
      return false;
    }
    window.sessionStorage.removeItem(OAUTH_RESUME_KEY);
    return true;
  } catch {
    return false;
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
