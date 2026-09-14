import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ListLoadError } from "./ListLoadError";

describe("ListLoadError", () => {
  it("renders nothing when there is no error", () => {
    renderWithMantine(<ListLoadError error={null} what="tools" />);
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
  });

  it("renders nothing when the error prop is omitted", () => {
    renderWithMantine(<ListLoadError what="tools" />);
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
  });

  it("names what failed to load and shows the reason verbatim", () => {
    // The exact text is the diagnostic — a validation failure names the JSON
    // path and what was expected, so it is rendered unabridged (#1953).
    const message = 'Invalid result for tools/list: [{"path":["ttlMs"]}]';
    renderWithMantine(
      <ListLoadError error={new Error(message)} what="tools" />,
    );

    expect(screen.getByText("Couldn't load tools")).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("uses the given noun so each list names itself", () => {
    renderWithMantine(<ListLoadError error={new Error("x")} what="prompts" />);
    expect(screen.getByText("Couldn't load prompts")).toBeInTheDocument();
  });

  it("invokes onRetry when Retry is clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithMantine(
      <ListLoadError error={new Error("x")} what="tools" onRetry={onRetry} />,
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits the retry affordance when no handler is given", () => {
    renderWithMantine(<ListLoadError error={new Error("x")} what="tools" />);
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });
});
