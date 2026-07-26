import { describe, it, expect } from "vitest";
import { Paper } from "@mantine/core";
import { renderWithMantine } from "../test/renderWithMantine";

// The theme's ThemePaper.extend is applied transitively when components render a
// Paper, but no single component exercises every variant — the `code`,
// `contained`, and `panel` branches of its classNames/styles callbacks were
// uncovered. Render each variant (plus the default) under the project theme so
// both callbacks run for every branch. See #1787 (theme/** brought under the
// coverage gate).

const VARIANTS = ["code", "contained", "panel"] as const;

describe("ThemePaper variants", () => {
  it("renders the default variant (no variant-specific styles)", () => {
    const { getByText } = renderWithMantine(<Paper>default</Paper>);
    expect(getByText("default")).toBeTruthy();
  });

  for (const variant of VARIANTS) {
    it(`renders the "${variant}" variant`, () => {
      const { getByText } = renderWithMantine(
        <Paper variant={variant}>{variant}</Paper>,
      );
      expect(getByText(variant)).toBeTruthy();
    });
  }

  it('applies the paper-code class only to the "code" variant', () => {
    const { getByText } = renderWithMantine(<Paper variant="code">c</Paper>);
    // classNames returns { root: "paper-code" } for the code variant.
    expect(getByText("c").className).toContain("paper-code");
  });
});
