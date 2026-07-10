import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { VersionBadge } from "./VersionBadge";

describe("VersionBadge", () => {
  it("renders the version with a `v` prefix and an accessible label", () => {
    renderWithMantine(<VersionBadge version="2.0.0" />);
    const badge = screen.getByText("v2.0.0");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("aria-label", "Inspector version 2.0.0");
  });

  it("renders nothing when the version is undefined", () => {
    renderWithMantine(<VersionBadge version={undefined} />);
    expect(screen.queryByText(/^v/)).toBeNull();
  });

  it("renders nothing when the version is an empty string", () => {
    renderWithMantine(<VersionBadge version="" />);
    expect(screen.queryByText(/^v/)).toBeNull();
  });
});
