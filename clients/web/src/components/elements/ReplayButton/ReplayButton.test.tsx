import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ReplayButton } from "./ReplayButton";

describe("ReplayButton", () => {
  it("renders a labelled replay button", () => {
    renderWithMantine(<ReplayButton onReplay={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument();
  });

  it("invokes onReplay when clicked", async () => {
    const user = userEvent.setup();
    const onReplay = vi.fn();
    renderWithMantine(<ReplayButton onReplay={onReplay} />);
    await user.click(screen.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalledTimes(1);
  });
});
