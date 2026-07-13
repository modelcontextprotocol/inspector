import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MethodBadge } from "./MethodBadge";

describe("MethodBadge", () => {
  it("renders the method name", () => {
    renderWithMantine(<MethodBadge method="tools/list" />);
    expect(screen.getByText("tools/list")).toBeInTheDocument();
  });

  it("renders an arbitrary method string verbatim", () => {
    renderWithMantine(<MethodBadge method="notifications/message" />);
    expect(screen.getByText("notifications/message")).toBeInTheDocument();
  });
});
