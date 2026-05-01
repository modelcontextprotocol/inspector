import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { TransportBadge } from "./TransportBadge";

describe("TransportBadge", () => {
  it("renders STDIO label", () => {
    renderWithMantine(<TransportBadge transport="stdio" />);
    expect(screen.getByText("STDIO")).toBeInTheDocument();
  });

  it("renders HTTP label for sse transport", () => {
    renderWithMantine(<TransportBadge transport="sse" />);
    expect(screen.getByText("HTTP")).toBeInTheDocument();
  });

  it("renders HTTP label for streamable-http transport", () => {
    renderWithMantine(<TransportBadge transport="streamable-http" />);
    expect(screen.getByText("HTTP")).toBeInTheDocument();
  });
});
