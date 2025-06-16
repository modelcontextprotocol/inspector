import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpResponse } from "./types.js";

// List available resources
export async function listResources(
  client: Client,
  _meta?: Record<string, unknown>,
): Promise<McpResponse> {
  try {
    const response = await client.listResources({ _meta });
    return response;
  } catch (error) {
    throw new Error(
      `Failed to list resources: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Read a resource
export async function readResource(
  client: Client,
  uri: string,
  _meta?: Record<string, unknown>,
): Promise<McpResponse> {
  try {
    const response = await client.readResource({ uri, _meta });
    return response;
  } catch (error) {
    throw new Error(
      `Failed to read resource ${uri}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// List resource templates
export async function listResourceTemplates(
  client: Client,
  _meta?: Record<string, unknown>,
): Promise<McpResponse> {
  try {
    const response = await client.listResourceTemplates({ _meta });
    return response;
  } catch (error) {
    throw new Error(
      `Failed to list resource templates: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
