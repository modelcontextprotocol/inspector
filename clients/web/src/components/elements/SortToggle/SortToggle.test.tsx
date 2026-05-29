import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { SortToggle } from "./SortToggle";

describe("SortToggle", () => {
  it("renders a button with the default aria-label", () => {
    renderWithMantine(<SortToggle value="newest-first" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Sort direction" }),
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
    expect(screen.getByRole("button", { name: "Logs sort" })).toBeInTheDocument();
  });

  it("flips to oldest-first when clicked while newest-first", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithMantine(<SortToggle value="newest-first" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Sort direction" }));
    expect(onChange).toHaveBeenCalledWith("oldest-first");
  });

  it("flips to newest-first when clicked while oldest-first", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithMantine(<SortToggle value="oldest-first" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Sort direction" }));
    expect(onChange).toHaveBeenCalledWith("newest-first");
  });

  it("renders the subtle variant as an ActionIcon (still a button)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithMantine(
      <SortToggle
        value="newest-first"
        variant="subtle"
        onChange={onChange}
      />,
    );
    const btn = screen.getByRole("button", { name: "Sort direction" });
    await user.click(btn);
    expect(onChange).toHaveBeenCalledWith("oldest-first");
  });
});
