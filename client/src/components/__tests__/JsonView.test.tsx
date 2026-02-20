import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect } from "@jest/globals";
import JsonView from "../JsonView";

describe("JsonView", () => {
  it("should have padding to prevent copy button overlap", () => {
    const longText =
      "This is a very long text that would normally flow under the copy button without proper padding applied to the content area";

    const { container } = render(
      <JsonView data={longText} withCopyButton={true} />,
    );

    // Check that the content div has right padding
    const contentDiv = container.querySelector(".font-mono");
    expect(contentDiv).toHaveClass("pr-12");
  });

  it("should render without copy button when withCopyButton is false", () => {
    render(<JsonView data="test" withCopyButton={false} />);

    // Copy button should not be present
    const copyButton = screen.queryByRole("button");
    expect(copyButton).not.toBeInTheDocument();
  });
});
