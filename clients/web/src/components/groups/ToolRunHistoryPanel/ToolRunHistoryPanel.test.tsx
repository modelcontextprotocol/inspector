import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
import type { ToolRun } from "../../../utils/toolRunHistory";
import { ToolRunHistoryPanel } from "./ToolRunHistoryPanel";

const run = (sequence: number, overrides: Partial<ToolRun> = {}): ToolRun => ({
  id: `r${sequence}`,
  sequence,
  toolName: "echo",
  args: { n: sequence },
  startedAt: 0,
  durationMs: 10,
  status: "ok",
  result: { content: [{ type: "text", text: `result ${sequence}` }] },
  ...overrides,
});

const runs = [
  run(3),
  run(2, { status: "error", result: undefined, error: "boom" }),
  run(1),
];

describe("ToolRunHistoryPanel", () => {
  it("lists each run with its outcome", () => {
    renderWithMantine(
      <ToolRunHistoryPanel runs={runs} isExecuting={false} onRerun={vi.fn()} />,
    );
    expect(screen.getAllByTestId("tool-run")).toHaveLength(3);
    expect(screen.getByText("Run #3")).toBeInTheDocument();
    expect(screen.getAllByText("OK")).toHaveLength(2);
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(
      screen.getByText("Tick two runs to compare them"),
    ).toBeInTheDocument();
  });

  it("re-runs a run, and disables Re-run while a call is in flight", async () => {
    const onRerun = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderWithMantine(
      <ToolRunHistoryPanel runs={runs} isExecuting={false} onRerun={onRerun} />,
    );
    await user.click(screen.getByRole("button", { name: "Re-run Run #2" }));
    expect(onRerun).toHaveBeenCalledWith(runs[1]);

    rerender(<ToolRunHistoryPanel runs={runs} isExecuting onRerun={onRerun} />);
    expect(
      screen.getByRole("button", { name: "Re-run Run #2" }),
    ).toBeDisabled();
  });

  it("expands a run to show its envelope", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ToolRunHistoryPanel runs={runs} isExecuting={false} onRerun={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Expand Run #3" }));
    expect(
      screen.getByRole("button", { name: "Collapse Run #3" }),
    ).toBeInTheDocument();
  });

  it("compares two ticked runs, older first, and swaps in a third", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ToolRunHistoryPanel runs={runs} isExecuting={false} onRerun={vi.fn()} />,
    );
    const compare = screen.getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Compare Run #3" }));
    expect(compare).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Compare Run #1" }));
    expect(screen.getByText("Run #1 and Run #3 selected")).toBeInTheDocument();
    await user.click(compare);
    expect(await screen.findByText("Run #1 → Run #3")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("tool-run-diff")).toBeNull(),
    );

    // A third tick drops the oldest selection (Run #3).
    await user.click(screen.getByRole("checkbox", { name: "Compare Run #2" }));
    expect(screen.getByText("Run #1 and Run #2 selected")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Compare Run #3" }),
    ).not.toBeChecked();

    // Unticking one leaves nothing to compare.
    await user.click(screen.getByRole("checkbox", { name: "Compare Run #2" }));
    expect(compare).toBeDisabled();
  });

  it("closes the comparison when a ticked run is pruned", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithMantine(
      <ToolRunHistoryPanel runs={runs} isExecuting={false} onRerun={vi.fn()} />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Compare Run #3" }));
    await user.click(screen.getByRole("checkbox", { name: "Compare Run #1" }));
    await user.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByTestId("tool-run-diff")).toBeInTheDocument();
    rerender(
      <ToolRunHistoryPanel
        runs={runs.slice(0, 2)}
        isExecuting={false}
        onRerun={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("tool-run-diff")).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();

    // Ticking a replacement does not reopen the comparison by itself, and the
    // pruned run no longer holds a slot: #3 and #2 are both kept.
    await user.click(screen.getByRole("checkbox", { name: "Compare Run #2" }));
    expect(screen.getByText("Run #2 and Run #3 selected")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-run-diff")).toBeNull();
  });
});
