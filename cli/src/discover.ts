import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface ServerCapabilitiesMap {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
  logging: boolean;
  completions: boolean;
}

export interface DiscoverResult {
  serverInfo: {
    name: string;
    version: string;
    [key: string]: unknown;
  };
  capabilities: ServerCapabilitiesMap;
  tools: unknown[];
  resources: unknown[];
  prompts: unknown[];
}

export async function discover(client: Client): Promise<DiscoverResult> {
  const caps = client.getServerCapabilities() ?? {};
  const serverInfo = client.getServerVersion() ?? {
    name: "unknown",
    version: "0.0.0",
  };

  const capabilities: ServerCapabilitiesMap = {
    tools: !!caps.tools,
    resources: !!caps.resources,
    prompts: !!caps.prompts,
    logging: !!caps.logging,
    completions: !!caps.completions,
  };

  const result: DiscoverResult = {
    serverInfo,
    capabilities,
    tools: [],
    resources: [],
    prompts: [],
  };

  if (capabilities.tools) {
    const toolsResponse = await client.listTools();
    result.tools = toolsResponse.tools;
  }

  if (capabilities.resources) {
    const resourcesResponse = await client.listResources();
    result.resources = resourcesResponse.resources;
  }

  if (capabilities.prompts) {
    const promptsResponse = await client.listPrompts();
    result.prompts = promptsResponse.prompts;
  }

  return result;
}
