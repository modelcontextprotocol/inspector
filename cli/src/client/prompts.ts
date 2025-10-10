import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpResponse } from "./types.js";

// JSON value type matching the client utils
type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

// List available prompts
export async function listPrompts(client: Client): Promise<McpResponse> {
  try {
    const response = await client.listPrompts();
    return response;
  } catch (error) {
    throw new Error(
      `Failed to list prompts: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Get a prompt
export async function getPrompt(
  client: Client,
  name: string,
  args?: Record<string, JsonValue>,
): Promise<McpResponse> {
  try {
    // Convert all arguments to strings for prompt arguments
    const stringArgs: Record<string, string> = {};
    if (args) {
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === "string") {
          stringArgs[key] = value;
        } else if (value === null || value === undefined) {
          stringArgs[key] = String(value);
        } else {
          stringArgs[key] = JSON.stringify(value);
        }
      }
    }

    const response = await client.getPrompt({
      name,
      arguments: stringArgs,
    });

    return response;
  } catch (error) {
    throw new Error(
      `Failed to get prompt: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
