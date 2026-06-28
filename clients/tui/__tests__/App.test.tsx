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
  const openUrl = vi.fn().mockResolvedValue(undefined);
  // Shared OAuth-related spies so a test can configure resolve/reject and
  // assert calls regardless of which per-server FakeClient instance App built.
  const clientSpies = {
    authenticate: vi.fn(
      async (): Promise<string | undefined> => "https://auth.example/start",
    ),
    beginGuidedAuth: vi.fn(async (): Promise<void> => {}),
    runGuidedAuth: vi.fn(async (): Promise<string | undefined> => undefined),
    proceedOAuthStep: vi.fn(async (): Promise<void> => {}),
    clearOAuthTokens: vi.fn(),
    completeOAuthFlow: vi.fn(async (): Promise<void> => {}),
  };
  // Captured options from the most recent callbackServer.start(), so a test can
  // drive the onCallback / onError handlers the OAuth flows register.
  interface CallbackOpts {
    onCallback: (p: { code: string }) => Promise<void> | void;
    onError: (p: { error?: string; error_description?: string }) => void;
  }
  const cb: { opts: CallbackOpts | null } = { opts: null };
  const callbackStart = vi.fn(async (opts: CallbackOpts) => {
    cb.opts = opts;
    return { redirectUrl: "http://localhost/cb" };
  });
  const callbackStop = vi.fn().mockResolvedValue(undefined);
  const createOAuthCallbackServer = vi.fn(() => ({
    start: callbackStart,
    stop: callbackStop,
  }));
  class FakeManager {
    destroy = vi.fn();
  }
  class FakeClient {
    cfg: { type?: string } | undefined;
    constructor(config?: { type?: string }) {
      this.cfg = config;
    }
    // Derive the transport type from the server config the client was built
    // with (config.type aligns with the serverType union) so per-server gating
    // (logging/requests tabs) works in mixed catalogs; fall back to ctrl.
    getServerType = vi.fn(
      () =>
        (this.cfg?.type ?? ctrl.serverType) as
          | "stdio"
          | "sse"
          | "streamable-http",
    );
    getOAuthFlowState = vi.fn(() => ctrl.oauthFlowState);
    authenticate = (...a: unknown[]) => clientSpies.authenticate(...a);
    beginGuidedAuth = (...a: unknown[]) => clientSpies.beginGuidedAuth(...a);
    runGuidedAuth = (...a: unknown[]) => clientSpies.runGuidedAuth(...a);
    proceedOAuthStep = (...a: unknown[]) => clientSpies.proceedOAuthStep(...a);
    clearOAuthTokens = (...a: unknown[]) => clientSpies.clearOAuthTokens(...a);
    completeOAuthFlow = (...a: unknown[]) =>
      clientSpies.completeOAuthFlow(...a);
    readResource = vi.fn(async () => ({
      result: { contents: [{ uri: "file://x", text: "hello" }] },
    }));
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    // Reject so the unmount cleanup's `.catch(() => {})` arrow is exercised.
    disconnect = vi.fn().mockRejectedValue(new Error("cleanup disconnect"));
  }
  return {
    ctrl,
    connect,
    disconnect,
    openUrl,
    clientSpies,
    cb,
    createOAuthCallbackServer,
    callbackStart,
    callbackStop,
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
  createOAuthCallbackServer: h.createOAuthCallbackServer,
  NodeOAuthStorage: class {},
}));
vi.mock("../src/utils/openUrl.js", () => ({
  openUrl: h.openUrl,
}));

import App from "../src/App.js";
import type { TuiServer } from "../src/tui-servers.js";

const tick = () => new Promise((r) => setTimeout(r, 25));
const callbackUrlConfig = { hostname: "127.0.0.1", port: 0, pathname: "/cb" };

// App attaches a process.stdout "resize" listener per mount; across this
// file's many mount/unmount cycles the transient count can exceed Node's
// default warning threshold of 10. Raise it to keep test output clean.
process.stdout.setMaxListeners(50);

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

// Single streamable-http server catalog (auto-selected on mount).
function oneHttp(): Record<string, TuiServer> {
  return {
    web: { config: { type: "streamable-http", url: "http://x" } } as never,
  };
}

// Mixed catalog: an OAuth-capable http server first (auto-selected) followed by
// a stdio server — drives per-server tab gating + the tab-switch-away effects.
function httpThenStdio(): Record<string, TuiServer> {
  return {
    web: { config: { type: "streamable-http", url: "http://x" } } as never,
    cli: {
      config: { type: "stdio", command: "node", args: ["s.js"] },
    } as never,
  };
}

function stdioThenHttp(): Record<string, TuiServer> {
  return {
    cli: {
      config: { type: "stdio", command: "node", args: ["s.js"] },
    } as never,
    web: { config: { type: "streamable-http", url: "http://x" } } as never,
  };
}

// An http server carrying saved settings (metadata, oauth creds, timeout) to
// exercise the per-server option-building branches in the mount effect.
function httpWithSettings(): Record<string, TuiServer> {
  return {
    web: {
      config: { type: "streamable-http", url: "http://x" },
      settings: {
        requestTimeout: 5000,
        metadata: [
          { key: "team", value: "alpha" },
          { key: "  ", value: "ignored" },
        ],
        oauthClientId: "cid",
        oauthClientSecret: "secret",
        oauthScopes: "read write",
      },
    } as never,
  };
}

// Realistic minimal fixtures for tab content / details modals.
const sampleTool = {
  name: "alpha",
  description: "Tool desc line1\nline2",
  inputSchema: { type: "object", properties: { x: { type: "string" } } },
};
const sampleResource = {
  name: "res1",
  uri: "file://x",
  description: "rdesc",
  mimeType: "text/plain",
};
const sampleTemplate = {
  name: "tmpl1",
  uriTemplate: "file://{id}",
  description: "tdesc",
};
const promptWithArgs = {
  name: "p1",
  description: "pdesc",
  arguments: [{ name: "arg1", description: "a1" }],
};
const promptNoName = { name: "", description: "no name prompt" };
const reqMessage = {
  id: "m1",
  direction: "request",
  message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  response: { jsonrpc: "2.0", id: 1, result: {} },
  timestamp: new Date(0),
  duration: 5,
};
const notifMessage = {
  id: "m2",
  direction: "notification",
  message: { jsonrpc: "2.0", method: "notifications/message" },
  timestamp: new Date(0),
};
const fullRequest = {
  id: "r1",
  method: "POST",
  url: "http://x/mcp",
  category: "transport",
  responseStatus: 200,
  responseStatusText: "OK",
  duration: 12,
  timestamp: new Date(0),
  requestHeaders: { "content-type": "application/json" },
  requestBody: JSON.stringify({ a: 1 }),
  responseHeaders: { "x-h": "v" },
  responseBody: JSON.stringify({ ok: true }),
};
const errorRequest = {
  id: "r2",
  method: "GET",
  url: "http://x/auth",
  category: "auth",
  error: "boom",
  timestamp: new Date(0),
  requestHeaders: { accept: "*/*" },
  requestBody: "not json{",
  responseBody: "also not json{",
};
const respMessage = {
  id: "m3",
  direction: "response",
  message: { jsonrpc: "2.0", id: 2, result: { ok: true } },
  timestamp: new Date(0),
};
const bareRequest = {
  id: "r3",
  method: "GET",
  url: "http://x/idle",
  category: "transport",
  timestamp: new Date(0),
  requestHeaders: {},
};
const stderrLog = { timestamp: new Date(0), message: "log line" };

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

// Arrow / shift-tab only parse as those keys when ESC-prefixed (a bare "[B" is
// read as the literal characters). Tab and Enter are real control characters.
const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const UP = `${ESC}[A`;
const RIGHT = `${ESC}[C`;
const LEFT = `${ESC}[D`;
const STAB = `${ESC}[Z`;
const TAB = "\t";
const ENTER = "\r";

/**
 * Write each key in order. ink re-subscribes the active component's useInput on
 * re-render, so a key that changes focus/tab must let that re-render flush
 * before the next key — otherwise the next key is routed to the old handler.
 * Two ticks per key keeps multi-step navigation deterministic under the heavier
 * v8 coverage instrumentation (where a single tick can race the render).
 */
async function press(r: RenderResult, keys: string[]) {
  for (const k of keys) {
    r.stdin.write(k);
    await tick();
    await tick();
  }
}

/**
 * Poll until `predicate` is true (or the tries run out). React + ink schedule
 * renders across several macrotasks, so async state set by a flow can take more
 * than one fixed tick to land under coverage instrumentation.
 */
async function waitUntil(predicate: () => boolean, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await tick();
  }
}

/**
 * Poll the frame until it contains `substr` (or the tries run out). Render
 * settling races a single fixed tick under v8 coverage instrumentation, so
 * frame assertions that follow a mount/keypress use this instead of one tick.
 */
async function waitForFrame(r: RenderResult, substr: string, tries = 25) {
  await waitUntil(() => (r.lastFrame() ?? "").includes(substr), tries);
}

/** Poll until the frame contains `substr`, then assert it — stable under load. */
async function expectFrame(r: RenderResult, substr: string) {
  await waitForFrame(r, substr);
  expect(r.lastFrame() ?? "").toContain(substr);
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
  h.connect.mockResolvedValue(undefined);
  h.disconnect.mockClear();
  h.disconnect.mockResolvedValue(undefined);
  h.openUrl.mockClear();
  h.openUrl.mockResolvedValue(undefined);
  h.cb.opts = null;
  h.callbackStart.mockClear();
  h.callbackStop.mockClear();
  h.clientSpies.authenticate.mockReset();
  h.clientSpies.authenticate.mockResolvedValue("https://auth.example/start");
  h.clientSpies.beginGuidedAuth.mockReset();
  h.clientSpies.beginGuidedAuth.mockResolvedValue(undefined);
  h.clientSpies.runGuidedAuth.mockReset();
  h.clientSpies.runGuidedAuth.mockResolvedValue(undefined);
  h.clientSpies.proceedOAuthStep.mockReset();
  h.clientSpies.proceedOAuthStep.mockResolvedValue(undefined);
  h.clientSpies.clearOAuthTokens.mockReset();
  h.clientSpies.completeOAuthFlow.mockReset();
  h.clientSpies.completeOAuthFlow.mockResolvedValue(undefined);
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe("App (foundation)", () => {
  it("renders the server list with the MCP Servers header", async () => {
    const r = renderApp(stdioServer());
    await expectFrame(r, "MCP Servers");
    const frame = r.lastFrame() ?? "";
    expect(frame).toContain("alpha");
    expect(frame).toContain("beta");
  });

  it("auto-selects the first server and shows its config", async () => {
    const r = renderApp(stdioServer());
    await expectFrame(r, "Server Configuration");
  });

  it("moves selection down to the next server with the down arrow", async () => {
    const r = await mount(stdioServer());
    await press(r, [DOWN]); // alpha -> beta
    await expectFrame(r, "b.js");
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
    const r = await mount(stdioServer());
    await press(r, ["t"]); // tools tab (server is auto-selected)
    await expectFrame(r, "Tools");
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
    const r = await mount(httpServer());
    await press(r, ["g"]); // guided auth accelerator -> Auth tab
    await expectFrame(r, "Auth");
  });

  it("renders connected status with capabilities", async () => {
    h.ctrl.status = "connected";
    h.ctrl.capabilities = { tools: {}, resources: {}, prompts: {} };
    h.ctrl.serverInfo = { name: "srv", version: "1.0.0" };
    const r = await mount(oneStdio());
    await expectFrame(r, "connected");
  });
});

describe("App (status, layout, modals)", () => {
  it("renders the connecting status symbol/color", async () => {
    h.ctrl.status = "connecting";
    const r = await mount(oneStdio());
    await expectFrame(r, "connecting");
  });

  it("renders the error status symbol/color", async () => {
    h.ctrl.status = "error";
    const r = await mount(oneStdio());
    await expectFrame(r, "error");
  });

  it("shows the 401 auth hint for an http server with a 401 response", async () => {
    h.ctrl.status = "error";
    h.ctrl.fetchRequests = [{ ...errorRequest, responseStatus: 401 }];
    const r = await mount(oneHttp());
    await expectFrame(r, "401 Unauthorized");
  });

  it("updates dimensions when the terminal resizes", async () => {
    const r = await mount(oneStdio());
    process.stdout.emit("resize");
    await tick();
    await expectFrame(r, "MCP Servers");
  });

  it("renders Tools tab content when connected", async () => {
    h.ctrl.status = "connected";
    h.ctrl.tools = [sampleTool];
    const r = await mount(oneStdio());
    await press(r, ["t"]);
    const f = r.lastFrame() ?? "";
    expect(f).toContain("Tools (1)");
    expect(f).toContain("alpha");
  });

  it("opens the tool test modal with Enter from the list pane", async () => {
    h.ctrl.status = "connected";
    h.ctrl.tools = [sampleTool];
    const r = await mount(oneStdio());
    await press(r, ["t", TAB, ENTER]);
    await expectFrame(r, "MOCK_FORM");
    await press(r, [ESC]); // ESC closes the modal
    expect(r.lastFrame() ?? "").not.toContain("MOCK_FORM");
  });

  it("opens the tool details modal with '+' and closes it on ESC", async () => {
    h.ctrl.status = "connected";
    h.ctrl.tools = [sampleTool];
    const r = await mount(oneStdio());
    await press(r, ["t", TAB, TAB, "+"]);
    await expectFrame(r, "Input Schema:");
    expect(r.lastFrame() ?? "").toContain("Full JSON:");
    await press(r, [ESC]);
    expect(r.lastFrame() ?? "").not.toContain("Full JSON:");
  });

  it("fetches a resource and opens its details modal", async () => {
    h.ctrl.status = "connected";
    h.ctrl.resources = [sampleResource];
    const r = await mount(oneStdio());
    await press(r, ["r", TAB, ENTER]);
    await tick();
    await press(r, [TAB, "+"]);
    await expectFrame(r, "Full JSON:");
  });

  it("opens the resource template test modal via Enter on a template", async () => {
    h.ctrl.status = "connected";
    h.ctrl.resources = [sampleResource];
    h.ctrl.resourceTemplates = [sampleTemplate];
    const r = await mount(oneStdio());
    await press(r, ["r", TAB, DOWN, ENTER]);
    await expectFrame(r, "MOCK_FORM");
    await press(r, [ESC]);
    expect(r.lastFrame() ?? "").not.toContain("MOCK_FORM");
  });

  it("opens the prompt test modal via Enter on a prompt with arguments", async () => {
    h.ctrl.status = "connected";
    h.ctrl.prompts = [promptWithArgs];
    const r = await mount(oneStdio());
    await press(r, ["p", TAB, ENTER]);
    await expectFrame(r, "MOCK_FORM");
    await press(r, [ESC]);
    expect(r.lastFrame() ?? "").not.toContain("MOCK_FORM");
  });

  it("opens the prompt details modal with '+'", async () => {
    h.ctrl.status = "connected";
    h.ctrl.prompts = [promptWithArgs];
    const r = await mount(oneStdio());
    await press(r, ["p", TAB, TAB, "+"]);
    const f = r.lastFrame() ?? "";
    expect(f).toContain("Arguments:");
    expect(f).toContain("Full JSON:");
  });

  it("opens details for a nameless prompt with no arguments", async () => {
    h.ctrl.status = "connected";
    h.ctrl.prompts = [promptNoName];
    const r = await mount(oneStdio());
    await press(r, ["p", TAB, TAB, "+"]);
    const f = r.lastFrame() ?? "";
    expect(f).toContain("Prompt: Unknown");
    expect(f).not.toContain("Arguments:");
  });

  it("opens message details for a request message (with response)", async () => {
    h.ctrl.messages = [reqMessage];
    const r = await mount(oneStdio());
    await press(r, ["m", TAB, TAB, "+"]);
    const f = r.lastFrame() ?? "";
    expect(f).toContain("Direction: request");
    expect(f).toContain("Response:");
  });

  it("opens message details for a notification message", async () => {
    h.ctrl.messages = [notifMessage];
    const r = await mount(oneStdio());
    await press(r, ["m", TAB, TAB, "+"]);
    await expectFrame(r, "Notification:");
  });

  it("opens message details for a response message", async () => {
    h.ctrl.messages = [respMessage];
    const r = await mount(oneStdio());
    await press(r, ["m", TAB, TAB, "+"]);
    await expectFrame(r, "Response:");
  });

  it("opens in-progress request details (no status, error, or bodies)", async () => {
    h.ctrl.status = "connected";
    h.ctrl.fetchRequests = [bareRequest];
    const r = await mount(oneHttp());
    await press(r, ["h", TAB, TAB, "+"]);
    await expectFrame(r, "Request Headers:");
  });

  it("connects with 'c' from the error state", async () => {
    h.ctrl.status = "error";
    const r = await mount(oneStdio());
    await press(r, ["c"]);
    await tick();
    expect(h.connect).toHaveBeenCalled();
  });

  it("disconnects with 'd' from the connecting state", async () => {
    h.ctrl.status = "connecting";
    const r = await mount(oneStdio());
    await press(r, ["d"]);
    await tick();
    expect(h.disconnect).toHaveBeenCalled();
  });

  it("renders the HTTP requests tab and opens full request details", async () => {
    h.ctrl.status = "connected";
    h.ctrl.fetchRequests = [fullRequest];
    const r = await mount(oneHttp());
    await press(r, ["h", TAB, TAB, "+"]);
    const f = r.lastFrame() ?? "";
    expect(f).toContain("Request Headers:");
    expect(f).toContain("Status: 200");
  });

  it("opens error-request details (error branch + unparseable bodies)", async () => {
    h.ctrl.status = "connected";
    h.ctrl.fetchRequests = [errorRequest];
    const r = await mount(oneHttp());
    await press(r, ["h", TAB, TAB, "+"]);
    await expectFrame(r, "Error: boom");
  });

  it("renders the Logging tab for a stdio server", async () => {
    h.ctrl.status = "connected";
    h.ctrl.stderrLogs = [stderrLog];
    const r = await mount(oneStdio());
    await press(r, ["l"]);
    const f = r.lastFrame() ?? "";
    expect(f).toContain("Logging (1)");
    expect(f).toContain("log line");
  });
});

describe("App (input handling, focus, effects)", () => {
  it("switches tabs with left/right arrows when the tabs row is focused", async () => {
    h.ctrl.status = "connected";
    const r = await mount(oneHttp());
    await press(r, [TAB]); // serverList -> tabs
    await press(r, [LEFT, RIGHT, RIGHT, LEFT]); // wrap + cycle both directions
    await expectFrame(r, "MCP Servers");
  });

  it("switches tabs with arrows on a stdio server (logging tab, no requests)", async () => {
    h.ctrl.status = "connected";
    const r = await mount(oneStdio());
    await press(r, [TAB]); // serverList -> tabs
    await press(r, [RIGHT, RIGHT, LEFT]);
    await expectFrame(r, "MCP Servers");
  });

  it("updates the resources tab count when the resource list changes", async () => {
    h.ctrl.status = "connected";
    h.ctrl.resources = [];
    const r = await mount(oneStdio());
    await press(r, ["r"]);
    h.ctrl.resources = [sampleResource];
    await press(r, [TAB]); // a focus change forces a re-render with new resources
    await tick();
    await expectFrame(r, "Resources (1)");
  });

  it("exits on Ctrl+C", async () => {
    const r = await mount(oneStdio());
    r.stdin.write("\x03"); // ETX -> ctrl+c
    await tick();
    expect(r.lastFrame() ?? "").toBeDefined();
  });

  it("exits on Escape", async () => {
    const r = await mount(oneStdio());
    await press(r, [ESC]);
    expect(r.lastFrame() ?? "").toBeDefined();
  });

  it("moves and wraps server selection with up and down arrows", async () => {
    const r = await mount(stdioServer()); // alpha(0), beta(1); alpha selected
    await press(r, [DOWN]); // alpha -> beta (down, index+1)
    await press(r, [UP]); // beta -> alpha (up, index-1)
    await press(r, [UP]); // alpha -> beta (up wrap to last)
    await press(r, [DOWN]); // beta -> alpha (down wrap to first)
    await expectFrame(r, "Server Configuration");
  });

  it("handles arrow keys with an empty server catalog", async () => {
    const r = await mount({});
    await press(r, [UP, DOWN]);
    await expectFrame(r, "MCP Servers");
  });

  it("cycles focus order through the messages tab panes", async () => {
    h.ctrl.messages = [reqMessage];
    const r = await mount(oneStdio());
    await press(r, ["m"]);
    await press(r, [TAB, TAB, TAB, TAB]); // forward through messages focusOrder
    await press(r, [STAB, STAB]); // reverse
    await expectFrame(r, "Messages");
  });

  it("cycles focus order through the requests tab panes", async () => {
    h.ctrl.status = "connected";
    h.ctrl.fetchRequests = [fullRequest];
    const r = await mount(oneHttp());
    await press(r, ["h"]);
    await press(r, [TAB, TAB, TAB, TAB]);
    await press(r, [STAB, STAB]);
    await expectFrame(r, "Requests");
  });

  it("switches away from the Auth tab when selecting a non-OAuth server", async () => {
    const r = await mount(httpThenStdio());
    await press(r, ["a"]); // Auth tab (http is OAuth-capable)
    await press(r, [STAB]); // tabs -> serverList
    await press(r, [DOWN]); // select the stdio server -> effect leaves Auth
    await expectFrame(r, "Server Configuration");
  });

  it("switches away from the Logging tab when selecting a non-stdio server", async () => {
    const r = await mount(stdioThenHttp());
    await press(r, ["l"]); // Logging tab (stdio)
    await press(r, [STAB]); // tabs -> serverList
    await press(r, [DOWN]); // select the http server -> effect leaves Logging
    await expectFrame(r, "Server Configuration");
  });

  it("swallows connect errors", async () => {
    h.connect.mockRejectedValue(new Error("connfail"));
    const r = await mount(oneStdio());
    await press(r, ["c"]);
    await tick();
    expect(h.connect).toHaveBeenCalled();
  });

  it("builds a client with saved settings (metadata, oauth, timeout)", async () => {
    const r = await mount(httpWithSettings());
    await expectFrame(r, "MCP Servers");
  });

  it("passes top-level oauth client credentials into an http client", async () => {
    const r = render(
      <App
        mcpServers={oneHttp()}
        callbackUrlConfig={callbackUrlConfig}
        clientId="cid"
        clientSecret="sec"
        clientMetadataUrl="http://meta"
      />,
    );
    mounted.push(r);
    await tick();
    await expectFrame(r, "MCP Servers");
  });
});

describe("App (OAuth flows)", () => {
  it("runs quick auth to success when no auth URL is returned", async () => {
    h.clientSpies.authenticate.mockResolvedValue(undefined);
    const r = await mount(oneHttp());
    await press(r, ["q", ENTER]);
    await tick();
    expect(h.callbackStart).toHaveBeenCalled();
    expect(h.clientSpies.authenticate).toHaveBeenCalled();
    await expectFrame(r, "OAuth complete");
  });

  it("completes quick auth when the OAuth callback fires", async () => {
    const r = await mount(oneHttp());
    await press(r, ["q", ENTER]);
    await waitUntil(() => h.cb.opts !== null);
    expect(h.cb.opts).not.toBeNull();
    await h.cb.opts!.onCallback({ code: "abc" });
    await tick();
    expect(h.clientSpies.completeOAuthFlow).toHaveBeenCalledWith("abc");
    await expectFrame(r, "OAuth complete");
  });

  it("reports an error when the OAuth callback errors", async () => {
    const r = await mount(oneHttp());
    await press(r, ["q", ENTER]);
    await waitUntil(() => h.cb.opts !== null);
    expect(h.cb.opts).not.toBeNull();
    h.cb.opts!.onError({ error_description: "denied" });
    await tick();
    await expectFrame(r, "denied");
  });

  it("runs guided auth to completion and opens the auth URL", async () => {
    h.clientSpies.runGuidedAuth.mockResolvedValue("http://auth/x");
    const r = await mount(oneHttp());
    await press(r, ["g", ENTER]);
    await tick();
    expect(h.clientSpies.runGuidedAuth).toHaveBeenCalled();
    expect(h.openUrl).toHaveBeenCalledWith("http://auth/x");
  });

  it("reports an error when guided-to-completion fails", async () => {
    h.clientSpies.runGuidedAuth.mockRejectedValue(new Error("nope"));
    const r = await mount(oneHttp());
    await press(r, ["g", ENTER]);
    await tick();
    await expectFrame(r, "nope");
  });

  it("starts guided auth then advances a step, opening the auth URL", async () => {
    const r = await mount(oneHttp());
    await press(r, ["g", " "]); // Space starts the guided flow
    await tick();
    h.ctrl.oauthFlowState = {
      oauthStep: "authorization_code",
      authorizationUrl: "http://auth/code",
    };
    await press(r, [" "]); // Space again advances one step
    await tick();
    expect(h.clientSpies.beginGuidedAuth).toHaveBeenCalled();
    expect(h.clientSpies.proceedOAuthStep).toHaveBeenCalled();
    expect(h.openUrl).toHaveBeenCalledWith("http://auth/code");
  });

  it("advances guided auth without opening a URL", async () => {
    h.ctrl.oauthFlowState = { oauthStep: "token_request" };
    const r = await mount(oneHttp());
    await press(r, ["g", " "]);
    await tick();
    await press(r, [" "]);
    await tick();
    expect(h.clientSpies.proceedOAuthStep).toHaveBeenCalled();
    expect(h.openUrl).not.toHaveBeenCalled();
  });

  it("reports an error when guided start fails", async () => {
    h.clientSpies.beginGuidedAuth.mockRejectedValue(new Error("startfail"));
    const r = await mount(oneHttp());
    await press(r, ["g", " "]);
    await tick();
    await expectFrame(r, "startfail");
  });

  it("reports an error when advancing guided auth fails", async () => {
    h.clientSpies.proceedOAuthStep.mockRejectedValue(new Error("advfail"));
    const r = await mount(oneHttp());
    await press(r, ["g", " "]);
    await tick();
    await press(r, [" "]);
    await tick();
    await expectFrame(r, "advfail");
  });

  it("clears OAuth state via the Clear action", async () => {
    const r = await mount(oneHttp());
    await press(r, ["s", ENTER]);
    await tick();
    expect(h.clientSpies.clearOAuthTokens).toHaveBeenCalled();
    await expectFrame(r, "OAuth state cleared");
  });

  it("reports an error when quick callback completion fails", async () => {
    h.clientSpies.completeOAuthFlow.mockRejectedValue(new Error("qcfail"));
    const r = await mount(oneHttp());
    await press(r, ["q", ENTER]);
    await waitUntil(() => h.cb.opts !== null);
    expect(h.cb.opts).not.toBeNull();
    await h.cb.opts!.onCallback({ code: "x" });
    await tick();
    await expectFrame(r, "qcfail");
  });

  it("stops a prior callback server before starting quick auth again", async () => {
    h.clientSpies.authenticate.mockResolvedValue(undefined);
    const r = await mount(oneHttp());
    await press(r, ["q", ENTER]); // first run completes, leaving the server set
    await tick();
    await press(r, ["q", ENTER]); // second run stops the prior server
    await tick();
    expect(h.callbackStop).toHaveBeenCalled();
  });

  it("completes guided auth when the callback fires", async () => {
    const r = await mount(oneHttp());
    await press(r, ["g", " "]); // Space starts guided + registers callback server
    await waitUntil(() => h.cb.opts !== null);
    expect(h.cb.opts).not.toBeNull();
    await h.cb.opts!.onCallback({ code: "gc" });
    await tick();
    expect(h.clientSpies.completeOAuthFlow).toHaveBeenCalledWith("gc");
    await expectFrame(r, "OAuth complete");
  });

  it("reports an error when the guided callback errors", async () => {
    const r = await mount(oneHttp());
    await press(r, ["g", " "]);
    await waitUntil(() => h.cb.opts !== null);
    expect(h.cb.opts).not.toBeNull();
    h.cb.opts!.onError({ error: "guided-bad" });
    await tick();
    await expectFrame(r, "guided-bad");
  });

  it("reports an error when guided callback completion fails", async () => {
    h.clientSpies.completeOAuthFlow.mockRejectedValue(new Error("gfail"));
    const r = await mount(oneHttp());
    await press(r, ["g", " "]);
    await waitUntil(() => h.cb.opts !== null);
    await h.cb.opts!.onCallback({ code: "x" });
    await tick();
    await expectFrame(r, "gfail");
  });

  it("completes run-to-completion auth when the callback fires", async () => {
    const r = await mount(oneHttp());
    await press(r, ["g", ENTER]); // runs to completion -> ensureCallbackServer
    await waitUntil(() => h.cb.opts !== null);
    expect(h.cb.opts).not.toBeNull();
    await h.cb.opts!.onCallback({ code: "rc" });
    await tick();
    expect(h.clientSpies.completeOAuthFlow).toHaveBeenCalledWith("rc");
    await expectFrame(r, "OAuth complete");
  });

  it("reports an error when the run-to-completion callback errors", async () => {
    const r = await mount(oneHttp());
    await press(r, ["g", ENTER]);
    await waitUntil(() => h.cb.opts !== null);
    expect(h.cb.opts).not.toBeNull();
    h.cb.opts!.onError({ error: "rc-bad" });
    await tick();
    await expectFrame(r, "rc-bad");
  });

  it("stringifies a non-Error quick auth rejection", async () => {
    h.clientSpies.authenticate.mockRejectedValue("plainstring");
    const r = await mount(oneHttp());
    await press(r, ["q", ENTER]);
    await tick();
    await expectFrame(r, "plainstring");
  });

  it("uses the default OAuth error label when the callback error is empty", async () => {
    const r = await mount(oneHttp());
    await press(r, ["q", ENTER]);
    await waitUntil(() => h.cb.opts !== null);
    expect(h.cb.opts).not.toBeNull();
    h.cb.opts!.onError({});
    await tick();
    await expectFrame(r, "OAuth error");
  });

  it("stringifies a non-Error guided callback completion failure", async () => {
    h.clientSpies.completeOAuthFlow.mockRejectedValue("guided-string");
    const r = await mount(oneHttp());
    await press(r, ["g", " "]);
    await waitUntil(() => h.cb.opts !== null);
    await h.cb.opts!.onCallback({ code: "x" });
    await tick();
    await expectFrame(r, "guided-string");
  });

  it("falls back to params.error when the quick callback has no description", async () => {
    const r = await mount(oneHttp());
    await press(r, ["q", ENTER]);
    await waitUntil(() => h.cb.opts !== null);
    h.cb.opts!.onError({ error: "quick-error-code" });
    await tick();
    await expectFrame(r, "quick-error-code");
  });

  it("uses the default label when the guided callback error is empty", async () => {
    const r = await mount(oneHttp());
    await press(r, ["g", " "]);
    await waitUntil(() => h.cb.opts !== null);
    h.cb.opts!.onError({});
    await tick();
    await expectFrame(r, "OAuth error");
  });

  it("uses the default label when the run-to-completion error is empty", async () => {
    const r = await mount(oneHttp());
    await press(r, ["g", ENTER]);
    await waitUntil(() => h.cb.opts !== null);
    h.cb.opts!.onError({});
    await tick();
    await expectFrame(r, "OAuth error");
  });

  it("wraps a non-Error quick callback rejection into an Error", async () => {
    h.clientSpies.completeOAuthFlow.mockRejectedValue("quick-cb-string");
    const r = await mount(oneHttp());
    await press(r, ["q", ENTER]);
    await waitUntil(() => h.cb.opts !== null);
    expect(h.cb.opts).not.toBeNull();
    await h.cb.opts!.onCallback({ code: "x" });
    await tick();
    // quick auth's onCallback wraps the throw via new Error(String(err)); the
    // flow rejects and the catch surfaces the stringified message.
    await expectFrame(r, "quick-cb-string");
  });

  it("stringifies a non-Error guided-start rejection", async () => {
    h.clientSpies.beginGuidedAuth.mockRejectedValue("startfail-string");
    const r = await mount(oneHttp());
    await press(r, ["g", " "]);
    await tick();
    await expectFrame(r, "startfail-string");
  });

  it("stringifies a non-Error guided-advance rejection", async () => {
    h.clientSpies.proceedOAuthStep.mockRejectedValue("advfail-string");
    const r = await mount(oneHttp());
    await press(r, ["g", " "]);
    await tick();
    await press(r, [" "]);
    await tick();
    await expectFrame(r, "advfail-string");
  });

  it("stringifies a non-Error run-to-completion rejection", async () => {
    h.clientSpies.runGuidedAuth.mockRejectedValue("runfail-string");
    const r = await mount(oneHttp());
    await press(r, ["g", ENTER]);
    await tick();
    await expectFrame(r, "runfail-string");
  });

  it("ignores a re-entrant quick-auth trigger while one is in progress", async () => {
    // Hold the first flow open by leaving authenticate pending, so the second
    // 'q' hits the `if (oauthInProgressRef.current) return` guard.
    let release!: () => void;
    h.clientSpies.authenticate.mockImplementation(
      () => new Promise<string>((res) => (release = () => res(undefined))),
    );
    const r = await mount(oneHttp());
    await press(r, ["q", ENTER]);
    await tick();
    await press(r, ["q", ENTER]); // re-entrant: guarded out
    await tick();
    expect(h.callbackStart).toHaveBeenCalledTimes(1);
    release();
    await tick();
  });
});
