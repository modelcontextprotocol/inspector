import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { getAceText } from "../../../test/aceEditor";
import { StructuredOutputPanel } from "./StructuredOutputPanel";

// The real CodeHighlight dynamic-imports the Prism runtime and each grammar
// (its own behavior is covered in CodeHighlight.test.tsx). Stub it so these
// tests assert on the JSON handed to it, synchronously.
vi.mock("../../elements/CodeHighlight/CodeHighlight", () => ({
  CodeHighlight: ({ language, code }: { language: string; code: string }) => (
    <pre data-testid="code-highlight" data-language={language}>
      {code}
    </pre>
  ),
}));

const structuredContent = {
  items: [
    { id: 1, name: "Item A", tags: ["foo", "bar"] },
    { id: 2, name: "Item B", tags: ["baz"] },
  ],
  total: 2,
};

describe("StructuredOutputPanel", () => {
  it("renders a labeled section with the payload as pretty-printed JSON", () => {
    renderWithMantine(
      <StructuredOutputPanel structuredContent={structuredContent} />,
    );
    expect(
      screen.getByRole("heading", { name: "Structured Output" }),
    ).toBeInTheDocument();
    // Read through the editor rather than the DOM: Ace virtualizes its lines,
    // so only what a viewport would show is in the document — and happy-dom has
    // no layout to give it one.
    const shown = getAceText();
    expect(shown).toContain('"total": 2');
    // Nested values are inspectable field by field, not summarized away.
    expect(shown).toContain('"name": "Item A"');
    expect(shown).toContain('"tags"');
  });

  it("starts expanded by default", () => {
    renderWithMantine(
      <StructuredOutputPanel structuredContent={structuredContent} />,
    );
    expect(
      screen.getByRole("button", { name: "Collapse structured output" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("starts collapsed when defaultExpanded is false", () => {
    renderWithMantine(
      <StructuredOutputPanel
        structuredContent={structuredContent}
        defaultExpanded={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Expand structured output" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles between expanded and collapsed", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <StructuredOutputPanel structuredContent={structuredContent} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Collapse structured output" }),
    );
    const toggle = screen.getByRole("button", {
      name: "Expand structured output",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(
      screen.getByRole("button", { name: "Collapse structured output" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("renders an empty structured payload rather than nothing", () => {
    renderWithMantine(<StructuredOutputPanel structuredContent={{}} />);
    expect(
      screen.getByRole("heading", { name: "Structured Output" }),
    ).toBeInTheDocument();
    expect(getAceText()).toBe("{}");
  });
});

// The `data-testid` the headless tab smoke waits on (#2148). Asserting the
// section by its heading copy would make the smoke fail on a rewording, so the
// smoke keys off this attribute — pinned here so a rename fails loudly.
describe("automation contract (#2148)", () => {
  it("exposes a stable data-testid on the section", () => {
    renderWithMantine(
      <StructuredOutputPanel structuredContent={structuredContent} />,
    );
    expect(screen.getByTestId("structured-output")).toBeInTheDocument();
  });
});
