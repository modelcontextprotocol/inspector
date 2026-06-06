import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { UrlElicitationErrorModal } from "./UrlElicitationErrorModal";

const DETAILS = JSON.stringify(
  {
    code: -32042,
    message: "This request requires browser-based authorization.",
    data: {},
  },
  null,
  2,
);

describe("UrlElicitationErrorModal", () => {
  it("renders the tool name and the raw error body in a read-only field", () => {
    renderWithMantine(
      <UrlElicitationErrorModal
        opened
        onClose={vi.fn()}
        toolName="trigger-url-elicitation"
        details={DETAILS}
      />,
    );
    expect(screen.getByText("URL elicitation required")).toBeInTheDocument();
    expect(screen.getByText(/trigger-url-elicitation/)).toBeInTheDocument();
    const details = screen.getByLabelText(
      "Error details",
    ) as HTMLTextAreaElement;
    expect(details.value).toBe(DETAILS);
    expect(details.readOnly).toBe(true);
  });

  it("falls back to a generic message when no tool name is provided", () => {
    renderWithMantine(
      <UrlElicitationErrorModal opened onClose={vi.fn()} details={DETAILS} />,
    );
    expect(screen.getByText(/no required elicitations/i)).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    renderWithMantine(
      <UrlElicitationErrorModal opened onClose={onClose} details={DETAILS} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing visible when closed", () => {
    renderWithMantine(
      <UrlElicitationErrorModal
        opened={false}
        onClose={vi.fn()}
        details={DETAILS}
      />,
    );
    expect(
      screen.queryByText("URL elicitation required"),
    ).not.toBeInTheDocument();
  });
});
