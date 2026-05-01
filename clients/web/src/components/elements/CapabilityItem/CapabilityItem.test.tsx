import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { CapabilityItem } from "./CapabilityItem";

describe("CapabilityItem", () => {
  it("renders the supported check mark", () => {
    renderWithMantine(<CapabilityItem capability="tools" supported />);
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
  });

  it("renders the unsupported cross mark", () => {
    renderWithMantine(
      <CapabilityItem capability="prompts" supported={false} />,
    );
    expect(screen.getByText("✗")).toBeInTheDocument();
    expect(screen.getByText("Prompts")).toBeInTheDocument();
  });

  it("appends the count when provided", () => {
    renderWithMantine(
      <CapabilityItem capability="resources" supported count={5} />,
    );
    expect(screen.getByText("Resources (5)")).toBeInTheDocument();
  });

  it("falls back to capability key for unknown labels", () => {
    renderWithMantine(
      <CapabilityItem capability={"custom" as never} supported />,
    );
    expect(screen.getByText("custom")).toBeInTheDocument();
  });
});
