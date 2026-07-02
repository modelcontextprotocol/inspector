import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  applyOAuthResumeUi,
  buildTabUiSnapshot,
  clearOAuthResumeSnapshot,
  consumeOAuthResumeSnapshot,
  oauthResumeInsufficientScopeMessage,
  oauthResumeToastMessage,
  OAUTH_PENDING_SERVER_KEY,
  readOAuthResumeSnapshot,
  restoreTabUiFromSnapshot,
  writeOAuthResumeSnapshot,
  type OAuthResumeSnapshot,
} from "./oauthResume.js";
import {
  EMPTY_TOOLS_UI,
  EMPTY_PROMPTS_UI,
  EMPTY_RESOURCES_UI,
  EMPTY_APPS_UI,
  EMPTY_TASKS_UI,
  EMPTY_LOGS_UI,
  EMPTY_HISTORY_UI,
  EMPTY_NETWORK_UI,
} from "../components/screens/screenUiState.js";

describe("oauthResume", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("consumeOAuthResumeSnapshot reads once then clears storage", () => {
    const snapshot: OAuthResumeSnapshot = {
      version: 1,
      serverId: "srv-1",
      activeTab: "Tools",
      authKind: "reauth",
      tabUi: {},
    };
    writeOAuthResumeSnapshot(snapshot);
    expect(consumeOAuthResumeSnapshot()).toEqual(snapshot);
    expect(readOAuthResumeSnapshot()).toBeUndefined();
    expect(consumeOAuthResumeSnapshot()).toBeUndefined();
  });

  it("clearOAuthResumeSnapshot removes pending redirect state (explicit disconnect)", () => {
    writeOAuthResumeSnapshot({
      version: 1,
      serverId: "srv-1",
      activeTab: "Tools",
      authKind: "reauth",
      tabUi: {},
    });
    clearOAuthResumeSnapshot();
    expect(readOAuthResumeSnapshot()).toBeUndefined();
    expect(consumeOAuthResumeSnapshot()).toBeUndefined();
  });

  it("round-trips OAuthResumeSnapshot", () => {
    const snapshot: OAuthResumeSnapshot = {
      version: 1,
      serverId: "srv-1",
      activeTab: "Tools",
      authKind: "step_up",
      tabUi: {
        Tools: {
          ...EMPTY_TOOLS_UI,
          selectedToolName: "echo",
          formValues: { message: "hi" },
        },
      },
      remoteSessionId: "remote-abc",
    };
    writeOAuthResumeSnapshot(snapshot);
    expect(readOAuthResumeSnapshot()).toEqual(snapshot);
    expect(storage.get(OAUTH_PENDING_SERVER_KEY)).toBeUndefined();
    clearOAuthResumeSnapshot();
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  it("builds and restores tab ui snapshots", () => {
    const toolsUi = {
      ...EMPTY_TOOLS_UI,
      selectedToolName: "get_temp",
      formValues: { city: "NYC" },
    };
    const tabUi = buildTabUiSnapshot({
      toolsUi,
      promptsUi: EMPTY_PROMPTS_UI,
      resourcesUi: EMPTY_RESOURCES_UI,
      appsUi: EMPTY_APPS_UI,
      tasksUi: EMPTY_TASKS_UI,
      logsUi: EMPTY_LOGS_UI,
      historyUi: EMPTY_HISTORY_UI,
      networkUi: EMPTY_NETWORK_UI,
    });
    const setToolsUi = vi.fn();
    restoreTabUiFromSnapshot(tabUi, {
      setToolsUi,
      setPromptsUi: vi.fn(),
      setResourcesUi: vi.fn(),
      setAppsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setHistoryUi: vi.fn(),
      setNetworkUi: vi.fn(),
    });
    expect(setToolsUi).toHaveBeenCalledWith(toolsUi);
  });

  it("falls back to legacy pending server key", () => {
    storage.set(OAUTH_PENDING_SERVER_KEY, "legacy-srv");
    const snapshot = readOAuthResumeSnapshot();
    expect(snapshot?.serverId).toBe("legacy-srv");
    expect(snapshot?.activeTab).toBe("Servers");
    expect(snapshot?.authKind).toBe("reauth");
  });

  it("returns toast copy by auth kind", () => {
    expect(oauthResumeToastMessage("step_up", { recoverySource: "tool" })).toBe(
      "Step-up authorization succeeded. Retry your action.",
    );
    expect(oauthResumeToastMessage("step_up")).toBe(
      "Step-up authorization succeeded.",
    );
    expect(oauthResumeToastMessage("reauth", { recoverySource: "tool" })).toBe(
      "Authentication succeeded. Retry your action.",
    );
    expect(oauthResumeToastMessage("reauth")).toBe("Authentication succeeded.");
  });

  it("returns insufficient-scope message with tool context", () => {
    expect(
      oauthResumeInsufficientScopeMessage({
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
        context: { toolName: "get_temp" },
      }),
    ).toMatch(/get_temp/);
  });

  it("round-trips authChallenge on step-up snapshot", () => {
    const challenge = {
      reason: "insufficient_scope" as const,
      requiredScopes: ["weather:read"],
      context: { toolName: "get_temp" },
    };
    const snapshot: OAuthResumeSnapshot = {
      version: 1,
      serverId: "srv-1",
      activeTab: "Tools",
      authKind: "step_up",
      tabUi: {},
      authChallenge: challenge,
    };
    writeOAuthResumeSnapshot(snapshot);
    expect(readOAuthResumeSnapshot()?.authChallenge).toEqual(challenge);
  });

  it("rejects snapshots with invalid tabUi keys", () => {
    writeOAuthResumeSnapshot({
      version: 1,
      serverId: "srv-1",
      activeTab: "Tools",
      authKind: "reauth",
      tabUi: { NotATab: {} },
    } as OAuthResumeSnapshot);
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  it("applyOAuthResumeUi restores tab ui, active tab, and clears in-flight panels", () => {
    const toolsUi = {
      ...EMPTY_TOOLS_UI,
      selectedToolName: "get_temp",
      formValues: { city: "NYC" },
    };
    const snapshot: OAuthResumeSnapshot = {
      version: 1,
      serverId: "srv-1",
      activeTab: "Tools",
      authKind: "step_up",
      tabUi: { Tools: toolsUi },
    };
    const setToolsUi = vi.fn();
    const setActiveTab = vi.fn();
    const clearToolCallState = vi.fn();
    const clearGetPromptState = vi.fn();
    const clearReadResourceState = vi.fn();

    applyOAuthResumeUi(snapshot, {
      setToolsUi,
      setPromptsUi: vi.fn(),
      setResourcesUi: vi.fn(),
      setAppsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setHistoryUi: vi.fn(),
      setNetworkUi: vi.fn(),
      setActiveTab,
      clearToolCallState,
      clearGetPromptState,
      clearReadResourceState,
    });

    expect(setToolsUi).toHaveBeenCalledWith(toolsUi);
    expect(setActiveTab).toHaveBeenCalledWith("Tools");
    expect(clearToolCallState).toHaveBeenCalledOnce();
    expect(clearGetPromptState).toHaveBeenCalledOnce();
    expect(clearReadResourceState).toHaveBeenCalledOnce();
  });
});
