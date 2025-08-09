#!/usr/bin/env node

/**
 * Test MCP Server for reproducing parameter display issues
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "test-parameter-limits",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Test tools with different parameter counts
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "test_tool_3_params",
        description: "Test tool with 3 parameters",
        inputSchema: {
          type: "object",
          properties: {
            param1: {
              type: "string",
              description: "First parameter (required)"
            },
            param2: {
              type: "string", 
              description: "Second parameter (required)"
            },
            param3: {
              type: "boolean",
              description: "Third parameter (optional)",
              default: false
            }
          },
          required: ["param1", "param2"]
        }
      },
      {
        name: "test_tool_6_params", 
        description: "Test tool with 6 parameters - should show ALL 6",
        inputSchema: {
          type: "object",
          properties: {
            param1: {
              type: "string",
              description: "First parameter"
            },
            param2: {
              type: "string",
              description: "Second parameter"  
            },
            param3: {
              type: "string",
              description: "Third parameter",
              default: "default_value"
            },
            param4: {
              type: "string", 
              description: "Fourth parameter",
              default: ""
            },
            param5: {
              type: "string",
              description: "Fifth parameter", 
              default: ""
            },
            param6: {
              type: "boolean",
              description: "Sixth parameter",
              default: false
            }
          },
          required: ["param1", "param2"]
        }
      },
      {
        name: "test_tool_8_params",
        description: "Test tool with 8 parameters - should show ALL 8", 
        inputSchema: {
          type: "object",
          properties: {
            param1: {
              type: "string",
              description: "First parameter"
            },
            param2: {
              type: "string",
              description: "Second parameter"
            },
            param3: {
              type: "string", 
              description: "Third parameter"
            },
            param4: {
              type: "string",
              description: "Fourth parameter",
              default: ""
            },
            param5: {
              type: "boolean",
              description: "Fifth parameter",
              default: false
            },
            param6: {
              type: "boolean", 
              description: "Sixth parameter",
              default: false
            },
            param7: {
              type: "number",
              description: "Seventh parameter", 
              default: 0
            },
            param8: {
              type: "integer",
              description: "Eighth parameter",
              default: 42
            }
          },
          required: ["param1", "param2", "param3"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  return {
    content: [
      {
        type: "text",
        text: `Tool ${name} called successfully with ${Object.keys(args).length} parameters: ${JSON.stringify(args, null, 2)}`
      }
    ]
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);