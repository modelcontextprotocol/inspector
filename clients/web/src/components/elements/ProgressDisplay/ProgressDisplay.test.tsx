import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ProgressDisplay } from "./ProgressDisplay";

describe("ProgressDisplay", () => {
  it("computes percentage from progress and total", () => {
    renderWithMantine(
      <ProgressDisplay params={{ progress: 25, total: 100 }} />,
    );
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("falls back to raw progress when total is missing", () => {
    renderWithMantine(<ProgressDisplay params={{ progress: 42 }} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("falls back to raw progress when total is zero", () => {
    renderWithMantine(<ProgressDisplay params={{ progress: 30, total: 0 }} />);
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it("renders the label when message is provided", () => {
    renderWithMantine(
      <ProgressDisplay
        params={{ progress: 50, total: 100, message: "Loading" }}
      />,
    );
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("renders elapsed when provided", () => {
    renderWithMantine(
      <ProgressDisplay params={{ progress: 1 }} elapsed="3s" />,
    );
    expect(screen.getByText("3s")).toBeInTheDocument();
  });

  it("renders the underlying progress bar", () => {
    renderWithMantine(
      <ProgressDisplay params={{ progress: 60, total: 100 }} />,
    );
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
