import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import userEvent from "@testing-library/user-event";
import { InlineError } from "./InlineError";

describe("InlineError", () => {
  it("renders the error message", () => {
    renderWithMantine(<InlineError error={{ message: "boom" }} />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders retry attempt count without max", () => {
    renderWithMantine(
      <InlineError error={{ message: "boom" }} retryCount={2} />,
    );
    expect(screen.getByText("Retry attempt 2")).toBeInTheDocument();
  });

  it("renders retry attempt count with max", () => {
    renderWithMantine(
      <InlineError error={{ message: "boom" }} retryCount={2} maxRetries={5} />,
    );
    expect(screen.getByText("Retry attempt 2 of 5")).toBeInTheDocument();
  });

  it("does not show expand button when there is nothing to expand", () => {
    renderWithMantine(<InlineError error={{ message: "boom" }} />);
    expect(screen.queryByText("Show more")).not.toBeInTheDocument();
  });

  it("expands details on click", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <InlineError error={{ message: "boom", data: "extra" }} />,
    );
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();
    expect(screen.getByText("extra")).toBeInTheDocument();
  });

  it("formats non-string data as JSON", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <InlineError error={{ message: "boom", data: { code: 42 } }} />,
    );
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(/"code": 42/)).toBeInTheDocument();
  });

  it("renders a doc link button when docLink is provided and expanded", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <InlineError
        error={{ message: "boom" }}
        docLink="https://example.com/docs"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Show more" }));
    const link = screen.getByRole("link", { name: /Troubleshooting/ });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
  });

  describe("autoDismissMs", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("stays visible until autoDismissMs elapses", () => {
      renderWithMantine(
        <InlineError error={{ message: "boom" }} autoDismissMs={5000} />,
      );
      expect(screen.getByText("boom")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(4999);
      });
      // Still visible just before the deadline.
      expect(screen.getByText("boom")).toBeInTheDocument();
    });

    it("triggers the exit transition after autoDismissMs", () => {
      renderWithMantine(
        <InlineError error={{ message: "boom" }} autoDismissMs={1000} />,
      );
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      // Mantine's slide-up transition unmounts after duration+exitDuration.
      // Advance past it to give the Transition time to finish its exit.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText("boom")).not.toBeInTheDocument();
    });

    it("re-arms the timer when the error message changes", () => {
      const { rerender } = renderWithMantine(
        <InlineError error={{ message: "first" }} autoDismissMs={1000} />,
      );
      act(() => {
        vi.advanceTimersByTime(900);
      });
      rerender(
        <InlineError error={{ message: "second" }} autoDismissMs={1000} />,
      );
      // The 900ms already elapsed shouldn't count against the new message.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getByText("second")).toBeInTheDocument();
    });

    it("does not auto-dismiss when autoDismissMs is undefined", () => {
      renderWithMantine(<InlineError error={{ message: "boom" }} />);
      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
  });
});
