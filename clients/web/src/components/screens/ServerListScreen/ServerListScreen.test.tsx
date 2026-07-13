import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ServerListScreen } from "./ServerListScreen";

const servers: ServerEntry[] = [
  {
    id: "alpha",
    name: "Alpha",
    config: { type: "stdio", command: "echo" },
    connection: { status: "disconnected" },
  },
  {
    id: "beta",
    name: "Beta",
    config: { type: "stdio", command: "echo" },
    connection: { status: "disconnected" },
  },
];

const baseProps = {
  servers,
  onAddManually: vi.fn(),
  onImportConfig: vi.fn(),
  onImportServerJson: vi.fn(),
  onExport: vi.fn(),
  onToggleConnection: vi.fn(),
  onConnectionInfo: vi.fn(),
  onSettings: vi.fn(),
  onEdit: vi.fn(),
  onClone: vi.fn(),
  onRemove: vi.fn(),
  onReorder: vi.fn(),
  compact: false,
  onToggleCompact: vi.fn(),
};

describe("ServerListScreen", () => {
  it("renders the server cards", () => {
    renderWithMantine(<ServerListScreen {...baseProps} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders the empty state with no servers", () => {
    renderWithMantine(<ServerListScreen {...baseProps} servers={[]} />);
    expect(
      screen.getByText("No servers configured. Add a server to get started."),
    ).toBeInTheDocument();
  });

  it("toggles compact mode when the list toggle is clicked", async () => {
    const user = userEvent.setup();
    const onToggleCompact = vi.fn();
    renderWithMantine(
      <ServerListScreen {...baseProps} onToggleCompact={onToggleCompact} />,
    );
    await user.click(screen.getByRole("button", { name: /collapse all/i }));
    expect(onToggleCompact).toHaveBeenCalledTimes(1);
  });

  describe("reorder affordances", () => {
    it("renders a labelled drag handle per card when onReorder is provided", () => {
      renderWithMantine(<ServerListScreen {...baseProps} />);
      expect(
        screen.getByRole("button", { name: "Reorder Alpha" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Reorder Beta" }),
      ).toBeInTheDocument();
    });

    it("marks each drag handle as a sortable activator (keyboard-operable)", () => {
      renderWithMantine(<ServerListScreen {...baseProps} />);
      const handle = screen.getByRole("button", { name: "Reorder Alpha" });
      // dnd-kit's useSortable spreads accessibility attributes onto the
      // activator: a roledescription plus a non-negative tabindex so keyboard
      // users can focus it and press Space to pick the card up.
      expect(handle).toHaveAttribute("aria-roledescription", "sortable");
      expect(handle).toHaveAttribute("tabindex", "0");
    });

    it("omits drag handles when onReorder is not provided", () => {
      renderWithMantine(
        <ServerListScreen {...baseProps} onReorder={undefined} />,
      );
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^Reorder / }),
      ).not.toBeInTheDocument();
    });
  });

  describe("read-only session (writable=false)", () => {
    it("shows the read-only banner", () => {
      renderWithMantine(<ServerListScreen {...baseProps} writable={false} />);
      expect(screen.getByText("Read-only session")).toBeInTheDocument();
    });

    it("hides the Add menu and per-card mutation actions", () => {
      renderWithMantine(<ServerListScreen {...baseProps} writable={false} />);
      // Cards still render and connect controls remain.
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /add servers/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Remove" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Clone" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Settings" }),
      ).not.toBeInTheDocument();
    });

    it("omits drag handles even when onReorder is provided", () => {
      renderWithMantine(<ServerListScreen {...baseProps} writable={false} />);
      expect(
        screen.queryByRole("button", { name: /^Reorder / }),
      ).not.toBeInTheDocument();
    });

    it("keeps the Add menu and actions when writable (default)", () => {
      renderWithMantine(<ServerListScreen {...baseProps} />);
      expect(
        screen.getByRole("button", { name: /add servers/i }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Edit" }).length).toBe(2);
      expect(screen.queryByText("Read-only session")).not.toBeInTheDocument();
    });
  });

  describe("connection-failed border (#1621)", () => {
    it("draws the red errored border only on the failed server's card", () => {
      const { container } = renderWithMantine(
        <ServerListScreen {...baseProps} erroredServerId="beta" />,
      );
      const errored = container.querySelectorAll('[data-variant="errored"]');
      expect(errored).toHaveLength(1);
      // The errored card is Beta's — its name is within the flagged card.
      expect(errored[0]).toHaveTextContent("Beta");
    });

    it("draws no errored border when erroredServerId is unset", () => {
      const { container } = renderWithMantine(
        <ServerListScreen {...baseProps} />,
      );
      expect(
        container.querySelectorAll('[data-variant="errored"]'),
      ).toHaveLength(0);
    });
  });

  describe("just-connected highlight (#1682)", () => {
    it("draws the green highlight border on the just-connected server's card", () => {
      const { container } = renderWithMantine(
        <ServerListScreen
          {...baseProps}
          activeServer="beta"
          connectedServerId="beta"
        />,
      );
      const highlighted = container.querySelectorAll(
        '[data-variant="highlighted"]',
      );
      expect(highlighted).toHaveLength(1);
      expect(highlighted[0]).toHaveTextContent("Beta");
    });

    it("draws no highlight border when connectedServerId is unset", () => {
      const { container } = renderWithMantine(
        <ServerListScreen {...baseProps} activeServer="beta" />,
      );
      expect(
        container.querySelectorAll('[data-variant="highlighted"]'),
      ).toHaveLength(0);
    });
  });

  describe("freshly-added highlight", () => {
    it("draws a green highlight border on every highlighted server", () => {
      const { container } = renderWithMantine(
        <ServerListScreen
          {...baseProps}
          highlightedServerIds={["alpha", "beta"]}
        />,
      );
      // One highlighted-variant card per highlighted server.
      expect(
        container.querySelectorAll('[data-variant="highlighted"]'),
      ).toHaveLength(2);
    });

    it("scrolls only the first highlighted card into view", () => {
      const scrollIntoView = vi.fn();
      const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        renderWithMantine(
          <ServerListScreen
            {...baseProps}
            highlightedServerIds={["alpha", "beta"]}
          />,
        );
        // Both highlighted, but only the first (alpha) scrolls.
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
      } finally {
        Element.prototype.scrollIntoView = orig;
      }
    });

    it("clears the highlight for the clicked card by id", async () => {
      const user = userEvent.setup();
      const onClearHighlight = vi.fn();
      renderWithMantine(
        <ServerListScreen
          {...baseProps}
          highlightedServerIds={["alpha", "beta"]}
          onClearHighlight={onClearHighlight}
        />,
      );
      await user.click(screen.getByText("Beta"));
      expect(onClearHighlight).toHaveBeenCalledWith("beta");
    });
  });
});
