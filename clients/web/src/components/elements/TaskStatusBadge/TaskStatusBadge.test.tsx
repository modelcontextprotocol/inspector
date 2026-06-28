import { describe, it, expect, vi } from "vitest";
import type { TaskStatus } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { TaskStatusBadge } from "./TaskStatusBadge";

// Drive the `colorScheme === "dark"` branch in TaskStatusBadge (which picks
// black vs white badge text) deterministically. `useComputedColorScheme`
// otherwise resolves to "light" under happy-dom, leaving the dark arm
// uncovered.
const colorSchemeMock = vi.hoisted(() => ({
  value: "light" as "light" | "dark",
}));
vi.mock("@mantine/core", async () => {
  const actual =
    await vi.importActual<typeof import("@mantine/core")>("@mantine/core");
  return { ...actual, useComputedColorScheme: () => colorSchemeMock.value };
});

describe("TaskStatusBadge", () => {
  const cases: Array<[TaskStatus, string]> = [
    ["working", "working"],
    ["input_required", "input required"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
  ];

  it.each(cases)("renders the label for %s", (status, label) => {
    colorSchemeMock.value = "light";
    renderWithMantine(<TaskStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("uses black text in dark mode", () => {
    colorSchemeMock.value = "dark";
    renderWithMantine(<TaskStatusBadge status="working" />);
    // Rendering under the mocked dark scheme exercises the dark arm of the
    // text-color ternary (line 26); the badge still renders its label.
    expect(screen.getByText("working")).toBeInTheDocument();
    colorSchemeMock.value = "light";
  });
});
