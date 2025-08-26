import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * Mock STDIO MCP Server for testing purposes
 * Provides basic tools, resources, and prompts for integration testing
 */
export class MockStdioServer {
  private server: McpServer;
  private transport: StdioServerTransport | null = null;

  constructor(name: string = "mock-stdio-server", version: string = "1.0.0") {
    this.server = new McpServer({
      name,
      version,
    });

    this.setupResources();
    this.setupTools();
    this.setupPrompts();
  }

  private setupResources(): void {
    // Static resource
    this.server.registerResource(
      "test-config",
      "config://test",
      {
        title: "Test Configuration",
        description: "Mock configuration data for testing",
        mimeType: "application/json",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(
              {
                environment: "test",
                debug: true,
                features: ["feature1", "feature2"],
              },
              null,
              2,
            ),
          },
        ],
      }),
    );

    // Dynamic resource with parameters
    this.server.registerResource(
      "test-data",
      new ResourceTemplate("data://{id}", { list: undefined }),
      {
        title: "Test Data",
        description: "Mock data resource with dynamic ID",
      },
      async (uri, { id }) => ({
        contents: [
          {
            uri: uri.href,
            text: `Test data for ID: ${id}\nTimestamp: ${new Date().toISOString()}`,
          },
        ],
      }),
    );
  }

  private setupTools(): void {
    // Simple calculation tool
    this.server.registerTool(
      "add",
      {
        title: "Addition Tool",
        description: "Add two numbers together",
        inputSchema: {
          a: z.number().describe("First number"),
          b: z.number().describe("Second number"),
        },
      },
      async ({ a, b }) => ({
        content: [
          {
            type: "text",
            text: `Result: ${a + b}`,
          },
        ],
      }),
    );

    // Echo tool
    this.server.registerTool(
      "echo",
      {
        title: "Echo Tool",
        description: "Echo back the provided message",
        inputSchema: {
          message: z.string().describe("Message to echo"),
        },
      },
      async ({ message }) => ({
        content: [
          {
            type: "text",
            text: `Echo: ${message}`,
          },
        ],
      }),
    );

    // Tool that returns resource links
    this.server.registerTool(
      "list-resources",
      {
        title: "List Resources",
        description: "List available test resources",
        inputSchema: {},
      },
      async () => ({
        content: [
          { type: "text", text: "Available test resources:" },
          {
            type: "resource_link",
            uri: "config://test",
            name: "Test Configuration",
            description: "Mock configuration data",
          },
          {
            type: "resource_link",
            uri: "data://sample",
            name: "Sample Data",
            description: "Sample test data",
          },
        ],
      }),
    );

    // Tool that simulates an error
    this.server.registerTool(
      "error-test",
      {
        title: "Error Test Tool",
        description: "Tool that always throws an error for testing",
        inputSchema: {
          errorMessage: z.string().optional().describe("Custom error message"),
        },
      },
      async ({ errorMessage }) => {
        throw new Error(errorMessage || "Test error from mock server");
      },
    );
  }

  private setupPrompts(): void {
    // Simple prompt
    this.server.registerPrompt(
      "test-prompt",
      {
        title: "Test Prompt",
        description: "A simple test prompt",
        argsSchema: {
          topic: z.string().describe("Topic to discuss"),
        },
      },
      ({ topic }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please provide information about: ${topic}`,
            },
          },
        ],
      }),
    );

    // Prompt with multiple arguments
    this.server.registerPrompt(
      "analysis-prompt",
      {
        title: "Analysis Prompt",
        description: "Prompt for analyzing data",
        argsSchema: {
          data: z.string().describe("Data to analyze"),
          analysisType: z
            .enum(["summary", "detailed", "statistical"])
            .describe("Type of analysis"),
        },
      },
      ({ data, analysisType }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please perform a ${analysisType} analysis of the following data:\n\n${data}`,
            },
          },
        ],
      }),
    );
  }

  /**
   * Start the mock server with STDIO transport
   */
  async start(): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);
    console.log("Mock STDIO MCP Server started");
  }

  /**
   * Stop the mock server
   */
  async stop(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    console.log("Mock STDIO MCP Server stopped");
  }

  /**
   * Get the server instance for testing
   */
  getServer(): McpServer {
    return this.server;
  }
}

// If run directly, start the server
if (require.main === module) {
  const mockServer = new MockStdioServer();

  process.on("SIGINT", async () => {
    console.log("\nShutting down mock server...");
    await mockServer.stop();
    process.exit(0);
  });

  mockServer.start().catch((error) => {
    console.error("Failed to start mock server:", error);
    process.exit(1);
  });
}
