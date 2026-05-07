import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  renderWithMantine,
  screen,
  within,
} from "../../../test/renderWithMantine";
import { AppsScreen } from "./AppsScreen";
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
    properties: { metric: { type: "string" } },
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

function buildProps(overrides: Partial<Parameters<typeof AppsScreen>[0]> = {}) {
  return {
    tools: [fieldedApp, noFieldsApp, cohortApp] as Tool[],
    listChanged: false,
    // happy-dom would otherwise try to fetch the iframe `src` over the
    // network. A data URL keeps the AppRenderer mountable without leaving
    // the test environment.
    sandboxPath: "data:text/html,<title>sandbox</title>",
    bridgeFactory: okBridgeFactory,
    rendererRef: createRef<AppRendererHandle>(),
    onRefreshList: vi.fn(),
    onSelectApp: vi.fn(),
    onOpenApp: vi.fn(),
    onCloseApp: vi.fn(),
    ...overrides,
  };
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

  it("filters the list via the search input", async () => {
    const user = userEvent.setup();
    renderWithMantine(<AppsScreen {...buildProps()} />);
    await user.type(screen.getByPlaceholderText("Search apps..."), "weather");
    expect(screen.getByText("Weather Widget")).toBeInTheDocument();
    expect(screen.queryByText("Ops Dashboard")).not.toBeInTheDocument();
  });

  it("shows 'No matching apps' when search yields no results", async () => {
    const user = userEvent.setup();
    renderWithMantine(<AppsScreen {...buildProps()} />);
    await user.type(screen.getByPlaceholderText("Search apps..."), "zzz");
    expect(screen.getByText("No matching apps")).toBeInTheDocument();
  });

  it("opens the detail panel when a fielded app is selected", async () => {
    const user = userEvent.setup();
    const onSelectApp = vi.fn();
    const onOpenApp = vi.fn();
    renderWithMantine(
      <AppsScreen {...buildProps({ onSelectApp, onOpenApp })} />,
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
    renderWithMantine(<AppsScreen {...buildProps({ onOpenApp })} />);
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
    renderWithMantine(<AppsScreen {...buildProps({ onOpenApp })} />);
    await user.click(screen.getByText("Weather Widget"));
    const cityField = screen.getByRole("textbox", { name: /city/i });
    await user.type(cityField, "Reykjavik");
    await user.click(screen.getByRole("button", { name: /Open App/ }));
    expect(onOpenApp).toHaveBeenCalledWith("weather", { city: "Reykjavik" });
    expect(screen.getByTitle("Weather Widget")).toBeInTheDocument();
  });

  it("returns to the input form when 'Back to Input' is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(<AppsScreen {...buildProps()} />);
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
    renderWithMantine(<AppsScreen {...buildProps()} />);
    await user.click(screen.getByText("Ops Dashboard"));
    expect(
      screen.queryByRole("button", { name: /Back to Input/ }),
    ).not.toBeInTheDocument();
  });

  it("toggles maximize, hiding the sidebar", async () => {
    const user = userEvent.setup();
    renderWithMantine(<AppsScreen {...buildProps()} />);
    await user.click(screen.getByText("Ops Dashboard"));
    expect(screen.getByText("MCP Apps (3)")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Maximize"));
    expect(screen.queryByText("MCP Apps (3)")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Restore"));
    expect(screen.getByText("MCP Apps (3)")).toBeInTheDocument();
  });

  it("calls onCloseApp and clears selection on Close", async () => {
    const user = userEvent.setup();
    const onCloseApp = vi.fn();
    renderWithMantine(<AppsScreen {...buildProps({ onCloseApp })} />);
    await user.click(screen.getByText("Ops Dashboard"));
    await user.click(screen.getByLabelText("Close"));
    expect(onCloseApp).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Select an app to view details")).toBeVisible();
  });

  it("ignores re-clicking the same app (no duplicate onSelectApp)", async () => {
    const user = userEvent.setup();
    const onSelectApp = vi.fn();
    renderWithMantine(<AppsScreen {...buildProps({ onSelectApp })} />);
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
    renderWithMantine(<AppsScreen {...buildProps()} />);
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

  it("renders the ListChangedIndicator when listChanged is true", async () => {
    const user = userEvent.setup();
    const onRefreshList = vi.fn();
    renderWithMantine(
      <AppsScreen {...buildProps({ listChanged: true, onRefreshList })} />,
    );
    // The indicator and toolbar both render "Refresh" buttons; the indicator
    // is a sibling of the "List updated" label, so target it via that label.
    expect(screen.getByText("List updated")).toBeInTheDocument();
    const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
    expect(refreshButtons).toHaveLength(2);
    await user.click(refreshButtons[0]);
    expect(onRefreshList).toHaveBeenCalledTimes(1);
  });

  it("invokes onRefreshList when the toolbar Refresh button is clicked", async () => {
    const user = userEvent.setup();
    const onRefreshList = vi.fn();
    renderWithMantine(<AppsScreen {...buildProps({ onRefreshList })} />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefreshList).toHaveBeenCalledTimes(1);
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
    renderWithMantine(<AppsScreen {...buildProps({ tools: [iconedApp] })} />);
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
      <AppsScreen {...buildProps({ onSelectApp })} />,
    );
    // Click an item, then re-render with a tools list that no longer
    // contains it: the selection state stays put, but a follow-up click
    // on the same name no-ops because the lookup fails.
    await user.click(screen.getByText("Weather Widget"));
    rerender(
      <AppsScreen
        {...buildProps({ onSelectApp, tools: [noFieldsApp, cohortApp] })}
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
});
