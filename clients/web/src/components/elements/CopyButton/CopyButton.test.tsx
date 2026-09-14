import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import userEvent from "@testing-library/user-event";
import { CopyButton } from "./CopyButton";

describe("CopyButton", () => {
  it("renders the copy glyph by default", () => {
    renderWithMantine(<CopyButton value="hello" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.getByText("⎘")).toBeInTheDocument();
  });

  it("names itself 'Copy' with no label, and qualifies the name when given one", () => {
    const { unmount } = renderWithMantine(<CopyButton value="hello" />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    unmount();

    renderWithMantine(<CopyButton value="hello" label="ID Token" />);
    expect(
      screen.getByRole("button", { name: "Copy ID Token" }),
    ).toBeInTheDocument();
  });

  it("triggers a click without throwing when clipboard is unavailable", async () => {
    const user = userEvent.setup();
    renderWithMantine(<CopyButton value="hello" />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
