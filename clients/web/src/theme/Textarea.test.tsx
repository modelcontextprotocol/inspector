import { describe, it, expect } from "vitest";
import { Textarea } from "@mantine/core";
import { renderWithMantine, screen } from "../test/renderWithMantine";

// `ThemeTextarea` adds the `code` variant for JSON input (#2911). Only the
// input turns monospace; every other textarea keeps the app's font.
describe("ThemeTextarea variants", () => {
  it("sets a monospace input for the code variant only", () => {
    renderWithMantine(
      <>
        <Textarea aria-label="plain" />
        <Textarea aria-label="code" variant="code" />
      </>,
    );
    expect(screen.getByLabelText("code").style.fontFamily).toBe(
      "var(--mantine-font-family-monospace)",
    );
    expect(screen.getByLabelText("plain").style.fontFamily).toBe("");
  });
});
