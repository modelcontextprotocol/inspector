import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { OutputValidationModal } from "./OutputValidationModal";

const MESSAGE =
  "data/samples/0 must NOT have additional properties, data/samples/1 must NOT have additional properties";

describe("OutputValidationModal", () => {
  it("renders the tool name and the full validation message in a read-only field", () => {
    renderWithMantine(
      <OutputValidationModal
        opened
        onClose={vi.fn()}
        toolName="open_pattern_editor"
        message={MESSAGE}
      />,
    );
    expect(screen.getByText("Output schema validation")).toBeInTheDocument();
    expect(screen.getByText(/open_pattern_editor/)).toBeInTheDocument();
    const details = screen.getByLabelText(
      "Validation details",
    ) as HTMLTextAreaElement;
    expect(details.value).toBe(MESSAGE);
    expect(details.readOnly).toBe(true);
  });

  it("falls back to a generic message when no tool name is provided", () => {
    renderWithMantine(
      <OutputValidationModal opened onClose={vi.fn()} message={MESSAGE} />,
    );
    expect(
      screen.getByText(/does not match the declared outputSchema/i),
    ).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    renderWithMantine(
      <OutputValidationModal opened onClose={onClose} message={MESSAGE} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing visible when closed", () => {
    renderWithMantine(
      <OutputValidationModal
        opened={false}
        onClose={vi.fn()}
        message={MESSAGE}
      />,
    );
    expect(
      screen.queryByText("Output schema validation"),
    ).not.toBeInTheDocument();
  });
});
