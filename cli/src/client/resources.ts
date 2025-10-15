import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpResponse } from "./types.js";

// List available resources
export async function listResources(
  client: Client,
  metaData?: Record<string, string>,
): Promise<McpResponse> {
  try {
    const params =
      metaData && Object.keys(metaData).length > 0 ? { _meta: metaData } : {};
    const response = await client.listResources(params);
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
  metaData?: Record<string, string>,
): Promise<McpResponse> {
  try {
    const params: any = { uri };
    if (metaData && Object.keys(metaData).length > 0) {
      params._meta = metaData;
    }
    const response = await client.readResource(params);
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
  metaData?: Record<string, string>,
): Promise<McpResponse> {
  try {
    const params =
      metaData && Object.keys(metaData).length > 0 ? { _meta: metaData } : {};
    const response = await client.listResourceTemplates(params);
    return response;
  } catch (error) {
    throw new Error(
      `Failed to list resource templates: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
