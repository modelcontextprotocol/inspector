import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ViewHeader } from "./ViewHeader";

// Mock @mantine/hooks so we can control useMediaQuery results per test.
const mediaQueryMock = vi.hoisted(() => ({ value: false }));
vi.mock("@mantine/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@mantine/hooks")>("@mantine/hooks");
  return {
    ...actual,
    useMediaQuery: () => mediaQueryMock.value,
  };
});

const connectedProps = {
  connected: true as const,
  serverInfo: { name: "my-mcp-server", version: "1.2.0" },
  status: "connected" as const,
  latencyMs: 23,
  activeTab: "Tools",
  availableTabs: ["Tools", "Resources", "Prompts"],
  onTabChange: vi.fn(),
  onDisconnect: vi.fn(),
  onToggleTheme: vi.fn(),
};

describe("ViewHeader", () => {
  beforeEach(() => {
    mediaQueryMock.value = false;
  });

  describe("when not connected", () => {
    it("renders the title and theme toggle", () => {
      renderWithMantine(
        <ViewHeader connected={false} onToggleTheme={vi.fn()} />,
      );
      expect(screen.getByText("MCP Inspector")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Toggle color scheme" }),
      ).toBeInTheDocument();
    });

    it("invokes onToggleTheme when the theme button is clicked", async () => {
      const user = userEvent.setup();
      const onToggleTheme = vi.fn();
      renderWithMantine(
        <ViewHeader connected={false} onToggleTheme={onToggleTheme} />,
      );
      await user.click(
        screen.getByRole("button", { name: "Toggle color scheme" }),
      );
      expect(onToggleTheme).toHaveBeenCalledTimes(1);
    });
  });

  describe("when connected", () => {
    it("renders the server name and tab data", () => {
      renderWithMantine(<ViewHeader {...connectedProps} />);
      expect(screen.getByText("my-mcp-server")).toBeInTheDocument();
      // The active tab "Tools" should appear at least once (segmented control or select)
      const toolsMatches = screen.getAllByText("Tools");
      expect(toolsMatches.length).toBeGreaterThan(0);
    });

    it("invokes onToggleTheme when the theme button is clicked", async () => {
      const user = userEvent.setup();
      const onToggleTheme = vi.fn();
      renderWithMantine(
        <ViewHeader {...connectedProps} onToggleTheme={onToggleTheme} />,
      );
      await user.click(
        screen.getByRole("button", { name: "Toggle color scheme" }),
      );
      expect(onToggleTheme).toHaveBeenCalledTimes(1);
    });

    it("invokes onDisconnect when the disconnect control is clicked", async () => {
      const user = userEvent.setup();
      const onDisconnect = vi.fn();
      renderWithMantine(
        <ViewHeader {...connectedProps} onDisconnect={onDisconnect} />,
      );
      // Either label-button "Disconnect" (wide) or icon-only with aria-label
      const disconnectButton =
        screen.queryByRole("button", { name: "Disconnect" }) ??
        screen.getByRole("button", { name: /disconnect/i });
      await user.click(disconnectButton);
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });

    it("renders all available tabs", () => {
      renderWithMantine(<ViewHeader {...connectedProps} />);
      expect(screen.getAllByText("Resources").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Prompts").length).toBeGreaterThan(0);
    });

    it("renders the SegmentedControl and label disconnect button on wide viewports", async () => {
      mediaQueryMock.value = true;
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      const onDisconnect = vi.fn();
      renderWithMantine(
        <ViewHeader
          {...connectedProps}
          onTabChange={onTabChange}
          onDisconnect={onDisconnect}
        />,
      );
      // Disconnect renders as a labelled button on wide viewport.
      const disconnectBtn = screen.getByRole("button", { name: "Disconnect" });
      await user.click(disconnectBtn);
      expect(onDisconnect).toHaveBeenCalledTimes(1);

      // SegmentedControl exposes its options as radios.
      const radios = screen.getAllByRole("radio");
      expect(radios.length).toBeGreaterThan(0);
    });

    it("invokes onTabChange when a different tab is picked from the Select", async () => {
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      renderWithMantine(
        <ViewHeader {...connectedProps} onTabChange={onTabChange} />,
      );
      // On narrow viewport (default mediaQuery=false), tabs use a Select.
      const select = screen.getByRole("textbox");
      await user.click(select);
      const option = await screen.findByRole("option", {
        name: "Resources",
        hidden: true,
      });
      await user.click(option);
      expect(onTabChange).toHaveBeenCalledWith("Resources");
    });
  });
});
