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

    it("animates the connected tab bar in with the slide-down enter (#1450)", () => {
      mediaQueryMock.value = true;
      renderWithMantine(<ViewHeader {...connectedProps} />);
      // The tab bar lives in a crossfade cell marked for the enter animation.
      const cell = screen.getAllByRole("radio")[0]!.closest("[data-anim]");
      expect(cell?.getAttribute("data-anim")).toBe("in");
    });

    it("crossfades on disconnect: tab bar exits while the title enters, then the bar unmounts (#1450)", async () => {
      mediaQueryMock.value = true;
      const { rerender } = renderWithMantine(
        <ViewHeader {...connectedProps} />,
      );
      expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);

      // Disconnect: the connected header is replaced, but the tab bar stays in
      // the DOM (now marked for the exit animation) until the keep-alive
      // Transition's exit window elapses — so it isn't removed synchronously.
      rerender(<ViewHeader connected={false} onToggleTheme={vi.fn()} />);
      const exitingCell = screen
        .getAllByRole("radio")[0]!
        .closest("[data-anim]");
      expect(exitingCell?.getAttribute("data-anim")).toBe("out");

      // The title enters (staggered) in its own cell.
      const title = await screen.findByText("MCP Inspector");
      expect(title.closest("[data-anim]")?.getAttribute("data-anim")).toBe(
        "in",
      );

      // After the exit transition the tab bar is removed from the DOM entirely.
      await waitFor(() =>
        expect(screen.queryAllByRole("radio").length).toBe(0),
      );
    });

    it("pulses a red glow on a tab that newly appears mid-session, not on initial connect (#1450)", () => {
      mediaQueryMock.value = true;
      const { rerender } = renderWithMantine(
        <ViewHeader {...connectedProps} />,
      );
      // Nothing glows on the initial connected render.
      expect(document.querySelector('[data-glow="on"]')).toBeNull();

      // A list change adds the "Apps" tab — only its label is marked to glow.
      rerender(
        <ViewHeader
          {...connectedProps}
          availableTabs={["Tools", "Apps", "Resources", "Prompts"]}
        />,
      );
      const glowing = document.querySelectorAll('[data-glow="on"]');
      expect(glowing.length).toBe(1);
      expect(glowing[0]?.textContent).toBe("Apps");
    });

    it("animates the server name and disconnect controls in on connect, out on disconnect (#1450)", async () => {
      mediaQueryMock.value = true;
      const { rerender } = renderWithMantine(
        <ViewHeader {...connectedProps} />,
      );
      // Connected: the server name and the Disconnect control are in their
      // enter cells.
      expect(
        screen
          .getByText("my-mcp-server")
          .closest("[data-anim]")
          ?.getAttribute("data-anim"),
      ).toBe("in");
      expect(
        screen
          .getByRole("button", { name: "Disconnect" })
          .closest("[data-anim]")
          ?.getAttribute("data-anim"),
      ).toBe("in");

      // Disconnect: both stay mounted (animating out) before unmounting.
      rerender(<ViewHeader connected={false} onToggleTheme={vi.fn()} />);
      expect(
        screen
          .getByText("my-mcp-server")
          .closest("[data-anim]")
          ?.getAttribute("data-anim"),
      ).toBe("out");
      expect(
        screen
          .getByRole("button", { name: "Disconnect" })
          .closest("[data-anim]")
          ?.getAttribute("data-anim"),
      ).toBe("out");

      await waitFor(() =>
        expect(screen.queryByText("my-mcp-server")).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByRole("button", { name: "Disconnect" }),
      ).not.toBeInTheDocument();
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
