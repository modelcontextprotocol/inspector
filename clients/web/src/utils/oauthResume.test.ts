import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  applyOAuthResumeUi,
  buildTabUiSnapshot,
  clearOAuthResumeSnapshot,
  consumeOAuthResumeSnapshot,
  oauthResumeInsufficientScopeMessage,
  oauthResumeToastMessage,
  OAUTH_PENDING_SERVER_KEY,
  OAUTH_RESUME_KEY,
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

  it("readOAuthResumeSnapshot returns undefined for a non-JSON string", () => {
    storage.set(OAUTH_RESUME_KEY, "not-json{");
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  it("readOAuthResumeSnapshot returns undefined when parsed JSON is null", () => {
    storage.set(OAUTH_RESUME_KEY, "null");
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  it("readOAuthResumeSnapshot rejects a wrong version", () => {
    storage.set(
      OAUTH_RESUME_KEY,
      JSON.stringify({
        version: 2,
        serverId: "srv-1",
        activeTab: "Tools",
        authKind: "reauth",
        tabUi: {},
      }),
    );
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  it("readOAuthResumeSnapshot rejects a non-string serverId", () => {
    storage.set(
      OAUTH_RESUME_KEY,
      JSON.stringify({
        version: 1,
        serverId: 42,
        activeTab: "Tools",
        authKind: "reauth",
        tabUi: {},
      }),
    );
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  it("readOAuthResumeSnapshot rejects an unknown authKind", () => {
    storage.set(
      OAUTH_RESUME_KEY,
      JSON.stringify({
        version: 1,
        serverId: "srv-1",
        activeTab: "Tools",
        authKind: "bogus",
        tabUi: {},
      }),
    );
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  it("readOAuthResumeSnapshot rejects a non-string activeTab", () => {
    storage.set(
      OAUTH_RESUME_KEY,
      JSON.stringify({
        version: 1,
        serverId: "srv-1",
        activeTab: 7,
        authKind: "reauth",
        tabUi: {},
      }),
    );
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  it("readOAuthResumeSnapshot accepts a snapshot with tabUi absent", () => {
    storage.set(
      OAUTH_RESUME_KEY,
      JSON.stringify({
        version: 1,
        serverId: "srv-1",
        activeTab: "Tools",
        authKind: "reauth",
      }),
    );
    const snapshot = readOAuthResumeSnapshot();
    expect(snapshot?.serverId).toBe("srv-1");
    expect(snapshot?.tabUi).toBeUndefined();
  });

  it("readOAuthResumeSnapshot rejects non-object tabUi (string, array, null)", () => {
    for (const tabUi of ['"nope"', "[]", "null"]) {
      storage.set(
        OAUTH_RESUME_KEY,
        `{"version":1,"serverId":"srv-1","activeTab":"Tools","authKind":"reauth","tabUi":${tabUi}}`,
      );
      expect(readOAuthResumeSnapshot()).toBeUndefined();
    }
  });

  it("writeOAuthResumeSnapshot swallows setItem failures", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {},
    });
    expect(() =>
      writeOAuthResumeSnapshot({
        version: 1,
        serverId: "srv-1",
        activeTab: "Tools",
        authKind: "reauth",
        tabUi: {},
      }),
    ).not.toThrow();
  });

  it("clearOAuthResumeSnapshot swallows removeItem failures", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => clearOAuthResumeSnapshot()).not.toThrow();
  });

  it("legacy fallback returns undefined when the pending-key read throws", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => {
        if (key === OAUTH_PENDING_SERVER_KEY) {
          throw new Error("blocked");
        }
        return null;
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  it("legacy fallback returns undefined when no pending server is stored", () => {
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  describe("without a window global", () => {
    beforeEach(() => {
      vi.stubGlobal("window", undefined);
    });

    it("writeOAuthResumeSnapshot is a no-op", () => {
      expect(() =>
        writeOAuthResumeSnapshot({
          version: 1,
          serverId: "srv-1",
          activeTab: "Tools",
          authKind: "reauth",
          tabUi: {},
        }),
      ).not.toThrow();
      expect(storage.size).toBe(0);
    });

    it("readOAuthResumeSnapshot returns undefined", () => {
      expect(readOAuthResumeSnapshot()).toBeUndefined();
    });

    it("clearOAuthResumeSnapshot is a no-op", () => {
      expect(() => clearOAuthResumeSnapshot()).not.toThrow();
    });
  });

  it("restoreTabUiFromSnapshot returns early when tabUi is undefined", () => {
    const setToolsUi = vi.fn();
    restoreTabUiFromSnapshot(undefined, {
      setToolsUi,
      setPromptsUi: vi.fn(),
      setResourcesUi: vi.fn(),
      setAppsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setHistoryUi: vi.fn(),
      setNetworkUi: vi.fn(),
    });
    expect(setToolsUi).not.toHaveBeenCalled();
  });

  it("restoreTabUiFromSnapshot skips keys that are not inspector tabs", () => {
    const setters = {
      setToolsUi: vi.fn(),
      setPromptsUi: vi.fn(),
      setResourcesUi: vi.fn(),
      setAppsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setHistoryUi: vi.fn(),
      setNetworkUi: vi.fn(),
    };
    restoreTabUiFromSnapshot(
      { NotATab: {} } as Record<string, unknown>,
      setters,
    );
    for (const setter of Object.values(setters)) {
      expect(setter).not.toHaveBeenCalled();
    }
  });

  it("restoreTabUiFromSnapshot restores every tab with a present value", () => {
    const setters = {
      setToolsUi: vi.fn(),
      setPromptsUi: vi.fn(),
      setResourcesUi: vi.fn(),
      setAppsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setHistoryUi: vi.fn(),
      setNetworkUi: vi.fn(),
    };
    restoreTabUiFromSnapshot(
      {
        Tools: EMPTY_TOOLS_UI,
        Prompts: EMPTY_PROMPTS_UI,
        Resources: EMPTY_RESOURCES_UI,
        Apps: EMPTY_APPS_UI,
        Tasks: EMPTY_TASKS_UI,
        Logs: EMPTY_LOGS_UI,
        History: EMPTY_HISTORY_UI,
        Network: EMPTY_NETWORK_UI,
      },
      setters,
    );
    expect(setters.setToolsUi).toHaveBeenCalledWith(EMPTY_TOOLS_UI);
    expect(setters.setPromptsUi).toHaveBeenCalledWith(EMPTY_PROMPTS_UI);
    expect(setters.setResourcesUi).toHaveBeenCalledWith(EMPTY_RESOURCES_UI);
    expect(setters.setAppsUi).toHaveBeenCalledWith(EMPTY_APPS_UI);
    expect(setters.setTasksUi).toHaveBeenCalledWith(EMPTY_TASKS_UI);
    expect(setters.setLogsUi).toHaveBeenCalledWith(EMPTY_LOGS_UI);
    expect(setters.setHistoryUi).toHaveBeenCalledWith(EMPTY_HISTORY_UI);
    expect(setters.setNetworkUi).toHaveBeenCalledWith(EMPTY_NETWORK_UI);
  });

  it("restoreTabUiFromSnapshot falls back to EMPTY state for undefined tab values", () => {
    const setters = {
      setToolsUi: vi.fn(),
      setPromptsUi: vi.fn(),
      setResourcesUi: vi.fn(),
      setAppsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setHistoryUi: vi.fn(),
      setNetworkUi: vi.fn(),
    };
    restoreTabUiFromSnapshot(
      {
        Tools: undefined,
        Prompts: undefined,
        Resources: undefined,
        Apps: undefined,
        Tasks: undefined,
        Logs: undefined,
        History: undefined,
        Network: undefined,
      },
      setters,
    );
    expect(setters.setToolsUi).toHaveBeenCalledWith(EMPTY_TOOLS_UI);
    expect(setters.setPromptsUi).toHaveBeenCalledWith(EMPTY_PROMPTS_UI);
    expect(setters.setResourcesUi).toHaveBeenCalledWith(EMPTY_RESOURCES_UI);
    expect(setters.setAppsUi).toHaveBeenCalledWith(EMPTY_APPS_UI);
    expect(setters.setTasksUi).toHaveBeenCalledWith(EMPTY_TASKS_UI);
    expect(setters.setLogsUi).toHaveBeenCalledWith(EMPTY_LOGS_UI);
    expect(setters.setHistoryUi).toHaveBeenCalledWith(EMPTY_HISTORY_UI);
    expect(setters.setNetworkUi).toHaveBeenCalledWith(EMPTY_NETWORK_UI);
  });
});
