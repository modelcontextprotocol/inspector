import path from "node:path";
import pino from "pino";

const logDir =
  process.env.MCP_INSPECTOR_LOG_DIR ??
  path.join(
    process.env.HOME || process.env.USERPROFILE || ".",
    ".mcp-inspector",
  );
const logPath = path.join(logDir, "auth.log");

/**
 * TUI file logger for auth and InspectorClient events.
 * Writes to ~/.mcp-inspector/auth.log so TUI console output is not corrupted.
 * The app controls logger creation and configuration.
 */
export const tuiLogger = pino(
  {
    name: "mcp-inspector-tui",
    level: process.env.LOG_LEVEL ?? "info",
  },
  pino.destination({ dest: logPath, append: true, mkdir: true }),
);
