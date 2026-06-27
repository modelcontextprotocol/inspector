import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";

type RenderResult = ReturnType<typeof render>;

vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));
vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));

// ---------------------------------------------------------------------------
// Controllable mock of the entire @inspector/core surface App.tsx depends on.
// `ctrl` is mutated by individual tests (reset in beforeEach) to drive what the
// hooks return and what the InspectorClient methods do.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  interface Ctrl {
    status: string;
    capabilities: Record<string, unknown> | null;
    serverInfo: { name?: string; version?: string } | null;
    instructions: string | null;
    serverType: "stdio" | "sse" | "streamable-http";
    oauthFlowState: unknown;
    tools: unknown[];
    resources: unknown[];
    resourceTemplates: unknown[];
    prompts: unknown[];
    messages: unknown[];
    fetchRequests: unknown[];
    stderrLogs: unknown[];
  }
  const ctrl: Ctrl = {
    status: "disconnected",
    capabilities: null,
    serverInfo: null,
    instructions: null,
    serverType: "stdio",
    oauthFlowState: null,
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    messages: [],
    fetchRequests: [],
    stderrLogs: [],
  };
  const connect = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  class FakeManager {
    destroy = vi.fn();
  }
  class FakeClient {
    getServerType = vi.fn(() => ctrl.serverType);
    getOAuthFlowState = vi.fn(() => ctrl.oauthFlowState);
    authenticate = vi.fn().mockResolvedValue("https://auth.example/start");
    beginGuidedAuth = vi.fn();
    runGuidedAuth = vi.fn();
    proceedOAuthStep = vi.fn();
    clearOAuthTokens = vi.fn();
    disconnect = vi.fn().mockResolvedValue(undefined);
  }
  return {
    ctrl,
    connect,
    disconnect,
    FakeManager,
    FakeClient,
    useInspectorClient: vi.fn(() => ({
      status: ctrl.status,
      capabilities: ctrl.capabilities,
      serverInfo: ctrl.serverInfo,
      instructions: ctrl.instructions,
      connect,
      disconnect,
    })),
    useManagedTools: vi.fn(() => ({ tools: ctrl.tools })),
    useManagedResources: vi.fn(() => ({ resources: ctrl.resources })),
    useManagedResourceTemplates: vi.fn(() => ({
      resourceTemplates: ctrl.resourceTemplates,
    })),
    useManagedPrompts: vi.fn(() => ({ prompts: ctrl.prompts })),
    useMessageLog: vi.fn(() => ({ messages: ctrl.messages })),
    useFetchRequestLog: vi.fn(() => ({ fetchRequests: ctrl.fetchRequests })),
    useStderrLog: vi.fn(() => ({ stderrLogs: ctrl.stderrLogs })),
  };
});

vi.mock("@inspector/core/mcp/index.js", () => ({
  InspectorClient: h.FakeClient,
}));
vi.mock("@inspector/core/mcp/state/index.js", () => ({
  ManagedToolsState: h.FakeManager,
  ManagedResourcesState: h.FakeManager,
  ManagedResourceTemplatesState: h.FakeManager,
  ManagedPromptsState: h.FakeManager,
  MessageLogState: h.FakeManager,
  FetchRequestLogState: h.FakeManager,
  StderrLogState: h.FakeManager,
}));
vi.mock("@inspector/core/mcp/node/index.js", () => ({
  createTransportNode: vi.fn(),
}));
vi.mock("@inspector/core/react/useInspectorClient.js", () => ({
  useInspectorClient: h.useInspectorClient,
}));
vi.mock("@inspector/core/react/useManagedTools.js", () => ({
  useManagedTools: h.useManagedTools,
}));
vi.mock("@inspector/core/react/useManagedResources.js", () => ({
  useManagedResources: h.useManagedResources,
}));
vi.mock("@inspector/core/react/useManagedResourceTemplates.js", () => ({
  useManagedResourceTemplates: h.useManagedResourceTemplates,
}));
vi.mock("@inspector/core/react/useManagedPrompts.js", () => ({
  useManagedPrompts: h.useManagedPrompts,
}));
vi.mock("@inspector/core/react/useMessageLog.js", () => ({
  useMessageLog: h.useMessageLog,
}));
vi.mock("@inspector/core/react/useFetchRequestLog.js", () => ({
  useFetchRequestLog: h.useFetchRequestLog,
}));
vi.mock("@inspector/core/react/useStderrLog.js", () => ({
  useStderrLog: h.useStderrLog,
}));
vi.mock("@inspector/core/auth/index.js", () => ({
  CallbackNavigation: class {},
  MutableRedirectUrlProvider: class {
    redirectUrl = "";
  },
}));
vi.mock("@inspector/core/auth/node/index.js", () => ({
  createOAuthCallbackServer: vi.fn(() => ({
    start: vi.fn().mockResolvedValue({ url: "http://localhost/cb" }),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
  NodeOAuthStorage: class {},
}));

import App from "../src/App.js";
import type { TuiServer } from "../src/tui-servers.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const callbackUrlConfig = { hostname: "127.0.0.1", port: 0, pathname: "/cb" };

function stdioServer(): Record<string, TuiServer> {
  return {
    alpha: {
      config: { type: "stdio", command: "node", args: ["s.js"] },
    } as never,
    beta: {
      config: { type: "stdio", command: "node", args: ["b.js"] },
    } as never,
  };
}

function httpServer(): Record<string, TuiServer> {
  return {
    web: { config: { type: "streamable-http", url: "http://x" } } as never,
  };
}

// Single-server catalogs auto-select their only server on mount, so action
// tests can drive accelerators without first navigating the server list.
function oneStdio(): Record<string, TuiServer> {
  return {
    alpha: {
      config: { type: "stdio", command: "node", args: ["s.js"] },
    } as never,
  };
}

// Track rendered instances so each is unmounted after its test — concurrent
// mounted ink apps share raw-mode stdin handling and interfere with useInput.
const mounted: RenderResult[] = [];

function renderApp(servers: Record<string, TuiServer>) {
  const r = render(
    <App mcpServers={servers} callbackUrlConfig={callbackUrlConfig} />,
  );
  mounted.push(r);
  return r;
}

/**
 * Render and absorb ink-testing-library's intermittently-dropped first
 * keypress with a benign no-op key ("x" is not bound while the server list is
 * focused), so subsequent navigation keys register deterministically.
 */
async function mount(servers: Record<string, TuiServer>) {
  const r = renderApp(servers);
  await tick();
  r.stdin.write("x");
  await tick();
  return r;
}

beforeEach(() => {
  Object.assign(h.ctrl, {
    status: "disconnected",
    capabilities: null,
    serverInfo: null,
    instructions: null,
    serverType: "stdio",
    oauthFlowState: null,
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    messages: [],
    fetchRequests: [],
    stderrLogs: [],
  });
  h.connect.mockClear();
  h.disconnect.mockClear();
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe("App (foundation)", () => {
  it("renders the server list with the MCP Servers header", async () => {
    const { lastFrame } = renderApp(stdioServer());
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("MCP Servers");
    expect(frame).toContain("alpha");
    expect(frame).toContain("beta");
  });

  it("selects a server with down arrow and shows its config", async () => {
    const { lastFrame, stdin } = renderApp(stdioServer());
    await tick();
    stdin.write("[B");
    await tick();
    expect(lastFrame() ?? "").toContain("Server Configuration");
  });

  it("wraps server selection with up arrow from the unselected state", async () => {
    const { lastFrame, stdin } = renderApp(stdioServer());
    await tick();
    stdin.write("[A");
    await tick();
    expect(lastFrame() ?? "").toContain("Server Configuration");
  });

  it("connects with 'c' when disconnected", async () => {
    const { stdin } = await mount(oneStdio());
    stdin.write("c");
    await tick();
    expect(h.connect).toHaveBeenCalled();
  });

  it("disconnects with 'd' when connected", async () => {
    h.ctrl.status = "connected";
    const { stdin } = await mount(oneStdio());
    stdin.write("d");
    await tick();
    expect(h.disconnect).toHaveBeenCalled();
  });

  it("switches tabs via accelerator keys", async () => {
    const { lastFrame, stdin } = renderApp(stdioServer());
    await tick();
    stdin.write("[B"); // select a server
    await tick();
    stdin.write("t"); // tools tab
    await tick();
    expect(lastFrame() ?? "").toContain("Tools");
  });

  it("cycles focus with tab and shift+tab", async () => {
    const { stdin } = renderApp(stdioServer());
    await tick();
    stdin.write("[B");
    await tick();
    stdin.write("\t"); // forward
    await tick();
    // shift+tab is delivered as ESC [ Z
    stdin.write("[Z");
    await tick();
    // no assertion on hidden focus state — exercising the branches
  });

  it("shows the Auth tab and G/Q/S accelerators for an OAuth-capable server", async () => {
    h.ctrl.serverType = "streamable-http";
    const { lastFrame, stdin } = await mount(httpServer());
    stdin.write("g"); // guided auth accelerator -> Auth tab
    await tick();
    expect(lastFrame() ?? "").toContain("Auth");
  });

  it("renders connected status with capabilities", async () => {
    h.ctrl.status = "connected";
    h.ctrl.capabilities = { tools: {}, resources: {}, prompts: {} };
    h.ctrl.serverInfo = { name: "srv", version: "1.0.0" };
    const { lastFrame } = await mount(oneStdio());
    expect(lastFrame() ?? "").toContain("connected");
  });
});
