import { Client } from "mcp-typescript/client/index.js";
import { SSEClientTransport } from "mcp-typescript/client/sse.js";
import { StdioClientTransport } from "mcp-typescript/client/stdio.js";
import {
  ListResourcesResult,
  ReadResourceResult,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ListPromptsResult,
  ListPromptsResultSchema,
  GetPromptResult,
  GetPromptResultSchema,
  ListToolsResult,
  ListToolsResultSchema,
  CallToolResult,
  CallToolResultSchema,
  GetPromptRequest,
  ReadResourceRequest,
  CallToolRequest,
} from "mcp-typescript/types.js";

export class McpClient {
  private client: Client;
  private transport?: SSEClientTransport | StdioClientTransport;

  constructor(name: string, version: string) {
    this.client = new Client({
      name,
      version,
    });
  }

  async connect(url: string | URL) {
    const urlObj = typeof url === "string" ? new URL(url) : url;

    if (urlObj.protocol === "http:" || urlObj.protocol === "https:") {
      this.transport = new SSEClientTransport();
    } else {
      throw new Error(`Unsupported protocol: ${urlObj.protocol}`);
    }

    await this.transport.connect(urlObj);
    await this.client.connect(this.transport);
  }

  async connectStdio(command: string, args: string[] = []) {
    this.transport = new StdioClientTransport();
    await this.transport.spawn({ command, args });
    await this.client.connect(this.transport);
  }

  async close() {
    await this.client.close();
  }

  // Resource Operations
  async listResources(): Promise<ListResourcesResult> {
    return await this.client.request(
      {
        method: "resources/list",
      },
      ListResourcesResultSchema,
    );
  }

  async readResource(
    params: ReadResourceRequest["params"],
  ): Promise<ReadResourceResult> {
    return await this.client.request(
      {
        method: "resources/read",
        params,
      },
      ReadResourceResultSchema,
    );
  }

  // Prompt Operations
  async listPrompts(): Promise<ListPromptsResult> {
    return await this.client.request(
      {
        method: "prompts/list",
      },
      ListPromptsResultSchema,
    );
  }

  async getPrompt(
    params: GetPromptRequest["params"],
  ): Promise<GetPromptResult> {
    return await this.client.request(
      {
        method: "prompts/get",
        params,
      },
      GetPromptResultSchema,
    );
  }
  // Tool Operations
  async listTools(): Promise<ListToolsResult> {
    return await this.client.request(
      {
        method: "tools/list",
      },
      ListToolsResultSchema,
    );
  }

  async callTool(params: CallToolRequest["params"]): Promise<CallToolResult> {
    return await this.client.request(
      {
        method: "tools/call",
        params,
      },
      CallToolResultSchema,
    );
  }

  getServerCapabilities() {
    return this.client.getServerCapabilities();
  }

  getServerVersion() {
    return this.client.getServerVersion();
  }
}

export default McpClient;
