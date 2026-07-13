import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { CategoryBadge } from "./CategoryBadge";

describe("CategoryBadge", () => {
  it("renders the transport category", () => {
    renderWithMantine(<CategoryBadge category="transport" />);
    expect(screen.getByText("transport")).toBeInTheDocument();
  });

  it("renders the auth category", () => {
    renderWithMantine(<CategoryBadge category="auth" />);
    expect(screen.getByText("auth")).toBeInTheDocument();
  });
});
