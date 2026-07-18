import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { EraBadge } from "./EraBadge";
import { formatEra, isModernEra } from "./eraUtils";

describe("isModernEra / formatEra", () => {
  it("treats only 'modern' as the modern era", () => {
    expect(isModernEra("modern")).toBe(true);
    expect(isModernEra("legacy")).toBe(false);
    expect(isModernEra(undefined)).toBe(false);
  });

  it("labels the era", () => {
    expect(formatEra("modern")).toBe("Modern");
    expect(formatEra("legacy")).toBe("Legacy");
    expect(formatEra(undefined)).toBe("Legacy");
  });
});

describe("EraBadge", () => {
  it("renders Modern for a modern connection", () => {
    renderWithMantine(<EraBadge era="modern" />);
    expect(screen.getByText("Modern")).toBeInTheDocument();
  });

  it("renders Legacy for a legacy connection", () => {
    renderWithMantine(<EraBadge era="legacy" />);
    expect(screen.getByText("Legacy")).toBeInTheDocument();
  });

  it("renders Legacy when the era is undefined", () => {
    renderWithMantine(<EraBadge era={undefined} />);
    expect(screen.getByText("Legacy")).toBeInTheDocument();
  });
});
