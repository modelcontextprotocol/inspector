import { Badge, useComputedColorScheme } from "@mantine/core";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";

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
  const colorScheme = useComputedColorScheme();
  const textColor = colorScheme === "dark" ? "black" : "white";
  const fw = boldLevels.has(level) ? 500 : undefined;

  return (
    <Badge color={levelColor[level]} variant="filled" fw={fw} c={textColor}>
      {level}
    </Badge>
  );
}
