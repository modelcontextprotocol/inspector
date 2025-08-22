import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  LoggingLevel,
  EmptyResult,
} from "@modelcontextprotocol/sdk/types.js";
import { LoggingLevelSchema } from "@modelcontextprotocol/sdk/types.js";

// Extract valid log levels directly from the SDK's Zod schema to avoid drift
// This ensures CLI validation stays in sync with what the SDK accepts
export const validLogLevels = LoggingLevelSchema.options;

export async function connect(
  client: Client,
  transport: Transport,
): Promise<void> {
  try {
    await client.connect(transport);

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
  level: LoggingLevel,
): Promise<EmptyResult> {
  try {
    const response = await client.setLoggingLevel(level);
    return response;
  } catch (error) {
    throw new Error(
      `Failed to set logging level: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
