import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ScreenStage } from "./ScreenStage";

describe("ScreenStage", () => {
  it("renders its screen when active", () => {
    renderWithMantine(
      <ScreenStage active>
        <div>active screen</div>
      </ScreenStage>,
    );
    expect(screen.getByText("active screen")).toBeInTheDocument();
  });

  it("renders nothing when inactive (outgoing screen unmounts)", () => {
    renderWithMantine(
      <ScreenStage active={false}>
        <div>inactive screen</div>
      </ScreenStage>,
    );
    expect(screen.queryByText("inactive screen")).toBeNull();
  });

  it("still renders its screen in the fill variant", () => {
    renderWithMantine(
      <ScreenStage active fill>
        <div>filled screen</div>
      </ScreenStage>,
    );
    expect(screen.getByText("filled screen")).toBeInTheDocument();
  });
});
