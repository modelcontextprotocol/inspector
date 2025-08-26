/**
 * Mock MCP Servers for testing multi-server functionality
 *
 * This module exports mock servers that implement the MCP protocol
 * using the @modelcontextprotocol/sdk library. These servers provide
 * basic tools, resources, and prompts for integration testing.
 */

export { MockStdioServer } from "./stdio/mockStdioServer.js";
export { MockHttpServer } from "./http/mockHttpServer.js";

/**
 * Utility function to create a mock STDIO server configuration
 */
export function createMockStdioConfig(name: string = "test-stdio-server") {
  return {
    id: `mock-stdio-${Date.now()}`,
    name,
    description: "Mock STDIO MCP Server for testing",
    transport: {
      type: "stdio" as const,
      command: "node",
      args: [
        "-e",
        `
        const { MockStdioServer } = require('./server/src/multiserver/mock-servers/stdio/mockStdioServer.js');
        const server = new MockStdioServer('${name}');
        server.start().catch(console.error);
        `,
      ],
    },
  };
}

/**
 * Utility function to create a mock HTTP server configuration
 */
export function createMockHttpConfig(
  name: string = "test-http-server",
  port: number = 3001,
) {
  return {
    id: `mock-http-${Date.now()}`,
    name,
    description: "Mock HTTP MCP Server for testing",
    transport: {
      type: "http" as const,
      url: `http://localhost:${port}/mcp`,
    },
  };
}

/**
 * Default mock server configurations for testing
 */
export const DEFAULT_MOCK_CONFIGS = {
  stdio: createMockStdioConfig("default-stdio-mock"),
  http: createMockHttpConfig("default-http-mock", 3001),
};
