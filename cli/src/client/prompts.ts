import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ListPromptsResult,
  GetPromptResult,
} from "@modelcontextprotocol/sdk/types.js";

// List available prompts
export async function listPrompts(client: Client): Promise<ListPromptsResult> {
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
  args?: Record<string, string>,
): Promise<GetPromptResult> {
  try {
    const response = await client.getPrompt({
      name,
      arguments: args || {},
    });

    return response;
  } catch (error) {
    throw new Error(
      `Failed to get prompt: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
