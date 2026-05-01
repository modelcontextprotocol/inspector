import { describe, it, expect } from "vitest";
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
});
