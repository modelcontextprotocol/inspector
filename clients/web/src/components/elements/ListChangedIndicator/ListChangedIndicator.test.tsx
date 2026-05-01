import { describe, it, expect, vi } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import userEvent from "@testing-library/user-event";
import { ListChangedIndicator } from "./ListChangedIndicator";

describe("ListChangedIndicator", () => {
  it("renders nothing when not visible", () => {
    renderWithMantine(
      <ListChangedIndicator visible={false} onRefresh={() => {}} />,
    );
    expect(screen.queryByText("List updated")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
  });

  it("renders the message and refresh button when visible", () => {
    renderWithMantine(<ListChangedIndicator visible onRefresh={() => {}} />);
    expect(screen.getByText("List updated")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("invokes onRefresh on click", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    renderWithMantine(<ListChangedIndicator visible onRefresh={onRefresh} />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
