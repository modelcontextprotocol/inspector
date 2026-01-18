import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * Creates a new MCP client with standard configuration
 */
export function createClient(transport: Transport): Client {
  return new Client(
    {
      name: "mcp-inspect",
      version: "1.0.5",
    },
    {
      capabilities: {},
    },
  );
}
