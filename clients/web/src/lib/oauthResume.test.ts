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
  clearOwnOAuthResumeSnapshot,
  type OAuthResumeSnapshot,
} from "./oauthResume.js";
import {
  EMPTY_TOOLS_UI,
  EMPTY_PROMPTS_UI,
  EMPTY_RESOURCES_UI,
  EMPTY_APPS_UI,
  EMPTY_SKILLS_UI,
  EMPTY_TASKS_UI,
  EMPTY_LOGS_UI,
  EMPTY_PROTOCOL_UI,
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
    const attemptId = writeOAuthResumeSnapshot(snapshot);
    // The write stamps the per-attempt id `clearOwnOAuthResumeSnapshot`
    // matches on (#2165); everything else round-trips unchanged.
    expect(consumeOAuthResumeSnapshot()).toEqual({ ...snapshot, attemptId });
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
          selectedToolKey: "0:echo",
          formValues: { message: "hi" },
        },
      },
      remoteSessionId: "remote-abc",
    };
    const attemptId = writeOAuthResumeSnapshot(snapshot);
    expect(readOAuthResumeSnapshot()).toEqual({ ...snapshot, attemptId });
    expect(storage.get(OAUTH_PENDING_SERVER_KEY)).toBeUndefined();
    clearOAuthResumeSnapshot();
    expect(readOAuthResumeSnapshot()).toBeUndefined();
  });

  it("builds and restores tab ui snapshots", () => {
    const toolsUi = {
      ...EMPTY_TOOLS_UI,
      selectedToolKey: "1:get_temp",
      formValues: { city: "NYC" },
    };
    const tabUi = buildTabUiSnapshot({
      toolsUi,
      promptsUi: EMPTY_PROMPTS_UI,
      resourcesUi: EMPTY_RESOURCES_UI,
      appsUi: EMPTY_APPS_UI,
      skillsUi: EMPTY_SKILLS_UI,
      tasksUi: EMPTY_TASKS_UI,
      logsUi: EMPTY_LOGS_UI,
      protocolUi: EMPTY_PROTOCOL_UI,
      networkUi: EMPTY_NETWORK_UI,
    });
    const setToolsUi = vi.fn();
    restoreTabUiFromSnapshot(tabUi, {
      setToolsUi,
      setPromptsUi: vi.fn(),
      setResourcesUi: vi.fn(),
      setAppsUi: vi.fn(),
      setSkillsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setProtocolUi: vi.fn(),
      setNetworkUi: vi.fn(),
    });
    expect(setToolsUi).toHaveBeenCalledWith(toolsUi);
  });

  it("drops a pre-#2001 selectedToolName from a legacy snapshot, keeping the rest", () => {
    // A redirect begun on a build that keyed tool selection by name, restored
    // on one that keys it by row identity (the app upgraded mid-redirect).
    // The name can't be mapped to a row key here — the tools list is fetched
    // after reconnect — so the selection is dropped, not carried through as a
    // stray field, and everything else survives.
    const setToolsUi = vi.fn();
    restoreTabUiFromSnapshot(
      {
        Tools: {
          formValues: { city: "NYC" },
          search: "get",
          runAsTask: false,
          selectedToolName: "get_temp",
        },
      },
      {
        setToolsUi,
        setPromptsUi: vi.fn(),
        setResourcesUi: vi.fn(),
        setAppsUi: vi.fn(),
        setSkillsUi: vi.fn(),
        setTasksUi: vi.fn(),
        setLogsUi: vi.fn(),
        setProtocolUi: vi.fn(),
        setNetworkUi: vi.fn(),
      },
    );
    expect(setToolsUi).toHaveBeenCalledWith({
      formValues: { city: "NYC" },
      search: "get",
      runAsTask: false,
    });
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
      selectedToolKey: "1:get_temp",
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
      setSkillsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setProtocolUi: vi.fn(),
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

  it("clearOwnOAuthResumeSnapshot removes only the attempt it was given", () => {
    // Deliberately IDENTICAL snapshots: two concurrent redirects for the same
    // server with the same shell state serialize the same way while carrying
    // different authorization URLs, which the snapshot does not record. A byte
    // comparison would call them one attempt and delete the wrong one (#2165).
    const snapshot = {
      version: 1,
      serverId: "a",
      activeTab: "tools",
      authKind: "reauth",
      tabUi: {},
    } as const;
    const first = writeOAuthResumeSnapshot({ ...snapshot });
    const second = writeOAuthResumeSnapshot({ ...snapshot });
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);

    expect(clearOwnOAuthResumeSnapshot(first)).toBe(false);
    expect(readOAuthResumeSnapshot()?.attemptId).toBe(second);

    expect(clearOwnOAuthResumeSnapshot(second)).toBe(true);
    expect(window.sessionStorage.getItem(OAUTH_RESUME_KEY)).toBeNull();
  });

  it("clearOwnOAuthResumeSnapshot ignores a snapshot with no attemptId", () => {
    // An older build's snapshot, mid-redirect across an upgrade — dropping it
    // would strand a live callback.
    window.sessionStorage.setItem(
      OAUTH_RESUME_KEY,
      JSON.stringify({
        version: 1,
        serverId: "a",
        activeTab: "tools",
        authKind: "reauth",
        tabUi: {},
      }),
    );
    expect(clearOwnOAuthResumeSnapshot("some-attempt")).toBe(false);
    expect(readOAuthResumeSnapshot()?.serverId).toBe("a");
  });

  it("clearOwnOAuthResumeSnapshot is a no-op without a token", () => {
    writeOAuthResumeSnapshot({
      version: 1,
      serverId: "a",
      activeTab: "tools",
      authKind: "reauth",
      tabUi: {},
    });
    expect(clearOwnOAuthResumeSnapshot(undefined)).toBe(false);
    expect(readOAuthResumeSnapshot()?.serverId).toBe("a");
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

  it("clearOwnOAuthResumeSnapshot swallows storage failures", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(clearOwnOAuthResumeSnapshot("attempt")).toBe(false);
  });

  it("clearOwnOAuthResumeSnapshot is a no-op with nothing stored", () => {
    expect(clearOwnOAuthResumeSnapshot("attempt")).toBe(false);
  });

  it("writeOAuthResumeSnapshot mints an attemptId per write", () => {
    const token = writeOAuthResumeSnapshot({
      version: 1,
      serverId: "a",
      activeTab: "tools",
      authKind: "reauth",
      tabUi: {},
    });
    expect(token).toEqual(expect.any(String));
    expect(readOAuthResumeSnapshot()?.attemptId).toBe(token);
  });

  it("writeOAuthResumeSnapshot falls back when randomUUID is unavailable", () => {
    // `crypto.randomUUID` needs a secure context, which a plain-HTTP
    // non-loopback host is not.
    const original = Object.getOwnPropertyDescriptor(
      globalThis.crypto,
      "randomUUID",
    );
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    try {
      const token = writeOAuthResumeSnapshot({
        version: 1,
        serverId: "a",
        activeTab: "tools",
        authKind: "reauth",
        tabUi: {},
      });
      expect(token).toEqual(expect.any(String));
      expect(clearOwnOAuthResumeSnapshot(token)).toBe(true);
    } finally {
      // `randomUUID` is inherited from `Crypto.prototype`, so there is
      // normally no OWN descriptor to put back — restoring only when one
      // existed would leave the `undefined` own property in place and force
      // every later test in this file onto the fallback path.
      if (original) {
        Object.defineProperty(globalThis.crypto, "randomUUID", original);
      } else {
        delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
      }
    }
    expect(globalThis.crypto.randomUUID).toEqual(expect.any(Function));
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

    it("clearOwnOAuthResumeSnapshot is a no-op", () => {
      expect(clearOwnOAuthResumeSnapshot("{}")).toBe(false);
    });
  });

  it("restoreTabUiFromSnapshot returns early when tabUi is undefined", () => {
    const setToolsUi = vi.fn();
    restoreTabUiFromSnapshot(undefined, {
      setToolsUi,
      setPromptsUi: vi.fn(),
      setResourcesUi: vi.fn(),
      setAppsUi: vi.fn(),
      setSkillsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setProtocolUi: vi.fn(),
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
      setSkillsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setProtocolUi: vi.fn(),
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
      setSkillsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setProtocolUi: vi.fn(),
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
        Protocol: EMPTY_PROTOCOL_UI,
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
    expect(setters.setProtocolUi).toHaveBeenCalledWith(EMPTY_PROTOCOL_UI);
    expect(setters.setNetworkUi).toHaveBeenCalledWith(EMPTY_NETWORK_UI);
  });

  it("restoreTabUiFromSnapshot falls back to EMPTY state for undefined tab values", () => {
    const setters = {
      setToolsUi: vi.fn(),
      setPromptsUi: vi.fn(),
      setResourcesUi: vi.fn(),
      setAppsUi: vi.fn(),
      setSkillsUi: vi.fn(),
      setTasksUi: vi.fn(),
      setLogsUi: vi.fn(),
      setProtocolUi: vi.fn(),
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
        Protocol: undefined,
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
    expect(setters.setProtocolUi).toHaveBeenCalledWith(EMPTY_PROTOCOL_UI);
    expect(setters.setNetworkUi).toHaveBeenCalledWith(EMPTY_NETWORK_UI);
  });
});
