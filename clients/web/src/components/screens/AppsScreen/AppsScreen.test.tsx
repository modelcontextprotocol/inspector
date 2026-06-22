import { createRef, useState } from "react";
import { act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ContentBlock, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  renderWithMantine,
  screen,
  within,
} from "../../../test/renderWithMantine";
import {
  AppsScreen,
  type AppsScreenProps,
  type AppsUiState,
} from "./AppsScreen";
import { EMPTY_APPS_UI } from "../screenUiState";
import type {
  AppRendererHandle,
  BridgeFactory,
} from "../../elements/AppRenderer/AppRenderer";

const noFieldsApp: Tool = {
  name: "ops",
  title: "Ops Dashboard",
  inputSchema: { type: "object" },
  _meta: { ui: { resourceUri: "ui://apps/ops" } },
};

const fieldedApp: Tool = {
  name: "weather",
  title: "Weather Widget",
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
    },
    required: ["city"],
  },
  _meta: { ui: { resourceUri: "ui://apps/weather" } },
};

const cohortApp: Tool = {
  name: "cohorts",
  title: "Cohort Data",
  description: "Cohort retention",
  inputSchema: {
    type: "object",
    properties: { metric: { type: "string", default: "retention" } },
  },
  _meta: { ui: { resourceUri: "ui://apps/cohorts" } },
};

const okBridgeFactory: BridgeFactory = () =>
  ({
    sendToolInput: async () => {},
    sendToolResult: async () => {},
    sendToolCancelled: async () => {},
    teardownResource: async () => ({}),
    close: async () => {},
  }) as unknown as AppBridge;

// A bridge factory whose bridge supports the addEventListener/emit surface the
// AppRenderer wires up, so a test can drive a bridge event (sizechange,
// loggingmessage) through to the screen's handling. `emit` dispatches to the
// captured listeners; `bridges` exposes each built bridge so tests can also
// drive the per-bridge handlers (onmessage, onrequestdisplaymode).
function createEventBridgeFactory(): {
  factory: BridgeFactory;
  bridges: AppBridge[];
  emit: (event: string, payload?: unknown) => void;
} {
  const listeners: Record<string, ((payload: unknown) => void)[]> = {};
  const bridges: AppBridge[] = [];
  const factory: BridgeFactory = () => {
    const bridge = {
      sendToolInput: async () => {},
      sendToolInputPartial: async () => {},
      sendToolResult: async () => {},
      sendToolCancelled: async () => {},
      sendHostContextChange: async () => {},
      teardownResource: async () => ({}),
      close: async () => {},
      addEventListener: (event: string, handler: (p: unknown) => void) => {
        (listeners[event] ??= []).push(handler);
      },
      removeEventListener: () => {},
    } as unknown as AppBridge;
    bridges.push(bridge);
    return bridge;
  };
  return {
    factory,
    bridges,
    emit: (event, payload) =>
      (listeners[event] ?? []).forEach((h) => h(payload)),
  };
}

// Invoke the onmessage handler the screen attached to the latest bridge,
// mimicking a ui/message request from the running view.
async function sendUiMessage(
  bridges: AppBridge[],
  content: ContentBlock[],
): Promise<Record<string, unknown>> {
  const onmessage = bridges.at(-1)?.onmessage as unknown as
    | ((params: {
        role: "user";
        content: ContentBlock[];
      }) => Promise<Record<string, unknown>>)
    | undefined;
  if (!onmessage) throw new Error("no onmessage handler attached");
  let result: Record<string, unknown> = {};
  await act(async () => {
    result = await onmessage({ role: "user", content });
  });
  return result;
}

function buildProps(overrides: Partial<AppsScreenProps> = {}): AppsScreenProps {
  return {
    tools: [fieldedApp, noFieldsApp, cohortApp] as Tool[],
    listChanged: false,
    // happy-dom would otherwise try to fetch the iframe `src` over the
    // network. A data URL keeps the AppRenderer mountable without leaving
    // the test environment.
    sandboxPath: "data:text/html,<title>sandbox</title>",
    bridgeFactory: okBridgeFactory,
    rendererRef: createRef<AppRendererHandle>(),
    ui: EMPTY_APPS_UI,
    onUiChange: vi.fn(),
    onRefreshList: vi.fn(),
    onSelectApp: vi.fn(),
    onOpenApp: vi.fn(),
    onCloseApp: vi.fn(),
    ...overrides,
  };
}

// AppsScreen lifts selection, form values, and the sidebar search to the
// parent (App) as one `ui` object so they persist across tab navigation
// (#1417), while `running`/`maximized` stay local to the screen. This host
// holds the lifted state so clicking an app, typing into its form/search, and
// closing drive the panel exactly as App owns it. The internal running/maximized
// state handles auto-launch, open, maximize, and back-to-input on its own. Props
// passed in override defaults; the stateful `ui` wiring is applied last so
// callers can still observe activity via the rendered state.
function ControlledAppsScreen(overrides: Partial<AppsScreenProps> = {}) {
  const props = buildProps(overrides);
  const [ui, setUi] = useState<AppsUiState>({
    ...EMPTY_APPS_UI,
    ...props.ui,
  });
  return (
    <AppsScreen
      {...props}
      ui={ui}
      onUiChange={(next) => {
        setUi(next);
        props.onUiChange(next);
      }}
    />
  );
}

describe("AppsScreen", () => {
  it("renders the empty selection state", () => {
    renderWithMantine(<AppsScreen {...buildProps()} />);
    expect(screen.getByText("Select an app to view details")).toBeVisible();
    expect(screen.getByText("MCP Apps (3)")).toBeInTheDocument();
  });

  it("shows 'No apps available' when the tool list is empty", () => {
    renderWithMantine(<AppsScreen {...buildProps({ tools: [] })} />);
    expect(screen.getByText("No apps available")).toBeInTheDocument();
    expect(screen.getByText("MCP Apps (0)")).toBeInTheDocument();
  });

  it("renders the unavailable state when no sandbox path is provided", () => {
    renderWithMantine(
      <AppsScreen {...buildProps({ sandboxPath: undefined })} />,
    );
    expect(screen.getByText(/MCP Apps are unavailable/i)).toBeInTheDocument();
    // The sidebar / app list is not rendered in the unavailable state.
    expect(screen.queryByText("MCP Apps (3)")).not.toBeInTheDocument();
  });

  it("surfaces a bridge factory failure via onError", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const throwingFactory: BridgeFactory = () => {
      throw new Error("no connected MCP client");
    };
    renderWithMantine(
      <ControlledAppsScreen
        bridgeFactory={throwingFactory}
        onError={onError}
      />,
    );
    // The no-fields app auto-launches on selection, mounting the renderer,
    // whose effect invokes the factory (which throws → routes to onError).
    await user.click(screen.getByText("Ops Dashboard"));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toContain(
      "no connected MCP client",
    );
  });

  it("filters the list via the search input", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledAppsScreen />);
    await user.type(screen.getByPlaceholderText("Search apps..."), "weather");
    expect(screen.getByText("Weather Widget")).toBeInTheDocument();
    expect(screen.queryByText("Ops Dashboard")).not.toBeInTheDocument();
  });

  it("shows 'No matching apps' when search yields no results", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledAppsScreen />);
    await user.type(screen.getByPlaceholderText("Search apps..."), "zzz");
    expect(screen.getByText("No matching apps")).toBeInTheDocument();
  });

  it("opens the detail panel when a fielded app is selected", async () => {
    const user = userEvent.setup();
    const onSelectApp = vi.fn();
    const onOpenApp = vi.fn();
    renderWithMantine(
      <ControlledAppsScreen onSelectApp={onSelectApp} onOpenApp={onOpenApp} />,
    );
    await user.click(screen.getByText("Weather Widget"));
    expect(onSelectApp).toHaveBeenCalledWith("weather");
    expect(onOpenApp).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Open App/ }),
    ).toBeInTheDocument();
  });

  it("auto-launches a no-fields app on selection", async () => {
    const user = userEvent.setup();
    const onOpenApp = vi.fn();
    renderWithMantine(<ControlledAppsScreen onOpenApp={onOpenApp} />);
    await user.click(screen.getByText("Ops Dashboard"));
    expect(onOpenApp).toHaveBeenCalledWith("ops", {});
    // Renderer iframe replaces the form; Open App button is gone.
    expect(
      screen.queryByRole("button", { name: /Open App/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByTitle("Ops Dashboard")).toBeInTheDocument();
  });

  it("invokes onOpenApp with form values when Open App is clicked", async () => {
    const user = userEvent.setup();
    const onOpenApp = vi.fn();
    renderWithMantine(<ControlledAppsScreen onOpenApp={onOpenApp} />);
    await user.click(screen.getByText("Weather Widget"));
    const cityField = screen.getByRole("textbox", { name: /city/i });
    await user.type(cityField, "Reykjavik");
    await user.click(screen.getByRole("button", { name: /Open App/ }));
    expect(onOpenApp).toHaveBeenCalledWith("weather", { city: "Reykjavik" });
    expect(screen.getByTitle("Weather Widget")).toBeInTheDocument();
  });

  it("seeds schema defaults so untouched fields are sent on Open App", async () => {
    const user = userEvent.setup();
    const onOpenApp = vi.fn();
    renderWithMantine(<ControlledAppsScreen onOpenApp={onOpenApp} />);
    await user.click(screen.getByText("Cohort Data"));
    // Open without editing the metric field: its default must still be sent.
    await user.click(screen.getByRole("button", { name: /Open App/ }));
    expect(onOpenApp).toHaveBeenCalledWith("cohorts", { metric: "retention" });
  });

  it("returns to the input form when 'Back to Input' is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledAppsScreen />);
    await user.click(screen.getByText("Weather Widget"));
    await user.type(
      screen.getByRole("textbox", { name: /city/i }),
      "Reykjavik",
    );
    await user.click(screen.getByRole("button", { name: /Open App/ }));
    await user.click(screen.getByRole("button", { name: /Back to Input/ }));
    expect(
      screen.getByRole("button", { name: /Open App/ }),
    ).toBeInTheDocument();
  });

  it("does not show 'Back to Input' for a no-fields app", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledAppsScreen />);
    await user.click(screen.getByText("Ops Dashboard"));
    expect(
      screen.queryByRole("button", { name: /Back to Input/ }),
    ).not.toBeInTheDocument();
  });

  it("toggles maximize, hiding the sidebar", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledAppsScreen />);
    await user.click(screen.getByText("Ops Dashboard"));
    expect(screen.getByText("MCP Apps (3)")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Maximize"));
    expect(screen.queryByText("MCP Apps (3)")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Restore"));
    expect(screen.getByText("MCP Apps (3)")).toBeInTheDocument();
  });

  it("sizes the renderer frame to the view-reported height", async () => {
    const user = userEvent.setup();
    const { factory, emit } = createEventBridgeFactory();
    renderWithMantine(<ControlledAppsScreen bridgeFactory={factory} />);
    // Auto-launches the no-fields app, mounting the renderer and registering
    // its sizechange listener once the bridge resolves.
    await user.click(screen.getByText("Ops Dashboard"));
    const iframe = screen.getByTitle("Ops Dashboard");
    const frame = iframe.parentElement as HTMLElement;
    // Until the view reports a size, the frame flex-grows to fill the card.
    expect(frame.style.flexGrow).toBe("1");

    await act(async () => {
      // Let the synchronous bridge factory's promise chain settle so the
      // sizechange listener is registered before we emit.
      await Promise.resolve();
      await Promise.resolve();
      emit("sizechange", { height: 600 });
    });
    // A reported height switches the frame to its content size: it stops
    // flex-growing and takes the explicit `h` (applied as a calc() the test
    // env's CSS parser elides, so the observable signal is the flex change).
    expect(frame.style.flexGrow).toBe("0");
  });

  it("calls onCloseApp and clears selection on Close", async () => {
    const user = userEvent.setup();
    const onCloseApp = vi.fn();
    renderWithMantine(<ControlledAppsScreen onCloseApp={onCloseApp} />);
    await user.click(screen.getByText("Ops Dashboard"));
    await user.click(screen.getByLabelText("Close"));
    expect(onCloseApp).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Select an app to view details")).toBeVisible();
  });

  it("ignores re-clicking the same app (no duplicate onSelectApp)", async () => {
    const user = userEvent.setup();
    const onSelectApp = vi.fn();
    renderWithMantine(<ControlledAppsScreen onSelectApp={onSelectApp} />);
    // After the first click "Weather Widget" appears both in the sidebar
    // list item and the right-pane header, so target the sidebar entry
    // explicitly via the list-item button role.
    const listItem = screen.getByRole("button", { name: /Weather Widget/ });
    await user.click(listItem);
    await user.click(listItem);
    expect(onSelectApp).toHaveBeenCalledTimes(1);
  });

  it("resets form state when switching to a different app", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledAppsScreen />);
    await user.click(screen.getByText("Weather Widget"));
    await user.type(
      screen.getByRole("textbox", { name: /city/i }),
      "Reykjavik",
    );
    await user.click(screen.getByText("Cohort Data"));
    // Cohort form is fresh; Reykjavik (the previous tool's input) is gone.
    expect(screen.queryByDisplayValue("Reykjavik")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open App/ }),
    ).toBeInTheDocument();
  });

  it("renders a single Refresh via the ListChangedIndicator when listChanged is true", async () => {
    const user = userEvent.setup();
    const onRefreshList = vi.fn();
    renderWithMantine(
      <AppsScreen {...buildProps({ listChanged: true, onRefreshList })} />,
    );
    // The indicator's Refresh is the only refresh affordance — no standalone
    // toolbar button duplicating it.
    expect(screen.getByText("List updated")).toBeInTheDocument();
    const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
    expect(refreshButtons).toHaveLength(1);
    await user.click(refreshButtons[0]);
    expect(onRefreshList).toHaveBeenCalledTimes(1);
  });

  it("shows no Refresh button when listChanged is false", () => {
    renderWithMantine(<AppsScreen {...buildProps()} />);
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
  });

  it("renders the tool icon next to the header title when present", async () => {
    const user = userEvent.setup();
    const iconSrc = "data:image/svg+xml,%3Csvg/%3E";
    const iconedApp: Tool = {
      name: "weather-with-icon",
      title: "Weather (Iconed)",
      icons: [{ src: iconSrc }],
      inputSchema: { type: "object" },
      _meta: { ui: { resourceUri: "ui://apps/weather-iconed" } },
    };
    renderWithMantine(<ControlledAppsScreen tools={[iconedApp]} />);
    await user.click(screen.getByText("Weather (Iconed)"));
    const headerImg = screen
      .getAllByRole("presentation")
      .find((img) => img.getAttribute("src") === iconSrc);
    expect(headerImg).toBeDefined();
  });

  it("ignores selection of an unknown tool name (defensive)", async () => {
    const user = userEvent.setup();
    const onSelectApp = vi.fn();
    const { rerender } = renderWithMantine(
      <ControlledAppsScreen onSelectApp={onSelectApp} />,
    );
    // Click an item, then re-render with a tools list that no longer
    // contains it: the selection state stays put, but a follow-up click
    // on the same name no-ops because the lookup fails.
    await user.click(screen.getByText("Weather Widget"));
    rerender(
      <ControlledAppsScreen
        onSelectApp={onSelectApp}
        tools={[noFieldsApp, cohortApp]}
      />,
    );
    // Sidebar no longer shows Weather Widget; the right pane falls back
    // to the empty selection state since the lookup misses.
    expect(
      within(screen.getByText("MCP Apps (2)").parentElement!).queryByText(
        "Weather Widget",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Select an app to view details")).toBeVisible();
  });

  it("surfaces ui/message content from the view in the message log", async () => {
    const user = userEvent.setup();
    const { factory, bridges } = createEventBridgeFactory();
    renderWithMantine(<ControlledAppsScreen bridgeFactory={factory} />);
    // The no-fields app auto-launches on selection, mounting the renderer,
    // whose effect invokes the (message-wrapped) factory and attaches the
    // onmessage handler the test drives below.
    await user.click(screen.getByText("Ops Dashboard"));
    await vi.waitFor(() =>
      expect(bridges.at(-1)?.onmessage).toBeTypeOf("function"),
    );
    await sendUiMessage(bridges, [
      { type: "text", text: "hello from the app" },
    ]);
    expect(screen.getByText(/Messages from app \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/hello from the app/)).toBeInTheDocument();
  });

  it("returns an empty ui/message result (no conversation content leak)", async () => {
    const user = userEvent.setup();
    const { factory, bridges } = createEventBridgeFactory();
    renderWithMantine(<ControlledAppsScreen bridgeFactory={factory} />);
    await user.click(screen.getByText("Ops Dashboard"));
    await vi.waitFor(() =>
      expect(bridges.at(-1)?.onmessage).toBeTypeOf("function"),
    );
    const result = await sendUiMessage(bridges, [
      { type: "text", text: "secret" },
    ]);
    expect(result).toEqual({});
  });

  it("clears the message log when the app is closed", async () => {
    const user = userEvent.setup();
    const { factory, bridges } = createEventBridgeFactory();
    renderWithMantine(<ControlledAppsScreen bridgeFactory={factory} />);
    await user.click(screen.getByText("Ops Dashboard"));
    await vi.waitFor(() =>
      expect(bridges.at(-1)?.onmessage).toBeTypeOf("function"),
    );
    await sendUiMessage(bridges, [
      { type: "text", text: "hello from the app" },
    ]);
    expect(screen.getByText(/Messages from app/)).toBeInTheDocument();
    await user.click(screen.getByLabelText("Close"));
    expect(screen.queryByText(/Messages from app/)).not.toBeInTheDocument();
  });

  it("surfaces app log notifications in a collapsible log panel with a working Clear", async () => {
    const user = userEvent.setup();
    const { factory, emit } = createEventBridgeFactory();
    renderWithMantine(<ControlledAppsScreen bridgeFactory={factory} />);
    await user.click(screen.getByText("Ops Dashboard"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText(/App logs/)).not.toBeInTheDocument();
    await act(async () => {
      emit("loggingmessage", { level: "warning", data: "disk almost full" });
      emit("loggingmessage", {
        level: "error",
        logger: "render",
        data: { code: 500 },
      });
    });
    const toggle = screen.getByRole("button", { name: /App logs \(2\)/ });
    expect(toggle).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText("disk almost full")).toBeInTheDocument();
    expect(screen.getByText("render")).toBeInTheDocument();
    expect(screen.getByText('{"code":500}')).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText(/App logs/)).not.toBeInTheDocument();
  });

  it("stages partial-input snapshots from the form and clears them", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledAppsScreen />);
    // No-fields apps don't show the control.
    await user.click(screen.getByText("Ops Dashboard"));
    expect(
      screen.queryByRole("button", { name: "Stage partial input" }),
    ).not.toBeInTheDocument();
    // Fielded apps do.
    await user.click(screen.getByText("Weather Widget"));
    const stage = screen.getByRole("button", { name: "Stage partial input" });
    expect(stage).toBeInTheDocument();
    expect(screen.queryByText(/staged/)).not.toBeInTheDocument();
    await user.click(stage);
    await user.click(stage);
    expect(screen.getByText("2 staged")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear staged" }));
    expect(screen.queryByText(/staged/)).not.toBeInTheDocument();
  });
});
