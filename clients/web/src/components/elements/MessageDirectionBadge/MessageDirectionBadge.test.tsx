import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MessageDirectionBadge } from "./MessageDirectionBadge";

describe("MessageDirectionBadge", () => {
  it("renders client → server for outgoing", () => {
    renderWithMantine(<MessageDirectionBadge direction="outgoing" />);
    expect(screen.getByText("client → server")).toBeInTheDocument();
  });

  it("renders client ← server for incoming", () => {
    renderWithMantine(<MessageDirectionBadge direction="incoming" />);
    expect(screen.getByText("client ← server")).toBeInTheDocument();
  });
});
