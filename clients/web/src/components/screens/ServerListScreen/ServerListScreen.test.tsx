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
});
