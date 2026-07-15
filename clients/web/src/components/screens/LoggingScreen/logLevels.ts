import type { LoggingLevel } from "@modelcontextprotocol/client";

// Default visible-level filter: every level on. Shared by LoggingScreen (its
// fallback when the parent hasn't set `visibleLevels`) and App, which seeds and
// resets the lifted filter state from it (#1417). Lives in its own module so
// the screen file only exports a component (react-refresh constraint).
export const ALL_LEVELS_VISIBLE: Record<LoggingLevel, boolean> = {
  debug: true,
  info: true,
  notice: true,
  warning: true,
  error: true,
  critical: true,
  alert: true,
  emergency: true,
};

export const NO_LEVELS_VISIBLE: Record<LoggingLevel, boolean> = {
  debug: false,
  info: false,
  notice: false,
  warning: false,
  error: false,
  critical: false,
  alert: false,
  emergency: false,
};
