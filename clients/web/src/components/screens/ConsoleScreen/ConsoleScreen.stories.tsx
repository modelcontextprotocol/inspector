import { useState } from "react";
import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { StderrLogEntry } from "../../../../../../core/mcp/types.js";
import { ConsoleScreen } from "./ConsoleScreen";
import { EMPTY_CONSOLE_UI } from "../screenUiState";

// ConsoleScreen is controlled (the search text lives in the parent as `ui` —
// see #1417). This wrapper holds that state so the play-driven search actually
// filters entries, mirroring how App owns the state.
function StatefulConsoleScreen(args: ComponentProps<typeof ConsoleScreen>) {
  const [ui, setUi] = useState({ ...EMPTY_CONSOLE_UI, ...args.ui });
  return <ConsoleScreen {...args} ui={ui} onUiChange={setUi} />;
}

const meta: Meta<typeof ConsoleScreen> = {
  title: "Screens/ConsoleScreen",
  component: ConsoleScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onClear: fn(),
    onExport: fn(),
    ui: EMPTY_CONSOLE_UI,
    onUiChange: fn(),
    sortDirection: "newest-first",
    onSortChange: fn(),
  },
  render: (args) => <StatefulConsoleScreen {...args} />,
};

export default meta;
type Story = StoryObj<typeof ConsoleScreen>;

const sampleEntries: StderrLogEntry[] = [
  {
    timestamp: new Date("2026-03-17T10:00:00Z"),
    message: "Starting MCP time server…",
  },
  {
    timestamp: new Date("2026-03-17T10:00:01Z"),
    message:
      'Traceback (most recent call last):\n  File "<frozen runpy>", line 198, in _run_module_as_main',
  },
  {
    timestamp: new Date("2026-03-17T10:00:01Z"),
    message: "ModuleNotFoundError: No module named 'mcp_server_time'",
  },
];

export const WithEntries: Story = {
  args: {
    entries: sampleEntries,
  },
};

export const Empty: Story = {
  args: {
    entries: [],
  },
};

export const FilterBySearch: Story = {
  args: {
    entries: sampleEntries,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Both the startup line and the error are visible initially.
    await expect(
      canvas.getByText("Starting MCP time server…"),
    ).toBeInTheDocument();
    // Searching for the error text hides the unrelated startup line.
    await userEvent.type(
      canvas.getByPlaceholderText("Search..."),
      "ModuleNotFound",
    );
    await expect(
      canvas.queryByText("Starting MCP time server…"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText(
        "ModuleNotFoundError: No module named 'mcp_server_time'",
      ),
    ).toBeInTheDocument();
  },
};
