import { describe, it, expect } from "vitest";
import type { TaskStatus } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { TaskStatusBadge } from "./TaskStatusBadge";

describe("TaskStatusBadge", () => {
  const cases: Array<[TaskStatus, string]> = [
    ["working", "working"],
    ["input_required", "input required"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
  ];

  it.each(cases)("renders the label for %s", (status, label) => {
    renderWithMantine(<TaskStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
