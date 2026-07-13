import { Badge } from "@mantine/core";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { filledBadgeColor } from "../filledBadgeColor";

export interface LogLevelBadgeProps {
  level: LoggingLevel;
}

const levelColor: Record<LoggingLevel, string> = {
  debug: "gray",
  info: "blue",
  notice: "teal",
  warning: "yellow",
  error: "red",
  critical: "red",
  alert: "red",
  emergency: "red",
};

const boldLevels: Set<LoggingLevel> = new Set(["alert", "emergency"]);

export function LogLevelBadge({ level }: LogLevelBadgeProps) {
  const fw = boldLevels.has(level) ? 500 : undefined;

  // `autoContrast` keeps the label legible (WCAG AA) on both the light-mode
  // fills and the darker dark-mode `-filled` shades — see AnnotationBadge.
  return (
    <Badge
      color={filledBadgeColor(levelColor[level])}
      variant="filled"
      fw={fw}
      autoContrast
    >
      {level}
    </Badge>
  );
}
