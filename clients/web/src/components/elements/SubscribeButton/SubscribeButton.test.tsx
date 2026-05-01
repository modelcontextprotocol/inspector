import { describe, it, expect, vi } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import userEvent from "@testing-library/user-event";
import { SubscribeButton } from "./SubscribeButton";

describe("SubscribeButton", () => {
  it("renders 'Subscribe' when not subscribed", () => {
    renderWithMantine(
      <SubscribeButton subscribed={false} onToggle={() => {}} />,
    );
    expect(
      screen.getByRole("button", { name: "Subscribe" }),
    ).toBeInTheDocument();
  });

  it("renders 'Unsubscribe' when subscribed", () => {
    renderWithMantine(<SubscribeButton subscribed onToggle={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Unsubscribe" }),
    ).toBeInTheDocument();
  });

  it("invokes onToggle on click", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithMantine(
      <SubscribeButton subscribed={false} onToggle={onToggle} />,
    );
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
