import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { SortToggle } from "./SortToggle";

describe("SortToggle", () => {
  it("renders the current value as the selected option", () => {
    renderWithMantine(<SortToggle value="newest-first" onChange={() => {}} />);
    expect(screen.getByDisplayValue("Sort: Newest First")).toBeInTheDocument();
  });

  it("renders 'Oldest First' when value is oldest-first", () => {
    renderWithMantine(<SortToggle value="oldest-first" onChange={() => {}} />);
    expect(screen.getByDisplayValue("Sort: Oldest First")).toBeInTheDocument();
  });

  it("uses the default aria-label", () => {
    renderWithMantine(<SortToggle value="newest-first" onChange={() => {}} />);
    expect(
      screen.getByRole("textbox", { name: "Sort direction" }),
    ).toBeInTheDocument();
  });

  it("honors a custom aria-label", () => {
    renderWithMantine(
      <SortToggle
        value="newest-first"
        onChange={() => {}}
        aria-label="Logs sort"
      />,
    );
    expect(
      screen.getByRole("textbox", { name: "Logs sort" }),
    ).toBeInTheDocument();
  });

  it("invokes onChange with the new direction when the user picks another option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithMantine(<SortToggle value="newest-first" onChange={onChange} />);
    await user.click(screen.getByRole("textbox", { name: "Sort direction" }));
    await user.click(await screen.findByText("Sort: Oldest First"));
    expect(onChange).toHaveBeenCalledWith("oldest-first");
  });
});
