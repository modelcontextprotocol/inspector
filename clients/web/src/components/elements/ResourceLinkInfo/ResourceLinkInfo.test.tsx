import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ResourceLinkInfo } from "./ResourceLinkInfo";

const URI = "file:///docs/readme.md";

describe("ResourceLinkInfo", () => {
  it("renders uri, name, description, and mimeType", () => {
    renderWithMantine(
      <ResourceLinkInfo
        uri={URI}
        name="Readme"
        description="The project readme"
        mimeType="text/markdown"
      />,
    );
    expect(screen.getByText(URI)).toBeInTheDocument();
    expect(screen.getByText("Readme")).toBeInTheDocument();
    expect(screen.getByText("The project readme")).toBeInTheDocument();
    expect(screen.getByText("text/markdown")).toBeInTheDocument();
  });

  it("renders only the uri when optional fields are absent", () => {
    renderWithMantine(<ResourceLinkInfo uri={URI} />);
    expect(screen.getByText(URI)).toBeInTheDocument();
    expect(screen.queryByText("text/markdown")).not.toBeInTheDocument();
  });

  it("renders the action slot when provided", () => {
    renderWithMantine(
      <ResourceLinkInfo uri={URI} action={<span>chevron</span>} />,
    );
    expect(screen.getByText("chevron")).toBeInTheDocument();
  });
});
