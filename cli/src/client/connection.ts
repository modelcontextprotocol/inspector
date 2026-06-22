import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { LogEntry } from "../output.js";
import { McpResponse } from "./types.js";

export const validLogLevels = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
] as const;

export type LogLevel = (typeof validLogLevels)[number];

const logBuffer: LogEntry[] = [];

export function getCapturedLogs(): LogEntry[] {
  return [...logBuffer];
}

export function clearCapturedLogs(): void {
  logBuffer.length = 0;
}

export async function connect(
  client: Client,
  transport: Transport,
): Promise<void> {
  try {
    await client.connect(transport);

    client.setNotificationHandler(
      LoggingMessageNotificationSchema,
      (notification) => {
        logBuffer.push({
          level: notification.params.level,
          logger: notification.params.logger,
          message:
            typeof notification.params.data === "string"
              ? notification.params.data
              : JSON.stringify(notification.params.data),
          timestamp: new Date().toISOString(),
        });
      },
    );

    if (client.getServerCapabilities()?.logging) {
      // default logging level is undefined in the spec, but the user of the
      // inspector most likely wants debug.
      await client.setLoggingLevel("debug");
    }
  } catch (error) {
    throw new Error(
      `Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function disconnect(transport: Transport): Promise<void> {
  try {
    await transport.close();
  } catch (error) {
    throw new Error(
      `Failed to disconnect from MCP server: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Set logging level
export async function setLoggingLevel(
  client: Client,
  level: LogLevel,
): Promise<McpResponse> {
  try {
    const response = await client.setLoggingLevel(level as any);
    return response;
  } catch (error) {
    throw new Error(
      `Failed to set logging level: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
