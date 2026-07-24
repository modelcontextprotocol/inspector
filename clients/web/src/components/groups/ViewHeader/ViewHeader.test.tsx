import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  act,
  renderWithMantine,
  renderWithMantineTransitions,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { theme } from "../../../theme/theme";
import { ViewHeader } from "./ViewHeader";

// Render under a forced-dark MantineProvider so `useComputedColorScheme`
// returns "dark" (the light/dark icon + logo branches). `env="test"` disables
// timer-driven transitions, matching the shared `renderWithMantine` wrapper and
// avoiding post-teardown `window is not defined` races (#1760).
function renderDark(ui: React.ReactElement) {
  return render(ui, {
    wrapper: ({ children }) => (
      <MantineProvider theme={theme} defaultColorScheme="dark" env="test">
        {children}
      </MantineProvider>
    ),
  });
}

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
  onOpenClientSettings: vi.fn(),
};

describe("ViewHeader", () => {
  beforeEach(() => {
    mediaQueryMock.value = false;
  });

  describe("when not connected", () => {
    it("renders the title and theme toggle", () => {
      renderWithMantine(
        <ViewHeader
          connected={false}
          onToggleTheme={vi.fn()}
          onOpenClientSettings={vi.fn()}
        />,
      );
      expect(screen.getByText("MCP Inspector")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Client settings" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Toggle color scheme" }),
      ).toBeInTheDocument();
    });

    it("shows an 'MCP Documentation' tooltip on the logo link (#1682)", async () => {
      const user = userEvent.setup();
      renderWithMantine(
        <ViewHeader
          connected={false}
          onToggleTheme={vi.fn()}
          onOpenClientSettings={vi.fn()}
        />,
      );
      await user.hover(screen.getByRole("link"));
      expect(await screen.findByText("MCP Documentation")).toBeInTheDocument();
    });

    it("invokes onOpenClientSettings when the client settings button is clicked", async () => {
      const user = userEvent.setup();
      const onOpenClientSettings = vi.fn();
      renderWithMantine(
        <ViewHeader
          connected={false}
          onToggleTheme={vi.fn()}
          onOpenClientSettings={onOpenClientSettings}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Client settings" }));
      expect(onOpenClientSettings).toHaveBeenCalled();
    });

    it("invokes onToggleTheme when the theme button is clicked", async () => {
      const user = userEvent.setup();
      const onToggleTheme = vi.fn();
      renderWithMantine(
        <ViewHeader
          connected={false}
          onToggleTheme={onToggleTheme}
          onOpenClientSettings={vi.fn()}
        />,
      );
      await user.click(
        screen.getByRole("button", { name: "Toggle color scheme" }),
      );
      expect(onToggleTheme).toHaveBeenCalledTimes(1);
    });

    it("omits the monitoring toggle when no monitorToggle is provided", () => {
      renderWithMantine(
        <ViewHeader
          connected={false}
          onToggleTheme={vi.fn()}
          onOpenClientSettings={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Open monitoring sidebar" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeNull();
    });

    it("renders and wires the monitoring toggle for a failed connect attempt", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      renderWithMantine(
        <ViewHeader
          connected={false}
          onToggleTheme={vi.fn()}
          onOpenClientSettings={vi.fn()}
          monitorToggle={{ open: false, onToggle }}
        />,
      );
      await user.click(
        screen.getByRole("button", { name: "Open monitoring sidebar" }),
      );
      expect(onToggle).toHaveBeenCalledTimes(1);
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

    it("renders the monitoring toggle in its open state and toggles it closed", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      renderWithMantine(
        <ViewHeader
          {...connectedProps}
          monitorToggle={{ open: true, onToggle }}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Open monitoring sidebar" }),
      ).toBeNull();
      await user.click(
        screen.getByRole("button", { name: "Close monitoring sidebar" }),
      );
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("invokes onDisconnect when the disconnect control is clicked", async () => {
      const user = userEvent.setup();
      const onDisconnect = vi.fn();
      renderWithMantine(
        <ViewHeader {...connectedProps} onDisconnect={onDisconnect} />,
      );
      // Disconnect is always the icon, labelled by its aria-label / tooltip.
      const disconnectButton = screen.getByRole("button", {
        name: "Disconnect from server",
      });
      await user.click(disconnectButton);
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });

    it("renders all available tabs", () => {
      renderWithMantine(<ViewHeader {...connectedProps} />);
      expect(screen.getAllByText("Resources").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Prompts").length).toBeGreaterThan(0);
    });

    it("renders the SegmentedControl and the disconnect icon on wide viewports", async () => {
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
      // Disconnect is always the icon (labelled by its tooltip / aria-label).
      const disconnectBtn = screen.getByRole("button", {
        name: "Disconnect from server",
      });
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
      // Asserts the mid-flight exit ("out") state, so it needs real transitions;
      // it drives them to completion below (waitFor unmount).
      const { rerender } = renderWithMantineTransitions(
        <ViewHeader {...connectedProps} />,
      );
      expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);

      // Disconnect: the connected header is replaced, but the tab bar stays in
      // the DOM (now marked for the exit animation) until the keep-alive
      // Transition's exit window elapses — so it isn't removed synchronously.
      rerender(
        <ViewHeader
          connected={false}
          onToggleTheme={vi.fn()}
          onOpenClientSettings={vi.fn()}
        />,
      );
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

    it("glows a tab added after the connect grace window, not during it (#1450)", () => {
      vi.useFakeTimers();
      try {
        mediaQueryMock.value = true;
        const { rerender } = renderWithMantine(
          <ViewHeader {...connectedProps} />,
        );
        // During the post-connect grace window an async-resolved list (adding
        // "Apps") counts as part of the initial set and does not glow.
        rerender(
          <ViewHeader
            {...connectedProps}
            availableTabs={["Tools", "Apps", "Resources", "Prompts"]}
          />,
        );
        expect(document.querySelector('[data-glow="on"]')).toBeNull();

        // Once the grace window elapses, a genuine mid-session addition glows.
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        rerender(
          <ViewHeader
            {...connectedProps}
            availableTabs={["Tools", "Apps", "Resources", "Prompts", "Tasks"]}
          />,
        );
        const glowing = document.querySelectorAll('[data-glow="on"]');
        expect(glowing.length).toBe(1);
        expect(glowing[0]?.textContent).toBe("Tasks");
      } finally {
        vi.useRealTimers();
      }
    });

    it("animates the server name and disconnect controls in on connect, out on disconnect (#1450)", async () => {
      mediaQueryMock.value = true;
      // Asserts the mid-flight exit ("out") state, so it needs real transitions;
      // it drives them to completion below (waitFor unmount).
      const { rerender } = renderWithMantineTransitions(
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
          .getByRole("button", { name: "Disconnect from server" })
          .closest("[data-anim]")
          ?.getAttribute("data-anim"),
      ).toBe("in");

      // Disconnect: both stay mounted (animating out) before unmounting.
      rerender(
        <ViewHeader
          connected={false}
          onToggleTheme={vi.fn()}
          onOpenClientSettings={vi.fn()}
        />,
      );
      expect(
        screen
          .getByText("my-mcp-server")
          .closest("[data-anim]")
          ?.getAttribute("data-anim"),
      ).toBe("out");
      expect(
        screen
          .getByRole("button", { name: "Disconnect from server" })
          .closest("[data-anim]")
          ?.getAttribute("data-anim"),
      ).toBe("out");

      await waitFor(() =>
        expect(screen.queryByText("my-mcp-server")).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByRole("button", { name: "Disconnect from server" }),
      ).not.toBeInTheDocument();
    });

    it("renders the dark-scheme icon/logo branch under a dark color scheme", () => {
      // Rendering under a forced-dark provider exercises the
      // `colorScheme === "dark"` branches for the theme icon and the logo src.
      renderDark(<ViewHeader {...connectedProps} />);
      expect(
        screen.getByRole("button", { name: "Toggle color scheme" }),
      ).toBeInTheDocument();
      expect(screen.getByAltText("MCP")).toBeInTheDocument();
    });

    it("crossfades the title out and the connected header in on connect (#1450)", async () => {
      mediaQueryMock.value = true;
      // Asserts the mid-flight exit ("out") state, so it needs real transitions;
      // it drives them to completion below (findByText for the entering header).
      // Start disconnected: the title cell is the entering one.
      const { rerender } = renderWithMantineTransitions(
        <ViewHeader
          connected={false}
          onToggleTheme={vi.fn()}
          onOpenClientSettings={vi.fn()}
        />,
      );
      expect(
        screen
          .getByText("MCP Inspector")
          .closest("[data-anim]")
          ?.getAttribute("data-anim"),
      ).toBe("in");

      // Connect: the title cell stays mounted while it exits ("out"), and the
      // connected snapshot is adopted from a previously-null snapshot (the
      // `snapshot ? … : ""` and `seenTabsKey ? … : []` empty-base branches).
      rerender(<ViewHeader {...connectedProps} />);
      expect(
        screen
          .getByText("MCP Inspector")
          .closest("[data-anim]")
          ?.getAttribute("data-anim"),
      ).toBe("out");
      // The connected server name enters once the keep-alive Transition mounts.
      expect(await screen.findByText("my-mcp-server")).toBeInTheDocument();
    });

    it("disarms the tab glow when the connection drops after the grace window", () => {
      vi.useFakeTimers();
      try {
        mediaQueryMock.value = true;
        const { rerender } = renderWithMantine(
          <ViewHeader {...connectedProps} />,
        );
        // Arm the glow by letting the grace window elapse.
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        // Disconnect resets glowArmed via adjust-state-during-render.
        rerender(
          <ViewHeader
            connected={false}
            onToggleTheme={vi.fn()}
            onOpenClientSettings={vi.fn()}
          />,
        );
        // Reconnect with a new tab: because glowArmed was reset, the freshly
        // re-seen tab set is treated as initial and nothing glows.
        rerender(
          <ViewHeader
            {...connectedProps}
            availableTabs={["Tools", "Resources", "Prompts", "Tasks"]}
          />,
        );
        expect(document.querySelector('[data-glow="on"]')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("invokes onTabChange when a different tab is picked", async () => {
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      renderWithMantine(
        <ViewHeader {...connectedProps} onTabChange={onTabChange} />,
      );
      // Tabs always render as a SegmentedControl (radios); pick another one.
      await user.click(screen.getByRole("radio", { name: "Resources" }));
      expect(onTabChange).toHaveBeenCalledWith("Resources");
    });
  });
});
