import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithMantine } from "../../../test/renderWithMantine";
import { McpErrorBadge } from "./McpErrorBadge";

describe("McpErrorBadge", () => {
  it("renders the code and spec name", () => {
    renderWithMantine(<McpErrorBadge code={-32020} name="HeaderMismatch" />);
    expect(screen.getByText("-32020 HeaderMismatch")).toBeInTheDocument();
  });

  it("wraps the badge in a tooltip when a description is provided", () => {
    renderWithMantine(
      <McpErrorBadge
        code={-32022}
        name="UnsupportedProtocolVersion"
        description="The requested protocol version is not supported."
      />,
    );
    // The badge renders inside the tooltip target; the label is aria-described.
    expect(
      screen.getByText("-32022 UnsupportedProtocolVersion"),
    ).toBeInTheDocument();
  });

  it("falls back to red for an unmapped code", () => {
    renderWithMantine(<McpErrorBadge code={-32000} name="ServerError" />);
    expect(screen.getByText("-32000 ServerError")).toBeInTheDocument();
  });
});
