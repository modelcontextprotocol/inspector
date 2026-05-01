import { describe, it, expect } from "vitest";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { LogLevelBadge } from "./LogLevelBadge";

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
    renderWithMantine(<LogLevelBadge level={level} />);
    expect(screen.getByText(level)).toBeInTheDocument();
  });
});
