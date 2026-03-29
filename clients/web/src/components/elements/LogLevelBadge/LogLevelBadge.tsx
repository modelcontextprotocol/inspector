import { Badge, useComputedColorScheme } from "@mantine/core";
import type { LogLevel } from "../LogEntry/LogEntry";

export interface LogLevelBadgeProps {
  level: LogLevel;
}

const levelColor: Record<LogLevel, string> = {
  debug: "gray",
  info: "blue",
  notice: "teal",
  warning: "yellow",
  error: "red",
  critical: "red",
  alert: "red",
  emergency: "red",
};

const boldLevels: Set<LogLevel> = new Set(["alert", "emergency"]);

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
