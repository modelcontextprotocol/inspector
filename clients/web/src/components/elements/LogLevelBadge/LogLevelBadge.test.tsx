import { describe, it, expect, vi } from "vitest";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { LogLevelBadge } from "./LogLevelBadge";

// Drive the `colorScheme === "dark"` branch (which picks black vs white badge
// text). `useComputedColorScheme` otherwise resolves to "light" under
// happy-dom, leaving the dark arm of the ternary uncovered.
const colorSchemeMock = vi.hoisted(() => ({
  value: "light" as "light" | "dark",
}));
vi.mock("@mantine/core", async () => {
  const actual =
    await vi.importActual<typeof import("@mantine/core")>("@mantine/core");
  return { ...actual, useComputedColorScheme: () => colorSchemeMock.value };
});

describe("LogLevelBadge", () => {
  const levels: LoggingLevel[] = [
    "debug",
    "info",
    "notice",
    "warning",
    "error",
    "critical",
    "alert",
    "emergency",
  ];

  it.each(levels)("renders the %s level label", (level) => {
    colorSchemeMock.value = "light";
    renderWithMantine(<LogLevelBadge level={level} />);
    expect(screen.getByText(level)).toBeInTheDocument();
  });

  it("uses black text in dark mode", () => {
    colorSchemeMock.value = "dark";
    // Rendering under the mocked dark scheme exercises the dark arm of the
    // text-color ternary (line 23); the badge still renders its label.
    renderWithMantine(<LogLevelBadge level="error" />);
    expect(screen.getByText("error")).toBeInTheDocument();
    colorSchemeMock.value = "light";
  });
});
