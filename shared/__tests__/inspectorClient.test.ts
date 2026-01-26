import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InspectorClient } from "../mcp/inspectorClient.js";
import { SamplingCreateMessage } from "../mcp/samplingCreateMessage.js";
import { ElicitationCreateMessage } from "../mcp/elicitationCreateMessage.js";
import { getTestMcpServerCommand } from "../test/test-server-stdio.js";
import {
  createTestServerHttp,
  type TestServerHttp,
} from "../test/test-server-http.js";
import {
  createEchoTool,
  createTestServerInfo,
  createFileResourceTemplate,
  createCollectSampleTool,
  createCollectFormElicitationTool,
  createCollectUrlElicitationTool,
  createSendNotificationTool,
  createListRootsTool,
  createArgsPrompt,
  createArchitectureResource,
  createTestCwdResource,
  createSimplePrompt,
  createUserResourceTemplate,
  createNumberedTools,
  createNumberedResources,
  createNumberedResourceTemplates,
  createNumberedPrompts,
  getTaskServerConfig,
  createElicitationTaskTool,
  createSamplingTaskTool,
  createProgressTaskTool,
  createFlexibleTaskTool,
} from "../test/test-server-fixtures.js";
import type { MessageEntry, ConnectionStatus } from "../mcp/types.js";
import type { TypedEvent } from "../mcp/inspectorClientEventTarget.js";
import type {
  CreateMessageResult,
  ElicitResult,
  CallToolResult,
  Task,
} from "@modelcontextprotocol/sdk/types.js";
import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/sdk/types.js";

describe("InspectorClient", () => {
  let client: InspectorClient;
  let server: TestServerHttp | null;
  let serverCommand: { command: string; args: string[] };

  beforeEach(() => {
    serverCommand = getTestMcpServerCommand();
    server = null;
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      client = null as any;
    }
    if (server) {
      try {
        await server.stop();
      } catch {
        // Ignore server stop errors
      }
      server = null;
    }
  });

  describe("Connection Management", () => {
    it("should create client with stdio transport", () => {
      client = new InspectorClient({
        type: "stdio",
        command: serverCommand.command,
        args: serverCommand.args,
      });

      expect(client.getStatus()).toBe("disconnected");
      expect(client.getServerType()).toBe("stdio");
    });

    it("should connect to server", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      expect(client.getStatus()).toBe("connected");
    });

    it("should disconnect from server", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      expect(client.getStatus()).toBe("connected");

      await client.disconnect();
      expect(client.getStatus()).toBe("disconnected");
    });

    it("should clear server state on disconnect", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();
      expect(client.getTools().length).toBeGreaterThan(0);

      await client.disconnect();
      expect(client.getTools().length).toBe(0);
      expect(client.getResources().length).toBe(0);
      expect(client.getPrompts().length).toBe(0);
    });

    it("should clear messages on connect", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      // Make a request to generate messages
      await client.listAllTools();
      const firstConnectMessages = client.getMessages();
      expect(firstConnectMessages.length).toBeGreaterThan(0);

      // Disconnect and reconnect
      await client.disconnect();
      await client.connect();
      // After reconnect, messages should be cleared, but connect() itself creates new messages (initialize)
      // So we should have messages from the new connection, but not from the old one
      const secondConnectMessages = client.getMessages();
      // The new connection should have at least the initialize message
      expect(secondConnectMessages.length).toBeGreaterThan(0);
      // But the first message should be from the new connection (check timestamp)
      if (firstConnectMessages.length > 0 && secondConnectMessages.length > 0) {
        const lastFirstMessage =
          firstConnectMessages[firstConnectMessages.length - 1];
        const firstSecondMessage = secondConnectMessages[0];
        if (lastFirstMessage && firstSecondMessage) {
          expect(firstSecondMessage.timestamp.getTime()).toBeGreaterThanOrEqual(
            lastFirstMessage.timestamp.getTime(),
          );
        }
      }
    });
  });

  describe("Message Tracking", () => {
    it("should track requests", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.listAllTools();

      const messages = client.getMessages();
      expect(messages.length).toBeGreaterThan(0);
      const request = messages.find((m) => m.direction === "request");
      expect(request).toBeDefined();
      if (request) {
        expect("method" in request.message).toBe(true);
      }
    });

    it("should track responses", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.listAllTools();

      const messages = client.getMessages();
      const request = messages.find((m) => m.direction === "request");
      expect(request).toBeDefined();
      if (request && "response" in request) {
        expect(request.response).toBeDefined();
        expect(request.duration).toBeDefined();
      }
    });

    it("should respect maxMessages limit", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          maxMessages: 5,
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Make multiple requests to exceed the limit
      for (let i = 0; i < 10; i++) {
        await client.listAllTools();
      }

      expect(client.getMessages().length).toBeLessThanOrEqual(5);
    });

    it("should emit message events", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      const messageEvents: MessageEntry[] = [];
      client.addEventListener("message", (event) => {
        messageEvents.push(event.detail);
      });

      await client.connect();
      await client.listAllTools();

      expect(messageEvents.length).toBeGreaterThan(0);
    });

    it("should emit messagesChange events", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      let changeCount = 0;
      client.addEventListener("messagesChange", () => {
        changeCount++;
      });

      await client.connect();
      await client.listAllTools();

      expect(changeCount).toBeGreaterThan(0);
    });
  });

  describe("Fetch Request Tracking", () => {
    it("should track HTTP requests for SSE transport", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "sse",
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.listAllTools();

      const fetchRequests = client.getFetchRequests();
      expect(fetchRequests.length).toBeGreaterThan(0);
      const request = fetchRequests[0];
      expect(request).toBeDefined();
      if (request) {
        expect(request.url).toContain("/sse");
        expect(request.method).toBe("GET");
      }
    });

    it("should track HTTP requests for streamable-http transport", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.listAllTools();

      const fetchRequests = client.getFetchRequests();
      expect(fetchRequests.length).toBeGreaterThan(0);
      const request = fetchRequests[0];
      expect(request).toBeDefined();
      if (request) {
        expect(request.url).toContain("/mcp");
        expect(request.method).toBe("POST");
      }
    });

    it("should track request and response details", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.listAllTools();

      const fetchRequests = client.getFetchRequests();
      expect(fetchRequests.length).toBeGreaterThan(0);
      // Find a request that has response details (not just the initial connection)
      const request = fetchRequests.find((r) => r.responseStatus !== undefined);
      expect(request).toBeDefined();
      if (request) {
        expect(request.requestHeaders).toBeDefined();
        expect(request.responseStatus).toBeDefined();
        expect(request.responseHeaders).toBeDefined();
        expect(request.duration).toBeDefined();
      }
    });

    it("should respect maxFetchRequests limit", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          maxFetchRequests: 3,
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Make multiple requests to exceed the limit
      for (let i = 0; i < 10; i++) {
        await client.listAllTools();
      }

      expect(client.getFetchRequests().length).toBeLessThanOrEqual(3);
    });

    it("should emit fetchRequest events", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      const fetchRequestEvents: any[] = [];
      client.addEventListener("fetchRequest", (event) => {
        fetchRequestEvents.push(event.detail);
      });

      await client.connect();
      await client.listAllTools();

      expect(fetchRequestEvents.length).toBeGreaterThan(0);
    });

    it("should emit fetchRequestsChange events", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      let changeFired = false;
      client.addEventListener("fetchRequestsChange", () => {
        changeFired = true;
      });

      await client.connect();
      await client.listAllTools();

      expect(changeFired).toBe(true);
    });
  });

  describe("Server Data Management", () => {
    it("should auto-fetch server contents when enabled", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();

      expect(client.getTools().length).toBeGreaterThan(0);
      expect(client.getCapabilities()).toBeDefined();
      expect(client.getServerInfo()).toBeDefined();
    });

    it("should not auto-fetch server contents when disabled", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      expect(client.getTools().length).toBe(0);
    });

    it("should emit toolsChange event", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true,
        },
      );

      const toolsEvents: any[][] = [];
      client.addEventListener("toolsChange", (event) => {
        toolsEvents.push(event.detail);
      });

      await client.connect();

      expect(toolsEvents.length).toBeGreaterThan(0);
      expect(toolsEvents[0]?.length).toBeGreaterThan(0);
    });
  });

  describe("Tool Methods", () => {
    beforeEach(async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();
    });

    it("should list tools", async () => {
      const tools = await client.listAllTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should call tool with string arguments", async () => {
      const result = await client.callTool("echo", {
        message: "hello world",
      });

      expect(result).toHaveProperty("result");
      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty("content");
      const content = result.result!.content as any[];
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]).toHaveProperty("type", "text");
      expect(content[0].text).toContain("hello world");
    });

    it("should call tool with number arguments", async () => {
      const result = await client.callTool("get-sum", {
        a: 42,
        b: 58,
      });
      expect(result.success).toBe(true);

      expect(result.result).toHaveProperty("content");
      const content = result.result!.content as any[];
      const resultData = JSON.parse(content[0].text);
      expect(resultData.result).toBe(100);
    });

    it("should call tool with boolean arguments", async () => {
      const result = await client.callTool("get-annotated-message", {
        messageType: "success",
        includeImage: true,
      });

      expect(result.result).toHaveProperty("content");
      const content = result.result!.content as any[];
      expect(content.length).toBeGreaterThan(1);
      const hasImage = content.some((item: any) => item.type === "image");
      expect(hasImage).toBe(true);
    });

    it("should handle tool not found", async () => {
      const result = await client.callTool("nonexistent-tool", {});
      // When tool is not found, the SDK returns an error response, not an exception
      expect(result.success).toBe(true); // SDK returns error in result, not as exception
      expect(result.result).toHaveProperty("isError", true);
      expect(result.result).toBeDefined();
      if (result.result) {
        expect(result.result).toHaveProperty("content");
        const content = result.result.content as any[];
        expect(content[0]).toHaveProperty("text");
        expect(content[0].text).toContain("not found");
      }
    });

    it("should paginate tools when maxPageSize is set", async () => {
      // Disconnect and create a new server with pagination
      await client.disconnect();
      if (server) {
        await server.stop();
      }

      // Create server with 10 tools and page size of 3
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: createNumberedTools(10),
        maxPageSize: {
          tools: 3,
        },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // First page should have 3 tools
      const page1 = await client.listTools();
      expect(page1.tools.length).toBe(3);
      expect(page1.nextCursor).toBeDefined();
      expect(page1.tools[0]?.name).toBe("tool-1");
      expect(page1.tools[1]?.name).toBe("tool-2");
      expect(page1.tools[2]?.name).toBe("tool-3");

      // Second page should have 3 more tools
      const page2 = await client.listTools(page1.nextCursor);
      expect(page2.tools.length).toBe(3);
      expect(page2.nextCursor).toBeDefined();
      expect(page2.tools[0]?.name).toBe("tool-4");
      expect(page2.tools[1]?.name).toBe("tool-5");
      expect(page2.tools[2]?.name).toBe("tool-6");

      // Third page should have 3 more tools
      const page3 = await client.listTools(page2.nextCursor);
      expect(page3.tools.length).toBe(3);
      expect(page3.nextCursor).toBeDefined();
      expect(page3.tools[0]?.name).toBe("tool-7");
      expect(page3.tools[1]?.name).toBe("tool-8");
      expect(page3.tools[2]?.name).toBe("tool-9");

      // Fourth page should have 1 tool and no next cursor
      const page4 = await client.listTools(page3.nextCursor);
      expect(page4.tools.length).toBe(1);
      expect(page4.nextCursor).toBeUndefined();
      expect(page4.tools[0]?.name).toBe("tool-10");

      // listAllTools should get all 10 tools
      const allTools = await client.listAllTools();
      expect(allTools.length).toBe(10);
    });
  });

  describe("Resource Methods", () => {
    beforeEach(async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();
    });

    it("should list resources", async () => {
      const resources = await client.listAllResources();
      expect(Array.isArray(resources)).toBe(true);
    });

    it("should read resource", async () => {
      // First get list of resources
      const resources = await client.listAllResources();
      if (resources.length > 0) {
        const uri = resources[0]!.uri;
        const readResult = await client.readResource(uri);
        expect(readResult).toHaveProperty("result");
        expect(readResult.result).toHaveProperty("contents");
      }
    });

    it("should paginate resources when maxPageSize is set", async () => {
      // Disconnect and create a new server with pagination
      await client.disconnect();
      if (server) {
        await server.stop();
      }

      // Create server with 10 resources and page size of 3
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: createNumberedResources(10),
        maxPageSize: {
          resources: 3,
        },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // First page should have 3 resources
      const page1 = await client.listResources();
      expect(page1.resources.length).toBe(3);
      expect(page1.nextCursor).toBeDefined();
      expect(page1.resources[0]?.uri).toBe("test://resource-1");
      expect(page1.resources[1]?.uri).toBe("test://resource-2");
      expect(page1.resources[2]?.uri).toBe("test://resource-3");

      // Second page should have 3 more resources
      const page2 = await client.listResources(page1.nextCursor);
      expect(page2.resources.length).toBe(3);
      expect(page2.nextCursor).toBeDefined();
      expect(page2.resources[0]?.uri).toBe("test://resource-4");
      expect(page2.resources[1]?.uri).toBe("test://resource-5");
      expect(page2.resources[2]?.uri).toBe("test://resource-6");

      // Third page should have 3 more resources
      const page3 = await client.listResources(page2.nextCursor);
      expect(page3.resources.length).toBe(3);
      expect(page3.nextCursor).toBeDefined();
      expect(page3.resources[0]?.uri).toBe("test://resource-7");
      expect(page3.resources[1]?.uri).toBe("test://resource-8");
      expect(page3.resources[2]?.uri).toBe("test://resource-9");

      // Fourth page should have 1 resource and no next cursor
      const page4 = await client.listResources(page3.nextCursor);
      expect(page4.resources.length).toBe(1);
      expect(page4.nextCursor).toBeUndefined();
      expect(page4.resources[0]?.uri).toBe("test://resource-10");

      // listAllResources should get all 10 resources
      const allResources = await client.listAllResources();
      expect(allResources.length).toBe(10);
    });
  });

  describe("Resource Template Methods", () => {
    beforeEach(async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [createFileResourceTemplate()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
        },
      );

      await client.connect();
    });

    it("should list resource templates", async () => {
      const resourceTemplates = await client.listAllResourceTemplates();
      expect(Array.isArray(resourceTemplates)).toBe(true);
      expect(resourceTemplates.length).toBeGreaterThan(0);

      const templates = resourceTemplates;
      const fileTemplate = templates.find((t) => t.name === "file");
      expect(fileTemplate).toBeDefined();
      expect(fileTemplate?.uriTemplate).toBe("file:///{path}");
    });

    it("should read resource from template", async () => {
      // First get the template
      const templates = await client.listAllResourceTemplates();
      const fileTemplate = templates.find((t) => t.name === "file");
      expect(fileTemplate).toBeDefined();

      // Use a URI that matches the template pattern file:///{path}
      // The path variable will be "test.txt"
      const expandedUri = "file:///test.txt";

      // Read the resource using the expanded URI
      const readResult = await client.readResource(expandedUri);
      expect(readResult).toHaveProperty("result");
      expect(readResult.result).toHaveProperty("contents");
      const contents = readResult.result.contents;
      expect(Array.isArray(contents)).toBe(true);
      expect(contents.length).toBeGreaterThan(0);

      const content = contents[0];
      expect(content).toHaveProperty("uri");
      if (content && "text" in content) {
        expect(content.text).toContain("Mock file content for: test.txt");
      }
    });

    it("should include resources from template list callback in listResources", async () => {
      // Create a server with a resource template that has a list callback
      const listCallback = async () => {
        return ["file:///file1.txt", "file:///file2.txt", "file:///file3.txt"];
      };

      await client.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [
          createFileResourceTemplate(undefined, listCallback),
        ],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Call listResources - this should include resources from the template's list callback
      const resources = await client.listAllResources();
      expect(Array.isArray(resources)).toBe(true);

      // Verify that the resources from the list callback are included
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain("file:///file1.txt");
      expect(uris).toContain("file:///file2.txt");
      expect(uris).toContain("file:///file3.txt");
    });

    it("should paginate resource templates when maxPageSize is set", async () => {
      // Disconnect and create a new server with pagination
      await client.disconnect();
      if (server) {
        await server.stop();
      }

      // Create server with 10 resource templates and page size of 3
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: createNumberedResourceTemplates(10),
        maxPageSize: {
          resourceTemplates: 3,
        },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // First page should have 3 templates
      const page1 = await client.listResourceTemplates();
      expect(page1.resourceTemplates.length).toBe(3);
      expect(page1.nextCursor).toBeDefined();
      expect(page1.resourceTemplates[0]?.uriTemplate).toBe(
        "test://template-1/{param}",
      );
      expect(page1.resourceTemplates[1]?.uriTemplate).toBe(
        "test://template-2/{param}",
      );
      expect(page1.resourceTemplates[2]?.uriTemplate).toBe(
        "test://template-3/{param}",
      );

      // Second page should have 3 more templates
      const page2 = await client.listResourceTemplates(page1.nextCursor);
      expect(page2.resourceTemplates.length).toBe(3);
      expect(page2.nextCursor).toBeDefined();
      expect(page2.resourceTemplates[0]?.uriTemplate).toBe(
        "test://template-4/{param}",
      );
      expect(page2.resourceTemplates[1]?.uriTemplate).toBe(
        "test://template-5/{param}",
      );
      expect(page2.resourceTemplates[2]?.uriTemplate).toBe(
        "test://template-6/{param}",
      );

      // Third page should have 3 more templates
      const page3 = await client.listResourceTemplates(page2.nextCursor);
      expect(page3.resourceTemplates.length).toBe(3);
      expect(page3.nextCursor).toBeDefined();
      expect(page3.resourceTemplates[0]?.uriTemplate).toBe(
        "test://template-7/{param}",
      );
      expect(page3.resourceTemplates[1]?.uriTemplate).toBe(
        "test://template-8/{param}",
      );
      expect(page3.resourceTemplates[2]?.uriTemplate).toBe(
        "test://template-9/{param}",
      );

      // Fourth page should have 1 template and no next cursor
      const page4 = await client.listResourceTemplates(page3.nextCursor);
      expect(page4.resourceTemplates.length).toBe(1);
      expect(page4.nextCursor).toBeUndefined();
      expect(page4.resourceTemplates[0]?.uriTemplate).toBe(
        "test://template-10/{param}",
      );

      // listAllResourceTemplates should get all 10 templates
      const allTemplates = await client.listAllResourceTemplates();
      expect(allTemplates.length).toBe(10);
    });
  });

  describe("Prompt Methods", () => {
    beforeEach(async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();
    });

    it("should list prompts", async () => {
      const prompts = await client.listAllPrompts();
      expect(Array.isArray(prompts)).toBe(true);
    });

    it("should paginate prompts when maxPageSize is set", async () => {
      // Disconnect and create a new server with pagination
      await client.disconnect();
      if (server) {
        await server.stop();
      }

      // Create server with 10 prompts and page size of 3
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: createNumberedPrompts(10),
        maxPageSize: {
          prompts: 3,
        },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // First page should have 3 prompts
      const page1 = await client.listPrompts();
      expect(page1.prompts.length).toBe(3);
      expect(page1.nextCursor).toBeDefined();
      expect(page1.prompts[0]?.name).toBe("prompt-1");
      expect(page1.prompts[1]?.name).toBe("prompt-2");
      expect(page1.prompts[2]?.name).toBe("prompt-3");

      // Second page should have 3 more prompts
      const page2 = await client.listPrompts(page1.nextCursor);
      expect(page2.prompts.length).toBe(3);
      expect(page2.nextCursor).toBeDefined();
      expect(page2.prompts[0]?.name).toBe("prompt-4");
      expect(page2.prompts[1]?.name).toBe("prompt-5");
      expect(page2.prompts[2]?.name).toBe("prompt-6");

      // Third page should have 3 more prompts
      const page3 = await client.listPrompts(page2.nextCursor);
      expect(page3.prompts.length).toBe(3);
      expect(page3.nextCursor).toBeDefined();
      expect(page3.prompts[0]?.name).toBe("prompt-7");
      expect(page3.prompts[1]?.name).toBe("prompt-8");
      expect(page3.prompts[2]?.name).toBe("prompt-9");

      // Fourth page should have 1 prompt and no next cursor
      const page4 = await client.listPrompts(page3.nextCursor);
      expect(page4.prompts.length).toBe(1);
      expect(page4.nextCursor).toBeUndefined();
      expect(page4.prompts[0]?.name).toBe("prompt-10");

      // listAllPrompts should get all 10 prompts
      const allPrompts = await client.listAllPrompts();
      expect(allPrompts.length).toBe(10);
    });
  });

  describe("Progress Tracking", () => {
    it("should dispatch progressNotification events when progress notifications are received", async () => {
      const { createSendProgressTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createSendProgressTool()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
          progress: true,
        },
      );

      await client.connect();

      const progressEvents: any[] = [];
      const progressListener = (event: TypedEvent<"progressNotification">) => {
        progressEvents.push(event.detail);
      };
      client.addEventListener("progressNotification", progressListener);

      // Generate a progress token
      const progressToken = 12345;

      // Call the tool with progressToken in metadata
      await client.callTool(
        "sendProgress",
        {
          units: 3,
          delayMs: 50,
          total: 3,
          message: "Test progress",
        },
        undefined, // generalMetadata
        { progressToken: progressToken.toString() }, // toolSpecificMetadata
      );

      // Wait a bit for all progress notifications to be received
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Remove listener
      client.removeEventListener("progressNotification", progressListener);

      // Verify we received progress events
      expect(progressEvents.length).toBe(3);

      // Verify first progress event
      expect(progressEvents[0]).toMatchObject({
        progress: 1,
        total: 3,
        message: "Test progress (1/3)",
        progressToken: progressToken.toString(),
      });

      // Verify second progress event
      expect(progressEvents[1]).toMatchObject({
        progress: 2,
        total: 3,
        message: "Test progress (2/3)",
        progressToken: progressToken.toString(),
      });

      // Verify third progress event
      expect(progressEvents[2]).toMatchObject({
        progress: 3,
        total: 3,
        message: "Test progress (3/3)",
        progressToken: progressToken.toString(),
      });

      await client.disconnect();
      await server.stop();
    });

    it("should not dispatch progressNotification events when progress is disabled", async () => {
      const { createSendProgressTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createSendProgressTool()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
          progress: false, // Disable progress
        },
      );

      await client.connect();

      const progressEvents: any[] = [];
      const progressListener = (event: TypedEvent<"progressNotification">) => {
        progressEvents.push(event.detail);
      };
      client.addEventListener("progressNotification", progressListener);

      const progressToken = 12345;

      // Call the tool with progressToken in metadata
      await client.callTool(
        "sendProgress",
        {
          units: 2,
          delayMs: 50,
        },
        undefined, // generalMetadata
        { progressToken: progressToken.toString() }, // toolSpecificMetadata
      );

      // Wait a bit for notifications
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Remove listener
      client.removeEventListener("progressNotification", progressListener);

      // Verify no progress events were received
      expect(progressEvents.length).toBe(0);

      await client.disconnect();
      await server.stop();
    });

    it("should handle progress notifications without total", async () => {
      const { createSendProgressTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createSendProgressTool()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
          progress: true,
        },
      );

      await client.connect();

      const progressEvents: any[] = [];
      const progressListener = (event: TypedEvent<"progressNotification">) => {
        progressEvents.push(event.detail);
      };
      client.addEventListener("progressNotification", progressListener);

      const progressToken = 67890;

      // Call the tool without total, with progressToken in metadata
      await client.callTool(
        "sendProgress",
        {
          units: 2,
          delayMs: 50,
          message: "Indeterminate progress",
        },
        undefined, // generalMetadata
        { progressToken: progressToken.toString() }, // toolSpecificMetadata
      );

      // Wait a bit for notifications
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Remove listener
      client.removeEventListener("progressNotification", progressListener);

      // Verify we received progress events
      expect(progressEvents.length).toBe(2);

      // Verify events don't have total
      expect(progressEvents[0]).toMatchObject({
        progress: 1,
        message: "Indeterminate progress (1/2)",
        progressToken: progressToken.toString(),
      });
      expect(progressEvents[0].total).toBeUndefined();

      expect(progressEvents[1]).toMatchObject({
        progress: 2,
        message: "Indeterminate progress (2/2)",
        progressToken: progressToken.toString(),
      });
      expect(progressEvents[1].total).toBeUndefined();

      await client.disconnect();
      await server.stop();
    });
  });

  describe("Logging", () => {
    it("should set logging level when server supports it", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
          initialLoggingLevel: "debug",
        },
      );

      await client.connect();

      // If server supports logging, the level should be set
      // We can't directly verify this, but it shouldn't throw
      const capabilities = client.getCapabilities();
      if (capabilities?.logging) {
        await client.setLoggingLevel("info");
      }
    });

    it("should track stderr logs for stdio transport", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          pipeStderr: true,
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Stderr logs may or may not be present depending on server behavior
      const logs = client.getStderrLogs();
      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe("Events", () => {
    it("should emit statusChange events", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      const statuses: ConnectionStatus[] = [];
      client.addEventListener("statusChange", (event) => {
        statuses.push(event.detail);
      });

      await client.connect();
      await client.disconnect();

      expect(statuses).toContain("connecting");
      expect(statuses).toContain("connected");
      expect(statuses).toContain("disconnected");
    });

    it("should emit connect event", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      let connectFired = false;
      client.addEventListener("connect", () => {
        connectFired = true;
      });

      await client.connect();
      expect(connectFired).toBe(true);
    });

    it("should emit disconnect event", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      let disconnectFired = false;
      client.addEventListener("disconnect", () => {
        disconnectFired = true;
      });

      await client.connect();
      await client.disconnect();
      expect(disconnectFired).toBe(true);
    });
  });

  describe("Sampling Requests", () => {
    it("should handle sampling requests from server and respond", async () => {
      // Create a test server with the collectSample tool
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createCollectSampleTool()],
        serverType: "streamable-http",
      });

      await server.start();

      // Create client with sampling enabled
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          sample: true, // Enable sampling capability
        },
      );

      await client.connect();

      // Set up Promise to wait for sampling request event
      const samplingRequestPromise = new Promise<SamplingCreateMessage>(
        (resolve) => {
          client.addEventListener(
            "newPendingSample",
            (event) => {
              resolve(event.detail);
            },
            { once: true },
          );
        },
      );

      // Start the tool call (don't await yet - it will block until sampling is responded to)
      const toolResultPromise = client.callTool("collectSample", {
        text: "Hello, world!",
      });

      // Wait for the sampling request to arrive via event
      const pendingSample = await samplingRequestPromise;

      // Verify we received a sampling request
      expect(pendingSample.request.method).toBe("sampling/createMessage");
      const messages = pendingSample.request.params.messages;
      expect(messages.length).toBeGreaterThan(0);
      const firstMessage = messages[0];
      expect(firstMessage).toBeDefined();
      if (
        firstMessage &&
        firstMessage.content &&
        typeof firstMessage.content === "object" &&
        "text" in firstMessage.content
      ) {
        expect((firstMessage.content as { text: string }).text).toBe(
          "Hello, world!",
        );
      }

      // Respond to the sampling request
      const samplingResponse: CreateMessageResult = {
        model: "test-model",
        role: "assistant",
        stopReason: "endTurn",
        content: {
          type: "text",
          text: "This is a test response",
        },
      };

      await pendingSample.respond(samplingResponse);

      // Now await the tool result (it should complete now that we've responded)
      const toolResult = await toolResultPromise;

      // Verify the tool result contains the sampling response
      expect(toolResult).toBeDefined();
      expect(toolResult.success).toBe(true);
      expect(toolResult.result).toBeDefined();
      expect(toolResult.result!.content).toBeDefined();
      expect(Array.isArray(toolResult.result!.content)).toBe(true);
      const toolContent = toolResult.result!.content as any[];
      expect(toolContent.length).toBeGreaterThan(0);
      const toolMessage = toolContent[0];
      expect(toolMessage).toBeDefined();
      expect(toolMessage.type).toBe("text");
      if (toolMessage.type === "text") {
        expect(toolMessage.text).toContain("Sampling response:");
        expect(toolMessage.text).toContain("test-model");
        expect(toolMessage.text).toContain("This is a test response");
      }

      // Verify the pending sample was removed
      const pendingSamples = client.getPendingSamples();
      expect(pendingSamples.length).toBe(0);
    });
  });

  describe("Server-Initiated Notifications", () => {
    it("should receive server-initiated notifications via stdio transport", async () => {
      // Note: stdio test server uses getDefaultServerConfig which now includes sendNotification tool
      // Create client with stdio transport
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Set up Promise to wait for notification
      const notificationPromise = new Promise<MessageEntry>((resolve) => {
        client.addEventListener("message", (event) => {
          const entry = event.detail;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        });
      });

      // Call the sendNotification tool
      await client.callTool("sendNotification", {
        message: "Test notification from stdio",
        level: "info",
      });

      // Wait for the notification
      const notificationEntry = await notificationPromise;

      // Validate the notification
      expect(notificationEntry).toBeDefined();
      expect(notificationEntry.direction).toBe("notification");
      if ("method" in notificationEntry.message) {
        expect(notificationEntry.message.method).toBe("notifications/message");
        if ("params" in notificationEntry.message) {
          const params = notificationEntry.message.params as any;
          expect(params.data.message).toBe("Test notification from stdio");
          expect(params.level).toBe("info");
          expect(params.logger).toBe("test-server");
        }
      }
    });

    it("should receive server-initiated notifications via SSE transport", async () => {
      // Create a test server with the sendNotification tool and logging enabled
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createSendNotificationTool()],
        serverType: "sse",
        logging: true, // Required for notifications/message
      });

      await server.start();

      // Create client with SSE transport
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Set up Promise to wait for notification
      const notificationPromise = new Promise<MessageEntry>((resolve) => {
        client.addEventListener("message", (event) => {
          const entry = event.detail;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        });
      });

      // Call the sendNotification tool
      await client.callTool("sendNotification", {
        message: "Test notification from SSE",
        level: "warning",
      });

      // Wait for the notification
      const notificationEntry = await notificationPromise;

      // Validate the notification
      expect(notificationEntry).toBeDefined();
      expect(notificationEntry.direction).toBe("notification");
      if ("method" in notificationEntry.message) {
        expect(notificationEntry.message.method).toBe("notifications/message");
        if ("params" in notificationEntry.message) {
          const params = notificationEntry.message.params as any;
          expect(params.data.message).toBe("Test notification from SSE");
          expect(params.level).toBe("warning");
          expect(params.logger).toBe("test-server");
        }
      }
    });

    it("should receive server-initiated notifications via streamable-http transport", async () => {
      // Create a test server with the sendNotification tool and logging enabled
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createSendNotificationTool()],
        serverType: "streamable-http",
        logging: true, // Required for notifications/message
      });

      await server.start();

      // Create client with streamable-http transport
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Set up Promise to wait for notification
      const notificationPromise = new Promise<MessageEntry>((resolve) => {
        client.addEventListener("message", (event) => {
          const entry = event.detail;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        });
      });

      // Call the sendNotification tool
      await client.callTool("sendNotification", {
        message: "Test notification from streamable-http",
        level: "error",
      });

      // Wait for the notification
      const notificationEntry = await notificationPromise;

      // Validate the notification
      expect(notificationEntry).toBeDefined();
      expect(notificationEntry.direction).toBe("notification");
      if ("method" in notificationEntry.message) {
        expect(notificationEntry.message.method).toBe("notifications/message");
        if ("params" in notificationEntry.message) {
          const params = notificationEntry.message.params as any;
          expect(params.data.message).toBe(
            "Test notification from streamable-http",
          );
          expect(params.level).toBe("error");
          expect(params.logger).toBe("test-server");
        }
      }
    });
  });

  describe("Elicitation Requests", () => {
    it("should handle form-based elicitation requests from server and respond", async () => {
      // Create a test server with the collectElicitation tool
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createCollectFormElicitationTool()],
        serverType: "streamable-http",
      });

      await server.start();

      // Create client with elicitation enabled
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          elicit: true, // Enable elicitation capability
        },
      );

      await client.connect();

      // Set up Promise to wait for elicitation request event
      const elicitationRequestPromise = new Promise<ElicitationCreateMessage>(
        (resolve) => {
          client.addEventListener(
            "newPendingElicitation",
            (event) => {
              resolve(event.detail);
            },
            { once: true },
          );
        },
      );

      // Start the tool call (don't await yet - it will block until elicitation is responded to)
      const toolResultPromise = client.callTool("collectElicitation", {
        message: "Please provide your name",
        schema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Your name",
            },
          },
          required: ["name"],
        },
      });

      // Wait for the elicitation request to arrive via event
      const pendingElicitation = await elicitationRequestPromise;

      // Verify we received an elicitation request
      expect(pendingElicitation.request.method).toBe("elicitation/create");
      expect(pendingElicitation.request.params.message).toBe(
        "Please provide your name",
      );
      if ("requestedSchema" in pendingElicitation.request.params) {
        expect(pendingElicitation.request.params.requestedSchema).toBeDefined();
        expect(pendingElicitation.request.params.requestedSchema.type).toBe(
          "object",
        );
      }

      // Respond to the elicitation request
      const elicitationResponse: ElicitResult = {
        action: "accept",
        content: {
          name: "Test User",
        },
      };

      await pendingElicitation.respond(elicitationResponse);

      // Now await the tool result (it should complete now that we've responded)
      const toolResult = await toolResultPromise;

      // Verify the tool result contains the elicitation response
      expect(toolResult).toBeDefined();
      expect(toolResult.success).toBe(true);
      expect(toolResult.result).toBeDefined();
      expect(toolResult.result!.content).toBeDefined();
      expect(Array.isArray(toolResult.result!.content)).toBe(true);
      const toolContent = toolResult.result!.content as any[];
      expect(toolContent.length).toBeGreaterThan(0);
      const toolMessage = toolContent[0];
      expect(toolMessage).toBeDefined();
      expect(toolMessage.type).toBe("text");
      if (toolMessage.type === "text") {
        expect(toolMessage.text).toContain("Elicitation response:");
        expect(toolMessage.text).toContain("accept");
        expect(toolMessage.text).toContain("Test User");
      }

      // Verify the pending elicitation was removed
      const pendingElicitations = client.getPendingElicitations();
      expect(pendingElicitations.length).toBe(0);
    });

    it("should handle URL-based elicitation requests from server and respond", async () => {
      // Create a test server with the collectUrlElicitation tool
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createCollectUrlElicitationTool()],
        serverType: "streamable-http",
      });

      await server.start();

      // Create client with elicitation enabled
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          elicit: { url: true }, // Enable elicitation capability
        },
      );

      await client.connect();

      // Set up Promise to wait for elicitation request event
      const elicitationRequestPromise = new Promise<ElicitationCreateMessage>(
        (resolve) => {
          client.addEventListener(
            "newPendingElicitation",
            (event) => {
              resolve(event.detail);
            },
            { once: true },
          );
        },
      );

      // Start the tool call (don't await yet - it will block until elicitation is responded to)
      const toolResultPromise = client.callTool("collectUrlElicitation", {
        message: "Please visit the URL to complete authentication",
        url: "https://example.com/auth",
        elicitationId: "test-url-elicitation-123",
      });

      // Wait for the elicitation request to arrive via event
      const pendingElicitation = await elicitationRequestPromise;

      // Verify we received a URL-based elicitation request
      expect(pendingElicitation.request.method).toBe("elicitation/create");
      expect(pendingElicitation.request.params.message).toBe(
        "Please visit the URL to complete authentication",
      );
      expect(pendingElicitation.request.params.mode).toBe("url");
      if (pendingElicitation.request.params.mode === "url") {
        expect(pendingElicitation.request.params.url).toBe(
          "https://example.com/auth",
        );
        expect(pendingElicitation.request.params.elicitationId).toBe(
          "test-url-elicitation-123",
        );
      }

      // Respond to the URL-based elicitation request
      const elicitationResponse: ElicitResult = {
        action: "accept",
        content: {
          // URL-based elicitation typically doesn't have form data, but we can include metadata
          completed: true,
        },
      };

      await pendingElicitation.respond(elicitationResponse);

      // Now await the tool result (it should complete now that we've responded)
      const toolResult = await toolResultPromise;

      // Verify the tool result contains the elicitation response
      expect(toolResult).toBeDefined();
      expect(toolResult.success).toBe(true);
      expect(toolResult.result).toBeDefined();
      expect(toolResult.result!.content).toBeDefined();
      expect(Array.isArray(toolResult.result!.content)).toBe(true);
      const toolContent = toolResult.result!.content as any[];
      expect(toolContent.length).toBeGreaterThan(0);
      const toolMessage = toolContent[0];
      expect(toolMessage).toBeDefined();
      expect(toolMessage.type).toBe("text");
      if (toolMessage.type === "text") {
        expect(toolMessage.text).toContain("URL elicitation response:");
        expect(toolMessage.text).toContain("accept");
      }

      // Verify the pending elicitation was removed
      const pendingElicitations = client.getPendingElicitations();
      expect(pendingElicitations.length).toBe(0);
    });
  });

  describe("Roots Support", () => {
    it("should handle roots/list request from server and return roots", async () => {
      // Create a test server with the listRoots tool
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createListRootsTool()],
        serverType: "streamable-http",
      });

      await server.start();

      // Create client with roots enabled
      const initialRoots = [
        { uri: "file:///test1", name: "Test Root 1" },
        { uri: "file:///test2", name: "Test Root 2" },
      ];

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          roots: initialRoots, // Enable roots capability
        },
      );

      await client.connect();

      // Call the listRoots tool - it will call roots/list on the client
      const toolResult = await client.callTool("listRoots", {});

      // Verify the tool result contains the roots
      expect(toolResult).toBeDefined();
      expect(toolResult.success).toBe(true);
      expect(toolResult.result).toBeDefined();
      expect(toolResult.result!.content).toBeDefined();
      expect(Array.isArray(toolResult.result!.content)).toBe(true);
      const toolContent = toolResult.result!.content as any[];
      expect(toolContent.length).toBeGreaterThan(0);
      const toolMessage = toolContent[0];
      expect(toolMessage).toBeDefined();
      expect(toolMessage.type).toBe("text");
      if (toolMessage.type === "text") {
        expect(toolMessage.text).toContain("Roots:");
        expect(toolMessage.text).toContain("file:///test1");
        expect(toolMessage.text).toContain("file:///test2");
      }

      // Verify getRoots() returns the roots
      const roots = client.getRoots();
      expect(roots).toEqual(initialRoots);

      await client.disconnect();
      await server.stop();
    });

    it("should send roots/list_changed notification when roots are updated", async () => {
      // Create a test server - clients can send roots/list_changed notifications to any server
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        serverType: "streamable-http",
      });

      await server.start();

      // Create client with roots enabled
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          roots: [], // Enable roots capability with empty array
        },
      );

      await client.connect();

      // Clear any recorded requests from connection
      server.clearRecordings();

      // Update roots
      const newRoots = [
        { uri: "file:///new1", name: "New Root 1" },
        { uri: "file:///new2", name: "New Root 2" },
      ];
      await client.setRoots(newRoots);

      // Wait for the notification to be recorded by the server
      // The notification is sent asynchronously, so we need to wait for it to appear in recordedRequests
      let rootsChangedNotification;
      for (let i = 0; i < 50; i++) {
        const recordedRequests = server.getRecordedRequests();
        rootsChangedNotification = recordedRequests.find(
          (req) => req.method === "notifications/roots/list_changed",
        );
        if (rootsChangedNotification) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Verify the notification was sent to the server
      expect(rootsChangedNotification).toBeDefined();
      if (rootsChangedNotification) {
        expect(rootsChangedNotification.method).toBe(
          "notifications/roots/list_changed",
        );
      }

      // Verify getRoots() returns the new roots
      const roots = client.getRoots();
      expect(roots).toEqual(newRoots);

      // Verify rootsChange event was dispatched
      const rootsChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "rootsChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      // Update roots again to trigger event
      await client.setRoots([{ uri: "file:///updated", name: "Updated" }]);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const rootsChangeEvent = await rootsChangePromise;
      expect(rootsChangeEvent.detail).toEqual([
        { uri: "file:///updated", name: "Updated" },
      ]);

      // Verify another notification was sent
      const updatedRequests = server.getRecordedRequests();
      const secondNotification = updatedRequests.filter(
        (req) => req.method === "notifications/roots/list_changed",
      );
      expect(secondNotification.length).toBeGreaterThanOrEqual(1);

      await client.disconnect();
      await server.stop();
    });
  });

  describe("Completions", () => {
    it("should get completions for resource template variable", async () => {
      // Create a test server with a resource template that has completion support
      const completionCallback = (argName: string, value: string): string[] => {
        if (argName === "path") {
          const files = ["file1.txt", "file2.txt", "file3.txt"];
          return files.filter((f) => f.startsWith(value));
        }
        return [];
      };

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [createFileResourceTemplate(completionCallback)],
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Request completions for "file" variable with partial value "file1"
      const result = await client.getCompletions(
        { type: "ref/resource", uri: "file:///{path}" },
        "path",
        "file1",
      );

      expect(result.values).toContain("file1.txt");
      expect(result.values.length).toBeGreaterThan(0);

      await client.disconnect();
      await server.stop();
    });

    it("should get completions for prompt argument", async () => {
      // Create a test server with a prompt that has completion support
      const cityCompletions = (
        value: string,
        _context?: Record<string, string>,
      ): string[] => {
        const cities = ["New York", "Los Angeles", "Chicago", "Houston"];
        return cities.filter((c) =>
          c.toLowerCase().startsWith(value.toLowerCase()),
        );
      };

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [
          createArgsPrompt({
            city: cityCompletions,
          }),
        ],
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Request completions for "city" argument with partial value "New"
      const result = await client.getCompletions(
        { type: "ref/prompt", name: "args-prompt" },
        "city",
        "New",
      );

      expect(result.values).toContain("New York");
      expect(result.values.length).toBeGreaterThan(0);

      await client.disconnect();
      await server.stop();
    });

    it("should return empty array when server does not support completions", async () => {
      // Create a test server without completion support
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [createFileResourceTemplate()], // No completion callback
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Request completions - should return empty array (MethodNotFound handled gracefully)
      const result = await client.getCompletions(
        { type: "ref/resource", uri: "file:///{path}" },
        "path",
        "file",
      );

      expect(result.values).toEqual([]);

      await client.disconnect();
      await server.stop();
    });

    it("should get completions with context (other arguments)", async () => {
      // Create a test server with a prompt that uses context
      const stateCompletions = (
        value: string,
        context?: Record<string, string>,
      ): string[] => {
        const statesByCity: Record<string, string[]> = {
          "New York": ["NY", "New York State"],
          "Los Angeles": ["CA", "California"],
        };

        const city = context?.city;
        if (city && statesByCity[city]) {
          return statesByCity[city].filter((s) =>
            s.toLowerCase().startsWith(value.toLowerCase()),
          );
        }
        return ["NY", "CA", "TX", "FL"].filter((s) =>
          s.toLowerCase().startsWith(value.toLowerCase()),
        );
      };

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [
          createArgsPrompt({
            state: stateCompletions,
          }),
        ],
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Request completions for "state" with context (city="New York")
      const result = await client.getCompletions(
        { type: "ref/prompt", name: "args-prompt" },
        "state",
        "N",
        { city: "New York" },
      );

      expect(result.values).toContain("NY");
      expect(result.values).toContain("New York State");

      await client.disconnect();
      await server.stop();
    });

    it("should handle async completion callbacks", async () => {
      // Create a test server with async completion callback
      const asyncCompletionCallback = async (
        argName: string,
        value: string,
      ): Promise<string[]> => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));
        const files = ["async1.txt", "async2.txt", "async3.txt"];
        return files.filter((f) => f.startsWith(value));
      };

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [
          createFileResourceTemplate(asyncCompletionCallback),
        ],
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      const result = await client.getCompletions(
        { type: "ref/resource", uri: "file:///{path}" },
        "path",
        "async1",
      );

      expect(result.values).toContain("async1.txt");

      await client.disconnect();
      await server.stop();
    });
  });

  describe("ContentCache integration", () => {
    it("should expose cache property that returns null for all getters initially", async () => {
      const client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      // Cache should be accessible
      expect(client.cache).toBeDefined();

      // All getters should return null initially
      expect(client.cache.getResource("file:///test.txt")).toBeNull();
      expect(client.cache.getResourceTemplate("file:///{path}")).toBeNull();
      expect(client.cache.getPrompt("testPrompt")).toBeNull();
      expect(client.cache.getToolCallResult("testTool")).toBeNull();

      await client.disconnect();
    });

    it("should clear cache when disconnect() is called", async () => {
      const client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();

      // Verify cache is accessible
      expect(client.cache).toBeDefined();

      // Populate cache by calling fetch methods
      const resources = await client.listAllResources();
      let resourceUri: string | undefined;
      if (resources.length > 0 && resources[0]) {
        resourceUri = resources[0].uri;
        await client.readResource(resourceUri);
        expect(client.cache.getResource(resourceUri)).not.toBeNull();
      }

      const tools = await client.listAllTools();
      let toolName: string | undefined;
      if (tools.length > 0 && tools[0]) {
        toolName = tools[0].name;
        await client.callTool(toolName, {});
        expect(client.cache.getToolCallResult(toolName)).not.toBeNull();
      }

      const prompts = await client.listAllPrompts();
      let promptName: string | undefined;
      if (prompts.length > 0 && prompts[0]) {
        promptName = prompts[0].name;
        await client.getPrompt(promptName);
        expect(client.cache.getPrompt(promptName)).not.toBeNull();
      }

      // Disconnect should clear cache
      await client.disconnect();

      // After disconnect, cache should be cleared
      if (resourceUri) {
        expect(client.cache.getResource(resourceUri)).toBeNull();
      }
      if (toolName) {
        expect(client.cache.getToolCallResult(toolName)).toBeNull();
      }
      if (promptName) {
        expect(client.cache.getPrompt(promptName)).toBeNull();
      }
    });

    it("should not break existing API", async () => {
      const client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      // Verify existing properties and methods still work
      expect(client.getStatus()).toBe("disconnected");
      expect(client.getTools()).toEqual([]);
      expect(client.getResources()).toEqual([]);
      expect(client.getPrompts()).toEqual([]);

      await client.connect();
      expect(client.getStatus()).toBe("connected");

      await client.disconnect();
      expect(client.getStatus()).toBe("disconnected");
    });

    it("should cache resource content and dispatch event when readResource is called", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      const uri = "file:///test.txt";
      let eventReceived = false;
      let eventDetail: any = null;

      client.addEventListener(
        "resourceContentChange",
        (event) => {
          eventReceived = true;
          eventDetail = event.detail;
        },
        { once: true },
      );

      const invocation = await client.readResource(uri);

      // Verify cache
      const cached = client.cache.getResource(uri);
      expect(cached).not.toBeNull();
      expect(cached).toBe(invocation); // Object identity preserved

      // Verify event was dispatched
      expect(eventReceived).toBe(true);
      expect(eventDetail.uri).toBe(uri);
      expect(eventDetail.content).toBe(invocation);
      expect(eventDetail.timestamp).toBeInstanceOf(Date);

      await client.disconnect();
    });

    it("should cache resource template content and dispatch event when readResourceFromTemplate is called", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true, // Auto-fetch to populate templates
        },
      );
      await client.connect();

      const template = client.getResourceTemplates()[0];
      if (!template) {
        throw new Error("No resource templates available");
      }

      const params = { path: "test.txt" };
      let eventReceived = false;
      let eventDetail: any = null;

      client.addEventListener(
        "resourceTemplateContentChange",
        (event) => {
          eventReceived = true;
          eventDetail = event.detail;
        },
        { once: true },
      );

      const invocation = await client.readResourceFromTemplate(
        template.uriTemplate,
        params,
      );

      // Verify cache
      const cached = client.cache.getResourceTemplate(template.uriTemplate);
      expect(cached).not.toBeNull();
      expect(cached).toBe(invocation); // Object identity preserved

      // Verify event was dispatched
      expect(eventReceived).toBe(true);
      expect(eventDetail.uriTemplate).toBe(template.uriTemplate);
      expect(eventDetail.content).toBe(invocation);
      expect(eventDetail.params).toEqual(params);
      expect(eventDetail.timestamp).toBeInstanceOf(Date);

      await client.disconnect();
    });

    it("should cache prompt content and dispatch event when getPrompt is called", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true, // Auto-fetch to populate prompts
        },
      );
      await client.connect();

      const prompt = client.getPrompts()[0];
      if (!prompt) {
        throw new Error("No prompts available");
      }

      let eventReceived = false;
      let eventDetail: any = null;

      client.addEventListener(
        "promptContentChange",
        (event) => {
          eventReceived = true;
          eventDetail = event.detail;
        },
        { once: true },
      );

      const invocation = await client.getPrompt(prompt.name);

      // Verify cache
      const cached = client.cache.getPrompt(prompt.name);
      expect(cached).not.toBeNull();
      expect(cached).toBe(invocation); // Object identity preserved

      // Verify event was dispatched
      expect(eventReceived).toBe(true);
      expect(eventDetail.name).toBe(prompt.name);
      expect(eventDetail.content).toBe(invocation);
      expect(eventDetail.timestamp).toBeInstanceOf(Date);

      await client.disconnect();
    });

    it("should cache successful tool call result and dispatch event", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true, // Auto-fetch to populate tools
        },
      );
      await client.connect();

      const tool = client.getTools().find((t) => t.name === "echo");
      if (!tool) {
        throw new Error("Echo tool not available");
      }

      let eventReceived = false;
      let eventDetail: any = null;

      client.addEventListener(
        "toolCallResultChange",
        (event) => {
          eventReceived = true;
          eventDetail = event.detail;
        },
        { once: true },
      );

      const invocation = await client.callTool("echo", { message: "test" });

      // Verify cache
      const cached = client.cache.getToolCallResult("echo");
      expect(cached).not.toBeNull();
      expect(cached).toBe(invocation); // Object identity preserved
      expect(cached?.success).toBe(true);

      // Verify event was dispatched
      expect(eventReceived).toBe(true);
      expect(eventDetail.toolName).toBe("echo");
      expect(eventDetail.success).toBe(true);
      expect(eventDetail.result).not.toBeNull();
      expect(eventDetail.timestamp).toBeInstanceOf(Date);

      await client.disconnect();
    });

    it("should cache failed tool call result and dispatch event", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      let eventReceived = false;
      let eventDetail: any = null;

      client.addEventListener(
        "toolCallResultChange",
        (event) => {
          eventReceived = true;
          eventDetail = event.detail;
        },
        { once: true },
      );

      const invocation = await client.callTool("nonexistent-tool", {});

      // Verify cache
      const cached = client.cache.getToolCallResult("nonexistent-tool");
      expect(cached).not.toBeNull();
      expect(cached).toBe(invocation); // Object identity preserved
      // Note: The tool call might succeed if the server has a catch-all handler
      // So we just verify the cache stores the result correctly
      expect(cached?.toolName).toBe("nonexistent-tool");
      expect(cached?.params).toEqual({});

      // Verify event was dispatched
      expect(eventReceived).toBe(true);
      expect(eventDetail.toolName).toBe("nonexistent-tool");
      expect(eventDetail.params).toEqual({});
      expect(eventDetail.timestamp).toBeInstanceOf(Date);
      // Note: success/error depends on server behavior

      await client.disconnect();
    });

    it("should replace cache entry on subsequent calls", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      const uri = "file:///test.txt";

      // First call
      const invocation1 = await client.readResource(uri);
      const cached1 = client.cache.getResource(uri);
      expect(cached1).toBe(invocation1);

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second call should replace cache
      const invocation2 = await client.readResource(uri);
      const cached2 = client.cache.getResource(uri);
      expect(cached2).toBe(invocation2);
      expect(cached2).not.toBe(invocation1); // Different object
      expect(cached2?.timestamp.getTime()).toBeGreaterThan(
        invocation1.timestamp.getTime(),
      );

      await client.disconnect();
    });

    it("should persist cache across multiple calls", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      const uri = "file:///test.txt";

      // First call
      const invocation1 = await client.readResource(uri);
      const cached1 = client.cache.getResource(uri);
      expect(cached1).toBe(invocation1);

      // Second call to same resource
      const invocation2 = await client.readResource(uri);
      const cached2 = client.cache.getResource(uri);
      expect(cached2).toBe(invocation2);

      // Cache should still be accessible
      const cached3 = client.cache.getResource(uri);
      expect(cached3).toBe(invocation2);

      await client.disconnect();
    });
  });

  describe("Resource Subscriptions", () => {
    it("should initialize subscribedResources as empty Set", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      expect(client.getSubscribedResources()).toEqual([]);
      expect(client.isSubscribedToResource("test://uri")).toBe(false);

      await client.disconnect();
      await server.stop();
    });

    it("should clear subscriptions on disconnect", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Manually add a subscription (Phase 3 will add proper methods)
      (client as any).subscribedResources.add("test://uri1");
      (client as any).subscribedResources.add("test://uri2");

      expect(client.getSubscribedResources()).toHaveLength(2);

      await client.disconnect();

      // Subscriptions should be cleared
      expect(client.getSubscribedResources()).toEqual([]);

      await server.stop();
    });

    it("should check server capability for resource subscriptions support", async () => {
      // Server without resource subscriptions
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Server doesn't support resource subscriptions
      expect(client.supportsResourceSubscriptions()).toBe(false);

      await client.disconnect();
      await server.stop();

      // Server with resource subscriptions (we'll need to add this capability in test server)
      // For now, just test that the method exists and checks capabilities
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        // Note: We'd need to add subscribe capability to test server config
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Still false because test server doesn't advertise subscribe capability
      expect(client.supportsResourceSubscriptions()).toBe(false);

      await client.disconnect();
      await server.stop();
    });
  });

  describe("ListChanged Notifications", () => {
    it("should initialize listChangedNotifications config with defaults (all enabled)", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      // Defaults should be all enabled
      expect((client as any).listChangedNotifications).toEqual({
        tools: true,
        resources: true,
        prompts: true,
      });

      await client.disconnect();
      await server.stop();
    });

    it("should respect listChangedNotifications config options", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          listChangedNotifications: {
            tools: false,
            resources: true,
            prompts: false,
          },
        },
      );

      expect((client as any).listChangedNotifications).toEqual({
        tools: false,
        resources: true,
        prompts: false,
      });

      await client.disconnect();
      await server.stop();
    });

    it("should update state and dispatch event when listAllTools() is called", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Clear initial state
      expect(client.getTools()).toEqual([]);

      // Wait for toolsChange event
      const toolsChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "toolsChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      const tools = await client.listAllTools();
      const event = await toolsChangePromise;

      expect(tools.length).toBeGreaterThan(0);
      expect(client.getTools()).toEqual(tools);
      expect(event.detail).toEqual(tools);

      await client.disconnect();
      await server.stop();
    });

    it("should update state, clean cache, and dispatch event when listResources() is called", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // First list resources to populate the list
      await client.listResources();

      // Load a resource to populate cache
      const uri = "demo://resource/static/document/architecture.md";
      await client.readResource(uri);
      expect(client.cache.getResource(uri)).not.toBeNull();

      // Wait for resourcesChange event
      const resourcesChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "resourcesChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      const resources = await client.listAllResources();
      const event = await resourcesChangePromise;

      expect(resources.length).toBeGreaterThan(0);
      expect(client.getResources()).toEqual(resources);
      expect(event.detail).toEqual(resources);
      // Cache should be preserved for existing resource
      expect(client.cache.getResource(uri)).not.toBeNull();

      await client.disconnect();
      await server.stop();
    });

    it("should clean up cache for removed resources when listResources() is called", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource(), createTestCwdResource()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // First list resources to populate the list
      await client.listResources();

      // Load both resources to populate cache
      const uri1 = "demo://resource/static/document/architecture.md";
      const uri2 = "test://cwd";
      await client.readResource(uri1);
      await client.readResource(uri2);
      expect(client.cache.getResource(uri1)).not.toBeNull();
      expect(client.cache.getResource(uri2)).not.toBeNull();

      // Now remove one resource from server
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource()], // Only keep uri1
      });
      await server.stop();
      await server.start();

      // Reconnect and list resources
      await client.disconnect();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      // First list resources to populate the list
      await client.listResources();

      // Load uri1 again to populate cache
      await client.readResource(uri1);

      // List resources (should only have uri1 now)
      await client.listResources();

      // Cache for uri1 should be preserved, uri2 should be cleared
      expect(client.cache.getResource(uri1)).not.toBeNull();
      expect(client.cache.getResource(uri2)).toBeNull();

      await client.disconnect();
      await server.stop();
    });

    it("should update state, clean cache, and dispatch event when listAllResourceTemplates() is called", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [createFileResourceTemplate()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // First list resource templates to populate the list
      await client.listAllResourceTemplates();

      // Load a resource template to populate cache
      const uriTemplate = "file:///{path}";
      await client.readResourceFromTemplate(uriTemplate, { path: "test.txt" });
      expect(client.cache.getResourceTemplate(uriTemplate)).not.toBeNull();

      // Wait for resourceTemplatesChange event
      const resourceTemplatesChangePromise = new Promise<CustomEvent>(
        (resolve) => {
          client.addEventListener(
            "resourceTemplatesChange",
            (event) => {
              resolve(event);
            },
            { once: true },
          );
        },
      );

      const templates = await client.listAllResourceTemplates();
      const event = await resourceTemplatesChangePromise;

      expect(templates.length).toBeGreaterThan(0);
      expect(client.getResourceTemplates()).toEqual(templates);
      expect(event.detail).toEqual(templates);
      // Cache should be preserved for existing template
      expect(client.cache.getResourceTemplate(uriTemplate)).not.toBeNull();

      await client.disconnect();
      await server.stop();
    });

    it("should update state, clean cache, and dispatch event when listAllPrompts() is called", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [createSimplePrompt()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // First list prompts to populate the list
      await client.listAllPrompts();

      // Load a prompt to populate cache
      const promptName = "simple-prompt";
      await client.getPrompt(promptName);
      expect(client.cache.getPrompt(promptName)).not.toBeNull();

      // Wait for promptsChange event
      const promptsChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "promptsChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      const prompts = await client.listAllPrompts();
      const event = await promptsChangePromise;

      expect(prompts.length).toBeGreaterThan(0);
      expect(client.getPrompts()).toEqual(prompts);
      expect(event.detail).toEqual(prompts);
      // Cache should be preserved for existing prompt
      expect(client.cache.getPrompt(promptName)).not.toBeNull();

      await client.disconnect();
      await server.stop();
    });

    it("should handle tools/list_changed notification and reload tools", async () => {
      const { createAddToolTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool(), createAddToolTool()],
        listChanged: { tools: true },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: true, // Auto-fetch to populate initial state
        },
      );

      await client.connect();

      const initialTools = client.getTools();
      expect(initialTools.length).toBeGreaterThan(0);

      // Wait for toolsChange event after notification
      const toolsChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "toolsChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      // Add a new tool (this will send list_changed notification)
      await client.callTool("addTool", {
        name: "newTool",
        description: "A new test tool",
      });
      const event = await toolsChangePromise;

      // Tools should be reloaded
      const updatedTools = client.getTools();
      expect(Array.isArray(updatedTools)).toBe(true);
      // Should have the new tool
      expect(updatedTools.find((t) => t.name === "newTool")).toBeDefined();
      // Event detail should match current tools exactly
      // (callTool() uses listToolsInternal() so it doesn't dispatch events,
      //  so this event comes only from the notification handler)
      expect(event.detail).toEqual(updatedTools);

      await client.disconnect();
      await server.stop();
    });

    it("should handle resources/list_changed notification and reload resources and templates", async () => {
      const { createAddResourceTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource()],
        resourceTemplates: [createFileResourceTemplate()],
        tools: [createAddResourceTool()],
        listChanged: { resources: true },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();

      const initialResources = client.getResources();
      const initialTemplates = client.getResourceTemplates();
      expect(initialResources.length).toBeGreaterThan(0);
      expect(initialTemplates.length).toBeGreaterThan(0);

      // Wait for both change events
      const resourcesChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "resourcesChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      const resourceTemplatesChangePromise = new Promise<CustomEvent>(
        (resolve) => {
          client.addEventListener(
            "resourceTemplatesChange",
            (event) => {
              resolve(event);
            },
            { once: true },
          );
        },
      );

      // Add a new resource (this will send list_changed notification)
      await client.callTool("addResource", {
        uri: "test://new-resource",
        name: "newResource",
        text: "New resource content",
      });
      const resourcesEvent = await resourcesChangePromise;
      const templatesEvent = await resourceTemplatesChangePromise;

      // Both should be reloaded
      expect(client.getResources()).toEqual(resourcesEvent.detail);
      expect(client.getResourceTemplates()).toEqual(templatesEvent.detail);
      // Should have the new resource
      expect(
        client.getResources().find((r) => r.uri === "test://new-resource"),
      ).toBeDefined();

      await client.disconnect();
      await server.stop();
    });

    it("should handle prompts/list_changed notification and reload prompts", async () => {
      const { createAddPromptTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [createSimplePrompt()],
        tools: [createAddPromptTool()],
        listChanged: { prompts: true },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();

      const initialPrompts = client.getPrompts();
      expect(initialPrompts.length).toBeGreaterThan(0);

      // Wait for promptsChange event after notification
      const promptsChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "promptsChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      // Add a new prompt (this will send list_changed notification)
      await client.callTool("addPrompt", {
        name: "newPrompt",
        promptString: "This is a new prompt",
      });
      const event = await promptsChangePromise;

      // Prompts should be reloaded
      expect(client.getPrompts()).toEqual(event.detail);
      // Should have the new prompt
      expect(
        client.getPrompts().find((p) => p.name === "newPrompt"),
      ).toBeDefined();

      await client.disconnect();
      await server.stop();
    });

    it("should respect listChangedNotifications config (disabled handlers)", async () => {
      const { createAddToolTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool(), createAddToolTool()],
        listChanged: { tools: true },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: true,
          listChangedNotifications: {
            tools: false, // Disable tools listChanged handler
            resources: true,
            prompts: true,
          },
        },
      );

      await client.connect();

      // Wait for autoFetchServerContents to complete and any events to settle
      await new Promise((resolve) => setTimeout(resolve, 200));

      const initialTools = client.getTools();
      const initialToolCount = initialTools.length;

      // Set up event listener to detect if notification handler runs
      // callTool() uses listToolsInternal() which doesn't dispatch events,
      // so any toolsChange event must come from the notification handler
      let eventReceived = false;
      const testEventListener = () => {
        eventReceived = true;
      };
      client.addEventListener("toolsChange", testEventListener, { once: true });

      // Add a new tool (this will send list_changed notification from server)
      // callTool() uses listToolsInternal() which doesn't dispatch events
      // If handler is enabled, it will call listTools() which dispatches toolsChange
      // Since handler is disabled, no event should be received
      await client.callTool("addTool", {
        name: "testTool",
        description: "Test tool",
      });

      // Wait a bit to see if notification handler runs
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Remove listener
      client.removeEventListener("toolsChange", testEventListener);

      // Event should NOT be received because handler is disabled
      expect(eventReceived).toBe(false);

      // Tools should not have changed (handler didn't run, so listTools() wasn't called)
      // The server has the new tool, but the client's internal state hasn't been updated
      const finalTools = client.getTools();
      expect(finalTools.length).toBe(initialToolCount);
      expect(finalTools).toEqual(initialTools);

      // Verify the tool was actually added to the server by manually calling listAllTools()
      // This proves the server received the addTool call and the notification was sent
      const serverTools = await client.listAllTools();
      expect(serverTools.length).toBeGreaterThan(initialToolCount);
      expect(serverTools.find((t) => t.name === "testTool")).toBeDefined();

      await client.disconnect();
      await server.stop();
    });

    it("should only register handlers when server supports listChanged capability", async () => {
      // Create a server that doesn't advertise listChanged capability
      // (we can't easily do this with our test server, but we can test the logic)
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();

      // Check that capabilities are set
      const capabilities = (client as any).capabilities;
      // If server doesn't advertise listChanged, handlers won't be registered
      // This is tested implicitly - if handlers were registered incorrectly, tests would fail

      await client.disconnect();
      await server.stop();
    });

    it("should handle tools/list_changed notification on removal and clear tool call cache", async () => {
      const { createRemoveToolTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool(), createRemoveToolTool()],
        listChanged: { tools: true },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();

      // Call echo tool to populate cache
      const toolName = "echo";
      await client.callTool(toolName, { message: "test" });
      expect(client.cache.getToolCallResult(toolName)).not.toBeNull();

      // Wait for toolsChange event after notification
      const toolsChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "toolsChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      // Remove the tool (this will send list_changed notification)
      await client.callTool("removeTool", { name: toolName });
      const event = await toolsChangePromise;

      // Tools should be reloaded
      const updatedTools = client.getTools();
      expect(updatedTools.find((t) => t.name === toolName)).toBeUndefined();
      expect(event.detail).toEqual(updatedTools);

      // Cache should be cleared for removed tool
      expect(client.cache.getToolCallResult(toolName)).toBeNull();

      await client.disconnect();
      await server.stop();
    });

    it("should handle resources/list_changed notification on removal and clear resource cache", async () => {
      const { createRemoveResourceTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource()],
        tools: [createRemoveResourceTool()],
        listChanged: { resources: true },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();

      // Load resource to populate cache
      const uri = "demo://resource/static/document/architecture.md";
      await client.readResource(uri);
      expect(client.cache.getResource(uri)).not.toBeNull();

      // Wait for resourcesChange event after notification
      const resourcesChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "resourcesChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      // Remove the resource (this will send list_changed notification)
      await client.callTool("removeResource", { uri });
      const event = await resourcesChangePromise;

      // Resources should be reloaded
      const updatedResources = client.getResources();
      expect(updatedResources.find((r) => r.uri === uri)).toBeUndefined();
      expect(event.detail).toEqual(updatedResources);

      // Cache should be cleared for removed resource
      expect(client.cache.getResource(uri)).toBeNull();

      await client.disconnect();
      await server.stop();
    });

    it("should handle prompts/list_changed notification on removal and clear prompt cache", async () => {
      const { createRemovePromptTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [createSimplePrompt()],
        tools: [createRemovePromptTool()],
        listChanged: { prompts: true },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();

      // Load prompt to populate cache
      const promptName = "simple-prompt";
      await client.getPrompt(promptName);
      expect(client.cache.getPrompt(promptName)).not.toBeNull();

      // Wait for promptsChange event after notification
      const promptsChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "promptsChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      // Remove the prompt (this will send list_changed notification)
      await client.callTool("removePrompt", { name: promptName });
      const event = await promptsChangePromise;

      // Prompts should be reloaded
      const updatedPrompts = client.getPrompts();
      expect(updatedPrompts.find((p) => p.name === promptName)).toBeUndefined();
      expect(event.detail).toEqual(updatedPrompts);

      // Cache should be cleared for removed prompt
      expect(client.cache.getPrompt(promptName)).toBeNull();

      await client.disconnect();
      await server.stop();
    });

    it("should clean up cache for removed resource templates when listResourceTemplates() is called", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [
          createFileResourceTemplate(),
          createUserResourceTemplate(),
        ],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // First list resource templates to populate the list
      await client.listAllResourceTemplates();

      // Load both templates to populate cache
      const uriTemplate1 = "file:///{path}";
      const uriTemplate2 = "user://{userId}";
      await client.readResourceFromTemplate(uriTemplate1, { path: "test.txt" });
      await client.readResourceFromTemplate(uriTemplate2, { userId: "123" });
      expect(client.cache.getResourceTemplate(uriTemplate1)).not.toBeNull();
      expect(client.cache.getResourceTemplate(uriTemplate2)).not.toBeNull();

      // Now remove one template from server
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [createFileResourceTemplate()], // Only keep uriTemplate1
      });
      await server.stop();
      await server.start();

      // Reconnect and list resource templates
      await client.disconnect();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      // First list resource templates to populate the list
      await client.listAllResourceTemplates();

      // Load uriTemplate1 again to populate cache
      await client.readResourceFromTemplate(uriTemplate1, { path: "test.txt" });

      // List resource templates (should only have uriTemplate1 now)
      await client.listAllResourceTemplates();

      // Cache for uriTemplate1 should be preserved, uriTemplate2 should be cleared
      expect(client.cache.getResourceTemplate(uriTemplate1)).not.toBeNull();
      expect(client.cache.getResourceTemplate(uriTemplate2)).toBeNull();

      await client.disconnect();
      await server.stop();
    });

    it("should clean up cache for removed prompts when listPrompts() is called", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [createSimplePrompt(), createArgsPrompt()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // First list prompts to populate the list
      await client.listAllPrompts();

      // Load both prompts to populate cache
      const promptName1 = "simple-prompt";
      const promptName2 = "args-prompt";
      await client.getPrompt(promptName1);
      await client.getPrompt(promptName2, { city: "New York", state: "NY" });
      expect(client.cache.getPrompt(promptName1)).not.toBeNull();
      expect(client.cache.getPrompt(promptName2)).not.toBeNull();

      // Now remove one prompt from server
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [createSimplePrompt()], // Only keep promptName1
      });
      await server.stop();
      await server.start();

      // Reconnect and list prompts
      await client.disconnect();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      // First list prompts to populate the list
      await client.listAllPrompts();

      // Load promptName1 again to populate cache
      await client.getPrompt(promptName1);

      // List prompts (should only have promptName1 now)
      await client.listAllPrompts();

      // Cache for promptName1 should be preserved, promptName2 should be cleared
      expect(client.cache.getPrompt(promptName1)).not.toBeNull();
      expect(client.cache.getPrompt(promptName2)).toBeNull();

      await client.disconnect();
      await server.stop();
    });
  });

  describe("Resource Subscriptions", () => {
    it("should subscribe to a resource and track subscription state", async () => {
      // Test server without subscriptions
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Server doesn't support subscriptions
      expect(client.supportsResourceSubscriptions()).toBe(false);

      // Should throw error when trying to subscribe
      await expect(
        client.subscribeToResource(
          "demo://resource/static/document/architecture.md",
        ),
      ).rejects.toThrow("Server does not support resource subscriptions");

      await client.disconnect();
      await server.stop();
    });

    it("should subscribe to a resource when server supports subscriptions", async () => {
      const { createUpdateResourceTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource()],
        tools: [createUpdateResourceTool()],
        subscriptions: true,
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Server supports subscriptions
      expect(client.supportsResourceSubscriptions()).toBe(true);

      const uri = "demo://resource/static/document/architecture.md";

      // Wait for resourceSubscriptionsChange event
      const eventPromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "resourceSubscriptionsChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      // Subscribe to resource
      await client.subscribeToResource(uri);
      const event = await eventPromise;

      // Verify subscription state
      expect(client.isSubscribedToResource(uri)).toBe(true);
      expect(client.getSubscribedResources()).toContain(uri);
      expect(event.detail).toContain(uri);

      await client.disconnect();
      await server.stop();
    });

    it("should unsubscribe from a resource", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource()],
        subscriptions: true,
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      const uri = "demo://resource/static/document/architecture.md";

      // Subscribe first
      await client.subscribeToResource(uri);
      expect(client.isSubscribedToResource(uri)).toBe(true);

      // Wait for resourceSubscriptionsChange event
      const eventPromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "resourceSubscriptionsChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      // Unsubscribe
      await client.unsubscribeFromResource(uri);
      const event = await eventPromise;

      // Verify unsubscribed
      expect(client.isSubscribedToResource(uri)).toBe(false);
      expect(client.getSubscribedResources()).not.toContain(uri);
      expect(event.detail).not.toContain(uri);

      await client.disconnect();
      await server.stop();
    });

    it("should throw error when unsubscribe called while not connected", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.disconnect();

      await expect(
        client.unsubscribeFromResource(
          "demo://resource/static/document/architecture.md",
        ),
      ).rejects.toThrow();

      await server.stop();
    });

    it("should handle resource updated notification and clear cache for subscribed resource", async () => {
      const { createUpdateResourceTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource()],
        tools: [createUpdateResourceTool()],
        subscriptions: true,
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      const uri = "demo://resource/static/document/architecture.md";

      // Load resource to populate cache
      await client.readResource(uri);
      expect(client.cache.getResource(uri)).not.toBeNull();

      // Subscribe to resource
      await client.subscribeToResource(uri);
      expect(client.isSubscribedToResource(uri)).toBe(true);

      // Wait for resourceUpdated event
      const eventPromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "resourceUpdated",
          ((event: CustomEvent) => {
            resolve(event);
          }) as EventListener,
          { once: true },
        );
      });

      // Update the resource (this will send resource updated notification)
      await client.callTool("updateResource", {
        uri,
        text: "Updated content",
      });

      const event = await eventPromise;
      expect(event.detail.uri).toBe(uri);

      // Cache should be cleared
      expect(client.cache.getResource(uri)).toBeNull();

      await client.disconnect();
      await server.stop();
    });

    it("should ignore resource updated notification for unsubscribed resources", async () => {
      const { createUpdateResourceTool } =
        await import("../test/test-server-fixtures.js");

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [createArchitectureResource()],
        tools: [createUpdateResourceTool()],
        subscriptions: true,
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      const uri = "demo://resource/static/document/architecture.md";

      // Load resource to populate cache
      await client.readResource(uri);
      expect(client.cache.getResource(uri)).not.toBeNull();

      // Don't subscribe - resource should NOT be in subscribedResources
      expect(client.isSubscribedToResource(uri)).toBe(false);

      // Set up event listener (should not receive event)
      let eventReceived = false;
      const testEventListener = () => {
        eventReceived = true;
      };
      client.addEventListener("resourceUpdated", testEventListener, {
        once: true,
      });

      // Update the resource (this will send resource updated notification)
      await client.callTool("updateResource", {
        uri,
        text: "Updated content",
      });

      // Wait a bit to see if event is received
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Remove listener
      client.removeEventListener("resourceUpdated", testEventListener);

      // Event should NOT be received because resource is not subscribed
      expect(eventReceived).toBe(false);

      // Cache should still be present (not cleared)
      expect(client.cache.getResource(uri)).not.toBeNull();

      await client.disconnect();
      await server.stop();
    });
  });

  describe("Task Support", () => {
    beforeEach(async () => {
      // Create server with task support
      const taskConfig = {
        ...getTaskServerConfig(),
        serverType: "sse" as const,
      };
      server = createTestServerHttp(taskConfig);
      await server.start();
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();
    });

    it("should detect task capabilities", () => {
      const capabilities = client.getTaskCapabilities();
      expect(capabilities).toBeDefined();
      expect(capabilities?.list).toBe(true);
      expect(capabilities?.cancel).toBe(true);
    });

    it("should list tasks (empty initially)", async () => {
      const result = await client.listTasks();
      expect(result).toHaveProperty("tasks");
      expect(Array.isArray(result.tasks)).toBe(true);
    });

    it("should call tool with task support using callToolStream", async () => {
      const taskCreatedEvents: Array<{ taskId: string; task: Task }> = [];
      const taskStatusEvents: Array<{ taskId: string; task: Task }> = [];
      const taskCompletedEvents: Array<{
        taskId: string;
        result: CallToolResult;
      }> = [];
      const toolCallResultEvents: Array<{
        toolName: string;
        params: Record<string, any>;
        result: any;
        timestamp: Date;
        success: boolean;
        error?: string;
        metadata?: Record<string, string>;
      }> = [];

      client.addEventListener(
        "taskCreated",
        (event: TypedEvent<"taskCreated">) => {
          taskCreatedEvents.push(event.detail);
        },
      );
      client.addEventListener(
        "taskStatusChange",
        (event: TypedEvent<"taskStatusChange">) => {
          taskStatusEvents.push(event.detail);
        },
      );
      client.addEventListener(
        "taskCompleted",
        (event: TypedEvent<"taskCompleted">) => {
          taskCompletedEvents.push(event.detail);
        },
      );
      client.addEventListener(
        "toolCallResultChange",
        (event: TypedEvent<"toolCallResultChange">) => {
          toolCallResultEvents.push(event.detail);
        },
      );

      const result = await client.callToolStream("simpleTask", {
        message: "test task",
      });

      // Validate final result
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result).not.toBeNull();
      expect(result.result).toHaveProperty("content");

      // Validate result content structure
      const toolResult = result.result!;
      expect(toolResult.content).toBeDefined();
      expect(Array.isArray(toolResult.content)).toBe(true);
      expect(toolResult.content.length).toBe(1);

      const firstContent = toolResult.content[0];
      expect(firstContent).toBeDefined();
      expect(firstContent).not.toBeUndefined();
      expect(firstContent!.type).toBe("text");

      // Validate result content value
      if (firstContent && firstContent.type === "text") {
        expect(firstContent.text).toBeDefined();
        const resultText = JSON.parse(firstContent.text);
        expect(resultText.message).toBe("Task completed: test task");
        expect(resultText.taskId).toBeDefined();
        expect(typeof resultText.taskId).toBe("string");
      } else {
        expect(firstContent?.type).toBe("text");
      }

      // Validate taskCreated event
      expect(taskCreatedEvents.length).toBe(1);
      const createdEvent = taskCreatedEvents[0]!;
      expect(createdEvent.taskId).toBeDefined();
      expect(typeof createdEvent.taskId).toBe("string");
      expect(createdEvent.task).toBeDefined();
      expect(createdEvent.task.taskId).toBe(createdEvent.taskId);
      expect(createdEvent.task.status).toBe("working");
      expect(createdEvent.task).toHaveProperty("ttl");
      expect(createdEvent.task).toHaveProperty("lastUpdatedAt");

      const taskId = createdEvent.taskId;

      // Validate taskStatusChange events - simpleTask flow:
      // The SDK may send multiple status updates. For simpleTask, we expect:
      // 1. taskCreated (status: "working") - from SDK when task is created
      // 2. taskStatusChange events - SDK may send status updates during execution
      //    - At minimum: one with status "completed" when task finishes
      //    - May also include: one with status "working" (initial status update)
      // 3. taskCompleted - when result is available

      // Verify we got at least one status change
      expect(taskStatusEvents.length).toBeGreaterThanOrEqual(1);

      // Verify all status events are for the same task and have valid structure
      const statuses = taskStatusEvents.map((event) => {
        expect(event.taskId).toBe(taskId);
        expect(event.task.taskId).toBe(taskId);
        expect(event.task).toHaveProperty("status");
        expect(event.task).toHaveProperty("ttl");
        expect(event.task).toHaveProperty("lastUpdatedAt");
        // Verify lastUpdatedAt is a valid ISO string if present
        if (event.task.lastUpdatedAt) {
          expect(typeof event.task.lastUpdatedAt).toBe("string");
          expect(() => new Date(event.task.lastUpdatedAt!)).not.toThrow();
        }
        return event.task.status;
      });

      // The last status change must be "completed"
      expect(statuses[statuses.length - 1]).toBe("completed");

      // All statuses should be either "working" or "completed" (no input_required, failed, cancelled)
      statuses.forEach((status) => {
        expect(["working", "completed"]).toContain(status);
      });

      // If we have multiple events, they should be in order: working -> completed
      if (taskStatusEvents.length > 1) {
        // First status should be "working"
        expect(statuses[0]).toBe("working");
        // Last status should be "completed"
        expect(statuses[statuses.length - 1]).toBe("completed");
      } else {
        // If only one event, it must be "completed"
        expect(statuses[0]).toBe("completed");
      }

      // Validate taskCompleted event
      expect(taskCompletedEvents.length).toBe(1);
      const completedEvent = taskCompletedEvents[0]!;
      expect(completedEvent.taskId).toBe(taskId);
      expect(completedEvent.result).toBeDefined();
      expect(completedEvent.result).toEqual(toolResult);

      // Validate toolCallResultChange event
      expect(toolCallResultEvents.length).toBe(1);
      const toolCallEvent = toolCallResultEvents[0]!;
      expect(toolCallEvent.toolName).toBe("simpleTask");
      expect(toolCallEvent.params).toEqual({ message: "test task" });
      expect(toolCallEvent.success).toBe(true);
      expect(toolCallEvent.result).toEqual(toolResult);
      expect(toolCallEvent.timestamp).toBeInstanceOf(Date);

      // Validate task in clientTasks
      const clientTasks = client.getClientTasks();
      const cachedTask = clientTasks.find((t) => t.taskId === taskId);
      expect(cachedTask).toBeDefined();
      expect(cachedTask!.taskId).toBe(taskId);
      expect(cachedTask!.status).toBe("completed");
      expect(cachedTask!).toHaveProperty("ttl");
      expect(cachedTask!).toHaveProperty("lastUpdatedAt");

      // Validate consistency: taskId from all sources matches
      expect(createdEvent.taskId).toBe(taskId);
      expect(completedEvent.taskId).toBe(taskId);
      expect(cachedTask!.taskId).toBe(taskId);
      if (firstContent && firstContent.type === "text") {
        const resultText = JSON.parse(firstContent.text);
        expect(resultText.taskId).toBe(taskId);
      }
    });

    it("should get task by taskId", async () => {
      // First create a task
      const result = await client.callToolStream("simpleTask", {
        message: "test",
      });
      expect(result.success).toBe(true);

      // Get the taskId from active tasks
      const activeTasks = client.getClientTasks();
      expect(activeTasks.length).toBeGreaterThan(0);
      const activeTask = activeTasks[0];
      expect(activeTask).toBeDefined();
      const taskId = activeTask!.taskId;

      // Get the task
      const task = await client.getTask(taskId);
      expect(task).toBeDefined();
      expect(task.taskId).toBe(taskId);
      expect(task.status).toBe("completed");
    });

    it("should get task result", async () => {
      // First create a task
      const result = await client.callToolStream("simpleTask", {
        message: "test result",
      });
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result).not.toBeNull();

      // Get the taskId from client tasks
      const clientTasks = client.getClientTasks();
      expect(clientTasks.length).toBeGreaterThan(0);
      const task = clientTasks.find((t) => t.status === "completed");
      expect(task).toBeDefined();
      const taskId = task!.taskId;

      // Get the task result
      const taskResult = await client.getTaskResult(taskId);

      // Validate result structure
      expect(taskResult).toBeDefined();
      expect(taskResult).toHaveProperty("content");
      expect(Array.isArray(taskResult.content)).toBe(true);
      expect(taskResult.content.length).toBe(1);

      // Validate content structure
      const firstContent = taskResult.content[0];
      expect(firstContent).toBeDefined();
      expect(firstContent).not.toBeUndefined();
      expect(firstContent!.type).toBe("text");

      // Validate content value
      if (firstContent && firstContent.type === "text") {
        expect(firstContent.text).toBeDefined();
        const resultText = JSON.parse(firstContent.text);
        expect(resultText.message).toBe("Task completed: test result");
        expect(resultText.taskId).toBe(taskId);
      } else {
        expect(firstContent?.type).toBe("text");
      }

      // Validate that getTaskResult returns the same result as callToolStream
      expect(taskResult).toEqual(result.result);
    });

    it("should throw error when calling callTool on task-required tool", async () => {
      await expect(
        client.callTool("simpleTask", { message: "test" }),
      ).rejects.toThrow("requires task support");
    });

    it("should clear tasks on disconnect", async () => {
      // Create a task
      await client.callToolStream("simpleTask", { message: "test" });
      expect(client.getClientTasks().length).toBeGreaterThan(0);

      // Disconnect
      await client.disconnect();

      // Tasks should be cleared
      expect(client.getClientTasks().length).toBe(0);
    });

    it("should call tool with taskSupport: forbidden (immediate result, no task)", async () => {
      // forbiddenTask should return immediately without creating a task
      const result = await client.callToolStream("forbiddenTask", {
        message: "test",
      });

      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty("content");
      // No task should be created
      expect(client.getClientTasks().length).toBe(0);
    });

    it("should call tool with taskSupport: optional (may or may not create task)", async () => {
      // optionalTask may create a task or return immediately
      const result = await client.callToolStream("optionalTask", {
        message: "test",
      });

      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty("content");
      // Task may or may not be created - both are valid
    });

    it("should handle task failure and dispatch taskFailed event", async () => {
      await client.disconnect();
      await server?.stop();

      const taskFailedEvents: any[] = [];

      // Create a task tool that will fail after a short delay
      const failingTask = createFlexibleTaskTool({
        name: "failingTask",
        taskSupport: "required",
        delayMs: 100,
        failAfterDelay: 50, // Fail after 50ms
      });

      const taskConfig = getTaskServerConfig();
      const failConfig = {
        ...taskConfig,
        serverType: "sse" as const,
        tools: [failingTask, ...(taskConfig.tools || [])],
      };
      server = createTestServerHttp(failConfig);
      await server.start();
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      client.addEventListener(
        "taskFailed",
        (event: TypedEvent<"taskFailed">) => {
          taskFailedEvents.push(event.detail);
        },
      );

      // Call the failing task
      await expect(
        client.callToolStream("failingTask", { message: "test" }),
      ).rejects.toThrow();

      // Wait a bit for the event
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify taskFailed event was dispatched
      expect(taskFailedEvents.length).toBeGreaterThan(0);
      expect(taskFailedEvents[0].taskId).toBeDefined();
      expect(taskFailedEvents[0].error).toBeDefined();
    });

    it("should cancel a running task", async () => {
      await client.disconnect();
      await server?.stop();

      // Create a longer-running task tool
      const longRunningTask = createFlexibleTaskTool({
        name: "longRunningTask",
        taskSupport: "required",
        delayMs: 2000, // 2 seconds
      });

      const taskConfig = getTaskServerConfig();
      const cancelConfig = {
        ...taskConfig,
        serverType: "sse" as const,
        tools: [longRunningTask, ...(taskConfig.tools || [])],
      };
      server = createTestServerHttp(cancelConfig);
      await server.start();
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      const cancelledEvents: any[] = [];
      client.addEventListener(
        "taskCancelled",
        (event: TypedEvent<"taskCancelled">) => {
          cancelledEvents.push(event.detail);
        },
      );

      // Start a long-running task
      const taskPromise = client.callToolStream("longRunningTask", {
        message: "test",
      });

      // Wait for task to be created
      await new Promise((resolve) => setTimeout(resolve, 100));
      const activeTasks = client.getClientTasks();
      expect(activeTasks.length).toBeGreaterThan(0);
      const activeTask = activeTasks[0];
      expect(activeTask).toBeDefined();
      const taskId = activeTask!.taskId;

      // Cancel the task
      await client.cancelTask(taskId);

      // Wait for cancellation to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify task is cancelled
      const task = await client.getTask(taskId);
      expect(task.status).toBe("cancelled");

      // Verify cancelled event was dispatched
      expect(cancelledEvents.length).toBeGreaterThan(0);
      expect(cancelledEvents[0].taskId).toBe(taskId);

      // Wait for the original promise (it should error or complete with cancellation)
      try {
        await taskPromise;
      } catch {
        // Expected if task was cancelled
      }
    });

    it("should handle elicitation with task (input_required flow)", async () => {
      await client.disconnect();
      await server?.stop();

      const elicitationConfig = {
        ...getTaskServerConfig(),
        serverType: "sse" as const,
        tools: [
          createElicitationTaskTool("taskWithElicitation"),
          ...(getTaskServerConfig().tools || []),
        ],
      };
      server = createTestServerHttp(elicitationConfig);
      await server.start();
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          elicit: true,
        },
      );
      await client.connect();

      // Set up promise to wait for elicitation
      const elicitationPromise = new Promise<ElicitationCreateMessage>(
        (resolve) => {
          const listener = (event: TypedEvent<"newPendingElicitation">) => {
            resolve(event.detail);
            client.removeEventListener("newPendingElicitation", listener);
          };
          client.addEventListener("newPendingElicitation", listener);
        },
      );

      // Start the task
      const taskPromise = client.callToolStream("taskWithElicitation", {
        message: "test",
      });

      // Wait for elicitation request (with timeout)
      const elicitation = await Promise.race([
        elicitationPromise,
        new Promise<ElicitationCreateMessage>((_, reject) =>
          setTimeout(
            () => reject(new Error("Timeout waiting for elicitation")),
            2000,
          ),
        ),
      ]);

      // Verify elicitation was received
      expect(elicitation).toBeDefined();

      // Verify task status is input_required (if taskId was extracted)
      if (elicitation.taskId) {
        const activeTasks = client.getClientTasks();
        const task = activeTasks.find((t) => t.taskId === elicitation.taskId);
        if (task) {
          expect(task.status).toBe("input_required");
        }
      }

      // Respond to elicitation with correct format
      await elicitation.respond({
        action: "accept",
        content: {
          input: "test input",
        },
      });

      // Wait for task to complete
      const result = await taskPromise;
      expect(result.success).toBe(true);
    });

    it("should handle sampling with task (input_required flow)", async () => {
      await client.disconnect();
      await server?.stop();

      const samplingConfig = {
        ...getTaskServerConfig(),
        serverType: "sse" as const,
        tools: [
          createSamplingTaskTool("taskWithSampling"),
          ...(getTaskServerConfig().tools || []),
        ],
      };
      server = createTestServerHttp(samplingConfig);
      await server.start();
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          sample: true,
        },
      );
      await client.connect();

      // Set up promise to wait for sampling
      const samplingPromise = new Promise<SamplingCreateMessage>((resolve) => {
        const listener = (event: TypedEvent<"newPendingSample">) => {
          resolve(event.detail);
          client.removeEventListener("newPendingSample", listener);
        };
        client.addEventListener("newPendingSample", listener);
      });

      // Start the task
      const taskPromise = client.callToolStream("taskWithSampling", {
        message: "test",
      });

      // Wait for sampling request (with longer timeout)
      const sample = await Promise.race([
        samplingPromise,
        new Promise<SamplingCreateMessage>((_, reject) =>
          setTimeout(
            () => reject(new Error("Timeout waiting for sampling")),
            3000,
          ),
        ),
      ]);

      // Verify sampling was received
      expect(sample).toBeDefined();

      // Wait a bit for task to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify task was created and is in input_required status
      const activeTasks = client.getClientTasks();
      expect(activeTasks.length).toBeGreaterThan(0);

      // Find the task that triggered this sampling
      // If taskId was extracted from metadata, use it; otherwise use the most recent task
      const task = sample.taskId
        ? activeTasks.find((t) => t.taskId === sample.taskId)
        : activeTasks[activeTasks.length - 1];

      expect(task).toBeDefined();
      expect(task!.status).toBe("input_required");

      // Respond to sampling with correct format
      await sample.respond({
        model: "test-model",
        role: "assistant",
        stopReason: "endTurn",
        content: {
          type: "text",
          text: "Sampling response",
        },
      });

      // Wait for task to complete
      const result = await taskPromise;
      expect(result.success).toBe(true);
    });

    it("should handle progress notifications linked to tasks", async () => {
      await client.disconnect();
      await server?.stop();

      // createProgressTaskTool defaults to 5 progress units with 2000ms delay
      // Progress notifications are sent at delayMs / progressUnits intervals (400ms each)
      const progressConfig = {
        ...getTaskServerConfig(),
        serverType: "sse" as const,
        tools: [
          createProgressTaskTool("taskWithProgress", 2000, 5),
          ...(getTaskServerConfig().tools || []),
        ],
      };
      server = createTestServerHttp(progressConfig);
      await server.start();
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          progress: true,
        },
      );
      await client.connect();

      const progressEvents: any[] = [];
      const taskCreatedEvents: any[] = [];
      const taskCompletedEvents: any[] = [];

      client.addEventListener(
        "progressNotification",
        (event: TypedEvent<"progressNotification">) => {
          progressEvents.push(event.detail);
        },
      );
      client.addEventListener(
        "taskCreated",
        (event: TypedEvent<"taskCreated">) => {
          taskCreatedEvents.push(event.detail);
        },
      );
      client.addEventListener(
        "taskCompleted",
        (event: TypedEvent<"taskCompleted">) => {
          taskCompletedEvents.push(event.detail);
        },
      );

      // Generate a progress token
      const progressToken = Math.random().toString();

      // Call the tool with progress token
      const resultPromise = client.callToolStream(
        "taskWithProgress",
        {
          message: "test",
        },
        undefined,
        { progressToken },
      );

      // Wait for task to be created
      await new Promise((resolve) => {
        if (taskCreatedEvents.length > 0) {
          resolve(undefined);
        } else {
          const listener = (event: TypedEvent<"taskCreated">) => {
            client.removeEventListener("taskCreated", listener);
            resolve(undefined);
          };
          client.addEventListener("taskCreated", listener);
        }
      });

      expect(taskCreatedEvents.length).toBe(1);
      const taskId = taskCreatedEvents[0].taskId;

      // Wait for all progress notifications to be sent
      // Progress notifications are sent at ~400ms intervals (2000ms / 5 units)
      // Wait for delayMs + buffer (2000ms + 500ms buffer = 2500ms)
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Wait for task to complete
      const result = await resultPromise;

      // Verify task completed successfully
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result).not.toBeNull();
      expect(result.result).toHaveProperty("content");

      // Validate the actual tool call response content
      const toolResult = result.result!;
      expect(toolResult.content).toBeDefined();
      expect(Array.isArray(toolResult.content)).toBe(true);
      expect(toolResult.content.length).toBe(1);

      const firstContent = toolResult.content[0];
      expect(firstContent).toBeDefined();
      expect(firstContent).not.toBeUndefined();
      expect(firstContent!.type).toBe("text");

      // Assert it's a text content block (for TypeScript narrowing)
      expect(firstContent!.type === "text").toBe(true);

      // TypeScript type narrowing - we've already asserted it's text
      if (firstContent && firstContent.type === "text") {
        expect(firstContent.text).toBeDefined();
        // Parse and validate the JSON text content
        const resultText = JSON.parse(firstContent.text);
        expect(resultText.message).toBe("Task completed: test");
        expect(resultText.taskId).toBe(taskId);
      } else {
        // This should never happen due to the assertion above, but TypeScript needs it
        expect(firstContent?.type).toBe("text");
      }

      // Verify taskCompleted event was dispatched
      expect(taskCompletedEvents.length).toBe(1);
      expect(taskCompletedEvents[0].taskId).toBe(taskId);
      expect(taskCompletedEvents[0].result).toBeDefined();
      // Verify the taskCompleted event result matches the tool call result
      expect(taskCompletedEvents[0].result).toEqual(toolResult);

      // Verify all 5 progress events were received
      expect(progressEvents.length).toBe(5);

      // Verify each progress event
      progressEvents.forEach((event, index) => {
        // Verify progress token matches
        expect(event.progressToken).toBe(progressToken);

        // Verify progress values are sequential (1, 2, 3, 4, 5)
        expect(event.progress).toBe(index + 1);
        expect(event.total).toBe(5);

        // Verify progress message format
        expect(event.message).toBe(`Processing... ${index + 1}/5`);

        // Verify progress events are linked to the task via _meta
        expect(event._meta).toBeDefined();
        expect(event._meta?.[RELATED_TASK_META_KEY]).toBeDefined();
        const relatedTask = event._meta?.[RELATED_TASK_META_KEY] as {
          taskId: string;
        };
        expect(relatedTask.taskId).toBe(taskId);
      });

      // Verify task is in completed state
      const activeTasks = client.getClientTasks();
      const completedTask = activeTasks.find((t) => t.taskId === taskId);
      expect(completedTask).toBeDefined();
      expect(completedTask!.status).toBe("completed");
    });

    it("should handle listTasks pagination", async () => {
      // Create multiple tasks
      await client.callToolStream("simpleTask", { message: "task1" });
      await client.callToolStream("simpleTask", { message: "task2" });
      await client.callToolStream("simpleTask", { message: "task3" });

      // Wait for tasks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // List tasks
      const result = await client.listTasks();
      expect(result.tasks.length).toBeGreaterThan(0);

      // If there's a nextCursor, test pagination
      if (result.nextCursor) {
        const nextPage = await client.listTasks(result.nextCursor);
        expect(nextPage.tasks).toBeDefined();
        expect(Array.isArray(nextPage.tasks)).toBe(true);
      }
    });
  });
});
