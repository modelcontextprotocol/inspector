import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { CopyrightBadge, COPYRIGHT_NOTICE } from "./CopyrightBadge";

describe("CopyrightBadge", () => {
  it("renders the project copyright notice", () => {
    renderWithMantine(<CopyrightBadge />);
    expect(screen.getByText(COPYRIGHT_NOTICE)).toBeInTheDocument();
  });

  it("names the Model Context Protocol and LF Projects", () => {
    renderWithMantine(<CopyrightBadge />);
    expect(
      screen.getByText(/Model Context Protocol.*Series of LF Projects, LLC\./),
    ).toBeInTheDocument();
  });
});
