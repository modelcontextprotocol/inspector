import { Client } from "@modelcontextprotocol/sdk/client/index.js";
/**
 * Creates a new MCP client with standard configuration
 */
export function createClient(transport) {
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
