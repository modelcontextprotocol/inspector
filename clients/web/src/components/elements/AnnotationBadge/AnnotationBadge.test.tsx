import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { AnnotationBadge } from "./AnnotationBadge";

describe("AnnotationBadge", () => {
  it("renders audience labels", () => {
    renderWithMantine(<AnnotationBadge facet="audience" value={["user"]} />);
    expect(screen.getByText("audience: user")).toBeInTheDocument();
  });

  it("joins multiple audience entries", () => {
    renderWithMantine(
      <AnnotationBadge facet="audience" value={["user", "assistant"]} />,
    );
    expect(screen.getByText("audience: user, assistant")).toBeInTheDocument();
  });

  it.each([
    [0.9, "priority: high"],
    [0.5, "priority: medium"],
    [0.2, "priority: low"],
  ])("maps priority %s to %s", (value, label) => {
    renderWithMantine(<AnnotationBadge facet="priority" value={value} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each([
    ["readOnlyHint", "read-only"],
    ["destructiveHint", "destructive"],
    ["idempotentHint", "idempotent"],
    ["openWorldHint", "open-world"],
    ["longRunHint", "long-running"],
  ] as const)("renders hint label for %s", (facet, label) => {
    renderWithMantine(<AnnotationBadge facet={facet} value={true} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
