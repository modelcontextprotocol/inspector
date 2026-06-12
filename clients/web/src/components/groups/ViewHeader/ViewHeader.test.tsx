import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
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

    it("keeps the tab bar mounted on disconnect so it can collapse to 0, then unmounts (#1450)", async () => {
      mediaQueryMock.value = true;
      const { rerender } = renderWithMantine(
        <ViewHeader {...connectedProps} />,
      );
      expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);

      // Disconnect: the connected header is replaced, but the tab bar stays in
      // the DOM (collapsing toward width 0) until the keep-alive Transition's
      // exit window elapses — so it isn't removed synchronously.
      rerender(<ViewHeader connected={false} onToggleTheme={vi.fn()} />);
      expect(screen.queryAllByRole("radio").length).toBeGreaterThan(0);
      // The clip's width target is now 0 (the CSS transition animates it there).
      const clip = document.querySelector('[style*="width 300ms ease-in"]');
      expect(clip?.getAttribute("style")).toMatch(/width:\s*0/);

      // After the exit transition the bar is removed from the DOM entirely.
      await waitFor(() =>
        expect(screen.queryAllByRole("radio").length).toBe(0),
      );
    });

    it("fades the disconnected title in only after the tab bar has collapsed (#1450)", async () => {
      mediaQueryMock.value = true;
      const { rerender } = renderWithMantine(
        <ViewHeader {...connectedProps} />,
      );
      // While connected there is no "MCP Inspector" title (the server name shows).
      expect(screen.queryByText("MCP Inspector")).not.toBeInTheDocument();

      rerender(<ViewHeader connected={false} onToggleTheme={vi.fn()} />);
      // Immediately after disconnect the tab bar is still collapsing, so the
      // title has not appeared yet.
      expect(screen.queryByText("MCP Inspector")).not.toBeInTheDocument();

      // Once the bar finishes exiting it unmounts and the title fades in.
      await waitFor(() =>
        expect(screen.getByText("MCP Inspector")).toBeInTheDocument(),
      );
    });

    it("wraps the SegmentedControl in a width-animating clip (#1450)", () => {
      mediaQueryMock.value = true;
      const { container } = renderWithMantine(
        <ViewHeader {...connectedProps} />,
      );
      // The `tabBar` Group variant carries the width transition so the bar
      // grows/shrinks smoothly when a tab is added or removed. (The runtime
      // width itself is driven by ResizeObserver, which doesn't fire under
      // happy-dom — this asserts the static transition wiring.)
      const clip = container.querySelector('[style*="width 300ms ease-in"]');
      expect(clip).not.toBeNull();
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
