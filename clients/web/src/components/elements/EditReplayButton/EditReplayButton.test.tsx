import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { EditReplayButton } from "./EditReplayButton";

describe("EditReplayButton", () => {
  it("is named for assistive tech", () => {
    renderWithMantine(<EditReplayButton onClick={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Edit and replay" }),
    ).toBeInTheDocument();
  });

  it("invokes onClick when activated", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithMantine(<EditReplayButton onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "Edit and replay" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
