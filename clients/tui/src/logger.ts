import type { Logger } from "pino";
import {
  silentLogger,
  createFileLogger,
} from "@modelcontextprotocol/inspector-core/logging/node";

/**
 * TUI logger (InspectorClient events, auth, etc.).
 * File logger when MCP_LOG_FILE is set, else silentLogger.
 */
export let tuiLogger: Logger = silentLogger;

/**
 * If MCP_LOG_FILE is set, creates a file logger (awaits destination ready);
 * otherwise uses silentLogger. Call at the start of runTui() before any work
 * that might call process.exit().
 */
export async function initTuiLogger(): Promise<void> {
  if (process.env.MCP_LOG_FILE) {
    tuiLogger = await createFileLogger({
      dest: process.env.MCP_LOG_FILE,
      append: true,
      mkdir: true,
      level: "info",
      name: "mcp-inspector-tui",
    });
  } else {
    tuiLogger = silentLogger;
  }
}
