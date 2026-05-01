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
];

const baseProps = {
  servers,
  onAddManually: vi.fn(),
  onImportConfig: vi.fn(),
  onImportServerJson: vi.fn(),
  onToggleConnection: vi.fn(),
  onServerInfo: vi.fn(),
  onSettings: vi.fn(),
  onEdit: vi.fn(),
  onClone: vi.fn(),
  onRemove: vi.fn(),
};

describe("ServerListScreen", () => {
  it("renders the server card", () => {
    renderWithMantine(<ServerListScreen {...baseProps} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("renders the empty state with no servers", () => {
    renderWithMantine(<ServerListScreen {...baseProps} servers={[]} />);
    expect(
      screen.getByText("No servers configured. Add a server to get started."),
    ).toBeInTheDocument();
  });

  it("toggles compact mode when the list toggle is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ServerListScreen {...baseProps} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    await user.click(buttons[0]);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});
