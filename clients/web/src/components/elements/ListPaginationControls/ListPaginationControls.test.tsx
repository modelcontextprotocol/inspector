import { describe, it, expect, vi } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import userEvent from "@testing-library/user-event";
import { ListPaginationControls } from "./ListPaginationControls";

const baseProps = {
  paginated: false,
  onPaginatedChange: () => {},
  canLoadMore: false,
  loadedPages: 0,
  onLoadMore: () => {},
};

describe("ListPaginationControls", () => {
  it("renders only the 'Paginated' switch in all-pages mode (no load-more)", () => {
    renderWithMantine(<ListPaginationControls {...baseProps} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("Paginated")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load next page" }),
    ).not.toBeInTheDocument();
  });

  it("toggles paginated mode via the switch", async () => {
    const user = userEvent.setup();
    const onPaginatedChange = vi.fn();
    renderWithMantine(
      <ListPaginationControls
        {...baseProps}
        onPaginatedChange={onPaginatedChange}
      />,
    );
    await user.click(screen.getByRole("switch"));
    expect(onPaginatedChange).toHaveBeenCalledWith(true);
  });

  it("shows the load-more button and page count in paginated mode", () => {
    renderWithMantine(
      <ListPaginationControls
        {...baseProps}
        paginated
        canLoadMore
        loadedPages={2}
      />,
    );
    expect(screen.getByRole("switch")).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Load next page" }),
    ).toBeEnabled();
    expect(screen.getByText("2 pages loaded")).toBeInTheDocument();
  });

  it("uses the singular label for one page (while more remain)", () => {
    renderWithMantine(
      <ListPaginationControls
        {...baseProps}
        paginated
        canLoadMore
        loadedPages={1}
      />,
    );
    expect(screen.getByText("1 page loaded")).toBeInTheDocument();
  });

  it("hides the whole control when the list is a single page", () => {
    // Paginated mode, page 1 loaded, no next cursor → nothing to paginate.
    renderWithMantine(
      <ListPaginationControls
        {...baseProps}
        paginated
        canLoadMore={false}
        loadedPages={1}
      />,
    );
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load next page" }),
    ).not.toBeInTheDocument();
  });

  it("still shows the switch while a paginated load is pending (0 pages)", () => {
    // loadedPages 0 (page 1 not yet loaded) must not trip the paginated hide.
    renderWithMantine(
      <ListPaginationControls
        {...baseProps}
        paginated
        canLoadMore={false}
        loadedPages={0}
      />,
    );
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("marks the end when there are multiple pages and no more to load", () => {
    renderWithMantine(
      <ListPaginationControls
        {...baseProps}
        paginated
        canLoadMore={false}
        loadedPages={3}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Load next page" }),
    ).toBeDisabled();
    expect(screen.getByText("3 pages loaded · end")).toBeInTheDocument();
  });

  it("invokes onLoadMore when the button is clicked", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    renderWithMantine(
      <ListPaginationControls
        {...baseProps}
        paginated
        canLoadMore
        loadedPages={1}
        onLoadMore={onLoadMore}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Load next page" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
