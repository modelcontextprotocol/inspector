import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { PendingClientRequests } from "./PendingClientRequests";

describe("PendingClientRequests", () => {
  it("renders the count in the title", () => {
    renderWithMantine(
      <PendingClientRequests count={3}>
        <div>child</div>
      </PendingClientRequests>,
    );
    expect(screen.getByText("Pending Client Requests (3)")).toBeInTheDocument();
  });

  it("renders the children", () => {
    renderWithMantine(
      <PendingClientRequests count={1}>
        <div data-testid="child">child node</div>
      </PendingClientRequests>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
