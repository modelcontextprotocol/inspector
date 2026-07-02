import { describe, it, expect, vi } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import userEvent from "@testing-library/user-event";
import { ReAuthBanner } from "./ReAuthBanner";

describe("ReAuthBanner", () => {
  it("renders message and action buttons", async () => {
    const user = userEvent.setup();
    const onReauthenticate = vi.fn();
    const onDismiss = vi.fn();

    renderWithMantine(
      <ReAuthBanner
        message="Sign in again to continue."
        onReauthenticate={onReauthenticate}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("Re-authentication required")).toBeInTheDocument();
    expect(screen.getByText("Sign in again to continue.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Re-authenticate" }));
    expect(onReauthenticate).toHaveBeenCalledOnce();

    const [, closeButton] = screen.getAllByRole("button");
    await user.click(closeButton);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
