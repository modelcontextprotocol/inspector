import path from "node:path";
import pino from "pino";
import type { Logger } from "pino";

let tuiLoggerInstance: Logger | undefined;

/**
 * TUI file logger for auth and InspectorClient events.
 * Writes to ~/.mcp-inspector/auth.log so TUI console output is not corrupted.
 * Lazy-initialized so --help and other early exits never open the log stream.
 */
export function getTuiLogger(): Logger {
  if (!tuiLoggerInstance) {
    const logDir =
      process.env.MCP_INSPECTOR_LOG_DIR ??
      path.join(
        process.env.HOME || process.env.USERPROFILE || ".",
        ".mcp-inspector",
      );
    const logPath = path.join(logDir, "auth.log");
    tuiLoggerInstance = pino(
      {
        name: "mcp-inspector-tui",
        level: process.env.LOG_LEVEL ?? "info",
      },
      pino.destination({ dest: logPath, append: true, mkdir: true }),
    );
  }
  return tuiLoggerInstance;
}
