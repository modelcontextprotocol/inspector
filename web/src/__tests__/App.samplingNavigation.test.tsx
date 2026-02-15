/**
 * UX tests: when a sampling request arrives (via InspectorClient newPendingSample event),
 * the App shows it in the sampling tab and Approve/Reject call the correct callbacks.
 *
 * Mirrors client/src/__tests__/App.samplingNavigation.test.tsx. The client injects
 * the request via useConnection's onPendingRequest; the web App subscribes via
 * inspectorClient.addEventListener("newPendingSample", ...). We mock InspectorClient
 * only to capture that listener and emit one event with the same detail shape the real
 * client uses (shared/mcp/samplingCreateMessage.ts SamplingCreateMessage: id, request,
 * respond, reject). Sampling behavior itself is tested in shared/__tests__/inspectorClient.test.ts.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import App from "../App";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
function renderApp() {
  return render(
    <TooltipProvider>
      <App />
    </TooltipProvider>,
  );
}

// Event payload shape matches shared SamplingCreateMessage (id, request, respond, reject)
type NewPendingSampleDetail = {
  id: string;
  request: CreateMessageRequest;
  respond: (result: CreateMessageResult) => Promise<void>;
  reject: (error: Error) => Promise<void>;
};

const newPendingSampleListeners = new Set<
  (e: CustomEvent<NewPendingSampleDetail>) => void
>();

let dispatchNewPendingSample:
  | ((detail: NewPendingSampleDetail) => void)
  | null = null;

function createFakeInspectorClient() {
  const client = {
    addEventListener(
      type: string,
      handler: (e: CustomEvent<NewPendingSampleDetail>) => void,
    ) {
      if (type === "newPendingSample") {
        newPendingSampleListeners.add(handler);
      }
    },
    removeEventListener(
      _type: string,
      handler: (e: CustomEvent<NewPendingSampleDetail>) => void,
    ) {
      newPendingSampleListeners.delete(handler);
    },
    getStatus: () => "connected" as const,
    getMessages: () => [],
    getStderrLogs: () => [],
    getFetchRequests: () => [],
    getTools: () => [],
    getResources: () => [],
    getResourceTemplates: () => [],
    getPrompts: () => [],
    getCapabilities: () => ({ resources: {}, prompts: {}, tools: {} }),
    getServerInfo: () => ({ name: "", version: "" }),
    getInstructions: () => undefined,
    getAppRendererClient: () => ({}),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getRoots: () => [],
  };

  dispatchNewPendingSample = (detail: NewPendingSampleDetail) => {
    const event = new CustomEvent("newPendingSample", { detail });
    newPendingSampleListeners.forEach((h) => h(event));
  };

  return client;
}

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: vi.fn(),
}));

vi.mock("../utils/configUtils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/configUtils")>();
  const { DEFAULT_INSPECTOR_CONFIG } = await import("../lib/constants");
  const configWithToken = {
    ...DEFAULT_INSPECTOR_CONFIG,
    MCP_INSPECTOR_API_TOKEN: {
      ...DEFAULT_INSPECTOR_CONFIG.MCP_INSPECTOR_API_TOKEN,
      value: "test-token",
    },
  };
  return {
    ...actual,
    getInspectorApiToken: vi.fn(() => "test-token"),
    getInitialTransportType: vi.fn(() => "stdio"),
    getInitialSseUrl: vi.fn(() => "http://localhost:3001/sse"),
    getInitialCommand: vi.fn(() => "mcp-server-everything"),
    getInitialArgs: vi.fn(() => ""),
    initializeInspectorConfig: vi.fn(() => configWithToken),
    saveInspectorConfig: vi.fn(),
  };
});

// Stub so ensureInspectorClient completes and setInspectorClient(ourFake) runs (no throw before new InspectorClient)
vi.mock("../lib/adapters/environmentFactory", () => ({
  createWebEnvironment: vi.fn(() => ({
    transport: vi.fn(),
    fetch: vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    logger: { log: vi.fn() },
    oauth: undefined,
  })),
}));

vi.mock(
  "@modelcontextprotocol/inspector-core/mcp/index.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@modelcontextprotocol/inspector-core/mcp/index.js")
      >();
    function MockInspectorClient() {
      return createFakeInspectorClient();
    }
    return {
      ...actual,
      InspectorClient: vi.fn().mockImplementation(MockInspectorClient),
    };
  },
);

// Wrap real hook: when App has a client in state, force status "connected" so main pane shows Tabs
vi.mock(
  "@modelcontextprotocol/inspector-core/react/useInspectorClient.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@modelcontextprotocol/inspector-core/react/useInspectorClient.js")
      >();
    return {
      useInspectorClient: (client: unknown) => {
        const result = actual.useInspectorClient(client as never);
        return { ...result, status: client ? "connected" : result.status };
      },
    };
  },
);

vi.mock("../lib/hooks/useDraggablePane", () => ({
  useDraggablePane: () => ({
    height: 300,
    handleDragStart: vi.fn(),
  }),
  useDraggableSidebar: () => ({
    width: 320,
    isDragging: false,
    handleDragStart: vi.fn(),
  }),
}));

global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

// jsdom does not provide window.matchMedia; useTheme (via TokenLoginScreen/main UI) calls it.
const mockMatchMedia = (matches = false) => ({
  matches,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  media: "",
});

// Same request shape as client test and shared CreateMessageRequest for sampling
const sampleRequest: CreateMessageRequest = {
  method: "sampling/createMessage",
  params: { messages: [], maxTokens: 1 },
};

describe("App - Sampling navigation", () => {
  beforeEach(() => {
    dispatchNewPendingSample = null;
    newPendingSampleListeners.clear();
    window.location.hash = "#tools";
    window.matchMedia = vi
      .fn()
      .mockImplementation((_query: string) =>
        mockMatchMedia(false),
      ) as unknown as typeof window.matchMedia;
  });

  it("Step 3: Connect shows tabs including Sampling", async () => {
    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Connect/i }),
      ).toBeInTheDocument();
    });

    const connectButton = screen.getByRole("button", { name: /Connect/i });
    await act(async () => {
      fireEvent.click(connectButton);
    });

    await waitFor(
      () => {
        expect(
          screen.getByRole("tab", { name: /Sampling/i }),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("after Connect, selecting Sampling tab shows 'No pending requests'", async () => {
    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Connect/i }),
      ).toBeInTheDocument();
    });

    const connectButton = screen.getByRole("button", { name: /Connect/i });
    await act(async () => {
      fireEvent.click(connectButton);
    });

    await waitFor(
      () => {
        expect(
          screen.getByRole("tab", { name: /Sampling/i }),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Radix TabsTrigger: data-state="active" | "inactive". Verify Sampling is present and which tab is active.
    const getActiveTabName = () => {
      const active = document.querySelector(
        '[role="tab"][data-state="active"]',
      );
      return active?.textContent?.trim() ?? null;
    };
    const samplingTab = screen.getByRole("tab", { name: /Sampling/i });
    const isSamplingActive = () =>
      samplingTab.getAttribute("data-state") === "active";

    const initialActive = getActiveTabName();
    expect(samplingTab).toBeInTheDocument();
    expect(samplingTab.getAttribute("data-state")).toBeDefined();
    // Sampling is present but not active; we will select it and then assert it becomes active.
    expect(isSamplingActive()).toBe(false);

    // Select Sampling by hash only (drives App activeTab; one consistent path).
    if (!isSamplingActive()) {
      await act(() => {
        window.location.hash = "#sampling";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      await waitFor(() => expect(isSamplingActive()).toBe(true), {
        timeout: 2000,
      });
      if (!isSamplingActive()) {
        throw new Error(
          `Could not switch to Sampling. Initial active: "${initialActive}". Sampling data-state: "${samplingTab.getAttribute("data-state")}".`,
        );
      }
    }

    expect(isSamplingActive()).toBe(true);
    // Verify we see the empty state (Sampling tab content). Scope to the Tabs root that owns the tab triggers.
    const tabsRoot = samplingTab.closest("[role='tablist']")?.parentElement;
    expect(tabsRoot).toBeTruthy();
    await waitFor(
      () => {
        expect(
          within(tabsRoot!).getByText(/No pending requests/i),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("Step 4: after inducing a sampling request, Sampling tab shows the request", async () => {
    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Connect/i }),
      ).toBeInTheDocument();
    });

    const connectButton = screen.getByRole("button", { name: /Connect/i });
    await act(async () => {
      fireEvent.click(connectButton);
    });

    await waitFor(
      () => {
        expect(dispatchNewPendingSample).not.toBeNull();
        expect(newPendingSampleListeners.size).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByRole("tab", { name: /Sampling/i }),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    await act(() => {
      dispatchNewPendingSample!({
        id: "sample-step4",
        request: sampleRequest,
        respond: vi.fn().mockResolvedValue(undefined),
        reject: vi.fn().mockResolvedValue(undefined),
      });
    });

    await act(() => {
      window.location.hash = "#sampling";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(
      () => {
        expect(screen.getByTestId("sampling-request")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("shows sampling request in sampling tab and Approve resolves it", async () => {
    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Connect/i }),
      ).toBeInTheDocument();
    });

    const connectButton = screen.getByRole("button", { name: /Connect/i });
    await act(async () => {
      fireEvent.click(connectButton);
    });

    await waitFor(
      () => {
        expect(dispatchNewPendingSample).not.toBeNull();
        expect(newPendingSampleListeners.size).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByRole("tab", { name: /Sampling/i }),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    const respondFn = vi.fn().mockResolvedValue(undefined);
    const rejectFn = vi.fn().mockResolvedValue(undefined);

    await act(() => {
      dispatchNewPendingSample!({
        id: "sample-1",
        request: sampleRequest,
        respond: respondFn,
        reject: rejectFn,
      });
    });

    await act(() => {
      window.location.hash = "#sampling";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    const samplingTab = screen.getByRole("tab", { name: /Sampling/i });
    await act(async () => {
      fireEvent.click(samplingTab);
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("sampling-request")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    const approveButton = screen.getByRole("button", { name: /Approve/i });
    await act(async () => {
      fireEvent.click(approveButton);
    });

    await waitFor(() => {
      expect(respondFn).toHaveBeenCalled();
    });
  });

  it("shows sampling request and Reject calls reject", async () => {
    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Connect/i }),
      ).toBeInTheDocument();
    });
    const connectButton = screen.getByRole("button", { name: /Connect/i });
    await act(async () => {
      fireEvent.click(connectButton);
    });

    await waitFor(
      () => {
        expect(dispatchNewPendingSample).not.toBeNull();
        expect(newPendingSampleListeners.size).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByRole("tab", { name: /Sampling/i }),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    const respondFn = vi.fn().mockResolvedValue(undefined);
    const rejectFn = vi.fn().mockResolvedValue(undefined);

    await act(() => {
      dispatchNewPendingSample!({
        id: "sample-2",
        request: sampleRequest,
        respond: respondFn,
        reject: rejectFn,
      });
    });

    await act(() => {
      window.location.hash = "#sampling";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    const samplingTab = screen.getByRole("tab", { name: /Sampling/i });
    await act(async () => {
      fireEvent.click(samplingTab);
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("sampling-request")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    const rejectButton = screen.getByRole("button", { name: /Reject/i });
    await act(async () => {
      fireEvent.click(rejectButton);
    });

    await waitFor(() => {
      expect(rejectFn).toHaveBeenCalled();
    });
  });
});
