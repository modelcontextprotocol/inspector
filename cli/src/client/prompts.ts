import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpResponse } from "./types.js";

// List available prompts
export async function listPrompts(
  client: Client,
  _meta?: Record<string, unknown>,
): Promise<McpResponse> {
  try {
    const response = await client.listPrompts({ _meta });
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
  args?: Record<string, string>,
  _meta?: Record<string, unknown>,
): Promise<McpResponse> {
  try {
    const response = await client.getPrompt({
      name,
      arguments: args || {},
      _meta,
    });

    return response;
  } catch (error) {
    throw new Error(
      `Failed to get prompt: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
