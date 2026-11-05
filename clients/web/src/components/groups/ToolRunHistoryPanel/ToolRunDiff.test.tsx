import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import type { ToolRun } from "../../../utils/toolRunHistory";
import { ToolRunDiff } from "./ToolRunDiff";

const run = (sequence: number, text: string, durationMs = 10): ToolRun => ({
  id: `r${sequence}`,
  sequence,
  toolName: "echo",
  args: { message: "hi" },
  startedAt: 0,
  durationMs,
  status: "ok",
  result: { content: [{ type: "text", text }] },
});

describe("ToolRunDiff", () => {
  it("names both runs and their durations", () => {
    renderWithMantine(
      <ToolRunDiff before={run(1, "a", 12)} after={run(3, "b", 2500)} />,
    );
    expect(screen.getByText("Run #1 → Run #3")).toBeInTheDocument();
    expect(screen.getByText(/12 ms →\s*2\.50 s/)).toBeInTheDocument();
  });

  it("marks removed, added and unchanged lines", () => {
    const { container } = renderWithMantine(
      <ToolRunDiff before={run(1, "old")} after={run(2, "new")} />,
    );
    const removed = container.querySelectorAll('[data-diff="removed"]');
    const added = container.querySelectorAll('[data-diff="added"]');
    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(removed[0].textContent).toContain('"text": "old"');
    expect(added[0].textContent).toContain('"text": "new"');
    expect(
      container.querySelectorAll('[data-diff="same"]').length,
    ).toBeGreaterThan(0);
  });

  it("says so when the runs are identical", () => {
    renderWithMantine(
      <ToolRunDiff before={run(1, "same")} after={run(2, "same", 99)} />,
    );
    expect(screen.getByText("No differences")).toBeInTheDocument();
  });

  it("declines to diff runs too large to compare", () => {
    const big = (sequence: number) => ({
      ...run(sequence, ""),
      result: {
        content: Array.from({ length: 2100 }, (_, i) => ({
          type: "text" as const,
          text: `${sequence}-${i}`,
        })),
      },
    });
    renderWithMantine(<ToolRunDiff before={big(1)} after={big(2)} />);
    expect(screen.getByText("Too large to compare")).toBeInTheDocument();
  });
});
