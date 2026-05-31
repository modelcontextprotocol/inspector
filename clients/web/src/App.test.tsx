import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderWithMantine,
  screen,
  waitFor,
  act,
} from "./test/renderWithMantine";
import userEvent from "@testing-library/user-event";

// App is a wiring component: it owns session-scoped UI state (the per-call
// result panels and the optimistic log level) and resets it when the active
// InspectorClient emits `disconnect`. These tests exercise that reset in
// isolation by mocking the InspectorClient (a fake EventTarget we can fire
// `disconnect` on), the per-server state managers, the core hooks, and the
// InspectorView (a thin double that surfaces the props under test and lets us
// trigger the handlers). See #1368.

// --- Fake InspectorClient ---------------------------------------------------
// Extends EventTarget so the App's `addEventListener("disconnect", …)` wiring
// is real; the test fires `dispatchEvent(new Event("disconnect"))` to simulate
// any of the three disconnect paths (toggle, header button, transport failure).
vi.mock("@inspector/core/mcp/index.js", () => {
  class FakeInspectorClient extends EventTarget {
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    callTool = vi
      .fn()
      .mockResolvedValue({ success: true, result: { acts: [] } });
    setLoggingLevel = vi.fn().mockResolvedValue(undefined);
    getOAuthState = vi.fn().mockReturnValue(undefined);
  }
  const instances: FakeInspectorClient[] = [];
  return {
    InspectorClient: vi.fn(function () {
      const client = new FakeInspectorClient();
      instances.push(client);
      return client;
    }),
    // Test-only handle so the test can grab the live instance and fire events.
    __clientInstances: instances,
  };
});

// Per-server state managers — App constructs nine of them per connect and
// calls `destroy()` on teardown. Replace each with a no-op constructor.
vi.mock("@inspector/core/mcp/state/managedToolsState.js", () => ({
  ManagedToolsState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/managedPromptsState.js", () => ({
  ManagedPromptsState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/managedResourcesState.js", () => ({
  ManagedResourcesState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/managedResourceTemplatesState.js", () => ({
  ManagedResourceTemplatesState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/managedRequestorTasksState.js", () => ({
  ManagedRequestorTasksState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/resourceSubscriptionsState.js", () => ({
  ResourceSubscriptionsState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/messageLogState.js", () => ({
  MessageLogState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/fetchRequestLogState.js", () => ({
  FetchRequestLogState: vi.fn(function () {
    return { destroy: vi.fn(), getFetchRequests: vi.fn(() => []) };
  }),
}));
vi.mock("@inspector/core/mcp/state/stderrLogState.js", () => ({
  StderrLogState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));

vi.mock("@inspector/core/mcp/remote/index.js", () => ({
  RemoteInspectorClientStorage: vi.fn(function () {
    return { saveSession: vi.fn() };
  }),
}));

vi.mock("./lib/environmentFactory", () => ({
  createWebEnvironment: vi.fn(() => ({ environment: {} })),
}));

// --- Core hooks -------------------------------------------------------------
// One server is available; the tools list carries the `get_acts` tool the
// repro runs. Everything else returns empty.
const SERVER_A = {
  id: "A",
  name: "PlotRocket",
  config: { type: "stdio", command: "node" },
  connection: { status: "disconnected" },
};

vi.mock("@inspector/core/react/useServers.js", () => ({
  useServers: vi.fn(() => ({
    servers: [SERVER_A],
    addServer: vi.fn(),
    updateServer: vi.fn(),
    updateServerSettings: vi.fn(),
    removeServer: vi.fn(),
  })),
}));
vi.mock("@inspector/core/react/useInspectorClient.js", () => ({
  useInspectorClient: vi.fn(() => ({
    status: "connected",
    capabilities: {},
    clientCapabilities: {},
    // Left undefined so `initializeResult` stays undefined and the
    // ConnectionInfoModal (gated on it) never mounts during the test.
    serverInfo: undefined,
    instructions: undefined,
  })),
}));
vi.mock("@inspector/core/react/useManagedTools.js", () => ({
  useManagedTools: vi.fn(() => ({
    tools: [{ name: "get_acts", inputSchema: { type: "object" } }],
    refresh: vi.fn(),
  })),
}));
vi.mock("@inspector/core/react/useManagedPrompts.js", () => ({
  useManagedPrompts: vi.fn(() => ({ prompts: [], refresh: vi.fn() })),
}));
vi.mock("@inspector/core/react/useManagedResources.js", () => ({
  useManagedResources: vi.fn(() => ({ resources: [], refresh: vi.fn() })),
}));
vi.mock("@inspector/core/react/useManagedResourceTemplates.js", () => ({
  useManagedResourceTemplates: vi.fn(() => ({ resourceTemplates: [] })),
}));
vi.mock("@inspector/core/react/useManagedRequestorTasks.js", () => ({
  useManagedRequestorTasks: vi.fn(() => ({ tasks: [], refresh: vi.fn() })),
}));
vi.mock("@inspector/core/react/useResourceSubscriptions.js", () => ({
  useResourceSubscriptions: vi.fn(() => ({ subscriptions: [] })),
}));
vi.mock("@inspector/core/react/useMessageLog.js", () => ({
  useMessageLog: vi.fn(() => ({ messages: [] })),
}));
vi.mock("@inspector/core/react/useFetchRequestLog.js", () => ({
  useFetchRequestLog: vi.fn(() => ({ fetchRequests: [] })),
}));
vi.mock("@inspector/core/react/useSettingsDraft.js", () => ({
  useSettingsDraft: vi.fn(() => ({
    draft: undefined,
    onChange: vi.fn(),
    flush: vi.fn(),
  })),
}));

// --- InspectorView double ---------------------------------------------------
// Surfaces the two pieces of state under test and exposes buttons that invoke
// the App's connect / call-tool / set-log-level handlers.
vi.mock("./components/views/InspectorView/InspectorView", () => ({
  InspectorView: (props: {
    toolCallState?: { status?: string };
    currentLogLevel?: string;
    onToggleConnection: (id: string) => void;
    onCallTool: (name: string, args: Record<string, unknown>) => void;
    onSetLogLevel: (level: string) => void;
  }) => (
    <div>
      <span data-testid="tool-status">
        {props.toolCallState?.status ?? "none"}
      </span>
      <span data-testid="log-level">{props.currentLogLevel}</span>
      <button onClick={() => props.onToggleConnection("A")}>connect</button>
      <button onClick={() => props.onCallTool("get_acts", {})}>call</button>
      <button onClick={() => props.onSetLogLevel("debug")}>set-level</button>
    </div>
  ),
}));

import App from "./App";
import * as McpIndex from "@inspector/core/mcp/index.js";

const clientInstances = (
  McpIndex as unknown as { __clientInstances: EventTarget[] }
).__clientInstances;

describe("App session-scoped state reset on disconnect", () => {
  beforeEach(() => {
    clientInstances.length = 0;
  });

  it("clears the tool-call result panel and resets the log level when the client disconnects", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    // Connect: builds the InspectorClient and registers the disconnect listener.
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // Run a tool — the panel fills with the (resolved) result.
    await user.click(screen.getByText("call"));
    await waitFor(() =>
      expect(screen.getByTestId("tool-status")).toHaveTextContent("ok"),
    );

    // Bump the optimistic log level off its "info" default.
    await user.click(screen.getByText("set-level"));
    await waitFor(() =>
      expect(screen.getByTestId("log-level")).toHaveTextContent("debug"),
    );

    // Disconnect: the panel empties and the level returns to "info".
    act(() => {
      clientInstances[0].dispatchEvent(new Event("disconnect"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("tool-status")).toHaveTextContent("none"),
    );
    expect(screen.getByTestId("log-level")).toHaveTextContent("info");
  });
});
