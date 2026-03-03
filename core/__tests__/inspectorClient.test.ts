import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as z from "zod/v4";
import { InspectorClient } from "../mcp/inspectorClient.js";
import {
  MessageLogState,
  FetchRequestLogState,
  StderrLogState,
  PagedResourcesState,
  PagedResourceTemplatesState,
  PagedPromptsState,
  ManagedResourcesState,
  ManagedPromptsState,
} from "../mcp/state/index.js";
import { createTransportNode } from "../mcp/node/transport.js";
import { SamplingCreateMessage } from "../mcp/samplingCreateMessage.js";
import { ElicitationCreateMessage } from "../mcp/elicitationCreateMessage.js";
import {
  getTestMcpServerCommand,
  createTestServerHttp,
  type TestServerHttp,
  waitForEvent,
  waitForProgressCount,
  createEchoTool,
  createTestServerInfo,
  createFileResourceTemplate,
  createCollectSampleTool,
  createCollectFormElicitationTool,
  createCollectUrlElicitationTool,
  createUrlElicitationFormTool,
  createSendNotificationTool,
  createListRootsTool,
  createArgsPrompt,
  createNumberedTools,
  createNumberedResources,
  createNumberedResourceTemplates,
  createNumberedPrompts,
  getTaskServerConfig,
  createElicitationTaskTool,
  createSamplingTaskTool,
  createProgressTaskTool,
  createTaskTool,
} from "@modelcontextprotocol/inspector-test-server";
import type {
  MessageEntry,
  ConnectionStatus,
  FetchRequestEntryBase,
} from "../mcp/types.js";
import type { JsonValue } from "../json/jsonUtils.js";
import type { TypedEvent } from "../mcp/inspectorClientEventTarget.js";
import type {
  CreateMessageResult,
  ElicitResult,
  CallToolResult,
  Task,
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  Progress,
  ContentBlock,
} from "@modelcontextprotocol/sdk/types.js";
import {
  RELATED_TASK_META_KEY,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

/** Get all tools from the client via listTools() (paginates if needed). */
async function getAllTools(client: InspectorClient): Promise<Tool[]> {
  const collected: Tool[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const r = await client.listTools(cursor);
    collected.push(...r.tools);
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return collected;
}

/** Get a tool by name from the client via listTools() (paginates if needed). */
async function getTool(client: InspectorClient, name: string): Promise<Tool> {
  const tool = (await getAllTools(client)).find((t) => t.name === name);
  if (tool) return tool;
  throw new Error(`Tool ${name} not found`);
}

/** Get all resources from the client via listResources() (paginates if needed). */
async function getAllResources(
  client: InspectorClient,
  metadata?: Record<string, string>,
): Promise<Resource[]> {
  const collected: Resource[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const r = await client.listResources(cursor, metadata);
    collected.push(...r.resources);
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return collected;
}

/** Get all resource templates via listResourceTemplates() (paginates if needed). */
async function getAllResourceTemplates(
  client: InspectorClient,
  metadata?: Record<string, string>,
): Promise<ResourceTemplate[]> {
  const collected: ResourceTemplate[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const r = await client.listResourceTemplates(cursor, metadata);
    collected.push(...r.resourceTemplates);
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return collected;
}

/** Get all prompts via listPrompts() (paginates if needed). */
async function getAllPrompts(
  client: InspectorClient,
  metadata?: Record<string, string>,
): Promise<Prompt[]> {
  const collected: Prompt[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const r = await client.listPrompts(cursor, metadata);
    collected.push(...r.prompts);
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return collected;
}

/** Minimal Tool shape for tests that need to call a tool by name (e.g. server returns "not found"). */
function minimalTool(name: string): Tool {
  return { name, description: "", inputSchema: {} };
}

describe("InspectorClient", () => {
  let client: InspectorClient | null;
  let server: TestServerHttp | null;
  let serverCommand: { command: string; args: string[] };

  beforeEach(() => {
    serverCommand = getTestMcpServerCommand();
    server = null;
  });

  afterEach(async () => {
    // Orderly teardown: disconnect client first, then stop server.
    // HTTP test server sets closing before close so in-flight progress tools skip sending.
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      client = null;
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
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        { environment: { transport: createTransportNode } },
      );

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
          environment: { transport: createTransportNode },
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
          environment: { transport: createTransportNode },
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
          environment: { transport: createTransportNode },
        },
      );
      const pagedResourcesState = new PagedResourcesState(client);
      const pagedPromptsState = new PagedPromptsState(client);

      await client.connect();
      expect((await client.listTools()).tools.length).toBeGreaterThan(0);
      await pagedResourcesState.loadPage();
      await pagedPromptsState.loadPage();
      expect(pagedResourcesState.getResources().length).toBeGreaterThan(0);
      expect(pagedPromptsState.getPrompts().length).toBeGreaterThan(0);

      await client.disconnect();
      expect(pagedResourcesState.getResources().length).toBe(0);
      expect(pagedPromptsState.getPrompts().length).toBe(0);

      pagedResourcesState.destroy();
      pagedPromptsState.destroy();
    });

    it("MessageLogState clears on connect when attached to client", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          environment: { transport: createTransportNode },
        },
      );
      const messageLogState = new MessageLogState(client);
      await client.connect();
      await getAllTools(client);
      const firstConnectMessages = messageLogState.getMessages();
      expect(firstConnectMessages.length).toBeGreaterThan(0);

      await client.disconnect();
      await client.connect();
      await getAllTools(client);
      const secondConnectMessages = messageLogState.getMessages();
      expect(secondConnectMessages.length).toBeGreaterThan(0);
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
      messageLogState.destroy();
    });
  });

  describe("Message Tracking", () => {
    it("should track requests (via MessageLogState)", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          environment: { transport: createTransportNode },
        },
      );
      const messageLogState = new MessageLogState(client);
      await client.connect();
      await getAllTools(client);

      const messages = messageLogState.getMessages();
      expect(messages.length).toBeGreaterThan(0);
      const request = messages.find((m) => m.direction === "request");
      expect(request).toBeDefined();
      if (request) {
        expect("method" in request.message).toBe(true);
      }
      messageLogState.destroy();
    });

    it("should track responses (via MessageLogState)", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          environment: { transport: createTransportNode },
        },
      );
      const messageLogState = new MessageLogState(client);
      await client.connect();
      await getAllTools(client);

      const messages = messageLogState.getMessages();
      const request = messages.find((m) => m.direction === "request");
      expect(request).toBeDefined();
      if (request && "response" in request) {
        expect(request.response).toBeDefined();
        expect(request.duration).toBeDefined();
      }
      messageLogState.destroy();
    });

    it("should emit message events", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          environment: { transport: createTransportNode },
        },
      );

      const messageEvents: MessageEntry[] = [];
      client.addEventListener("message", (event) => {
        messageEvents.push(event.detail);
      });

      await client.connect();
      await getAllTools(client);

      expect(messageEvents.length).toBeGreaterThan(0);
    });

    it("MessageLogState getMessages(predicate) returns only matching entries", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          environment: { transport: createTransportNode },
        },
      );
      const messageLogState = new MessageLogState(client);
      await client.connect();
      await getAllTools(client);

      const all = messageLogState.getMessages();
      expect(all.length).toBeGreaterThan(0);

      const requests = messageLogState.getMessages(
        (m) => m.direction === "request",
      );
      expect(requests.length).toBeLessThanOrEqual(all.length);
      expect(requests.every((m) => m.direction === "request")).toBe(true);

      const notifications = messageLogState.getMessages(
        (m) => m.direction === "notification",
      );
      expect(notifications.every((m) => m.direction === "notification")).toBe(
        true,
      );
      messageLogState.destroy();
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
          environment: { transport: createTransportNode },
        },
      );

      const fetchRequestLogState = new FetchRequestLogState(client);
      await client.connect();
      await getAllTools(client);

      const fetchRequests = fetchRequestLogState.getFetchRequests();
      expect(fetchRequests.length).toBeGreaterThan(0);
      const request = fetchRequests[0];
      expect(request).toBeDefined();
      if (request) {
        expect(request.url).toContain("/sse");
        expect(request.method).toBe("GET");
        expect(request.category).toBe("transport");
      }
      fetchRequestLogState.destroy();
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
          environment: { transport: createTransportNode },
        },
      );

      const fetchRequestLogState = new FetchRequestLogState(client);
      await client.connect();
      await getAllTools(client);

      const fetchRequests = fetchRequestLogState.getFetchRequests();
      expect(fetchRequests.length).toBeGreaterThan(0);
      const request = fetchRequests[0];
      expect(request).toBeDefined();
      if (request) {
        expect(request.url).toContain("/mcp");
        expect(request.method).toBe("POST");
        expect(request.category).toBe("transport");
      }
      fetchRequestLogState.destroy();
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
          environment: { transport: createTransportNode },
        },
      );

      const fetchRequestLogState = new FetchRequestLogState(client);
      await client.connect();
      await getAllTools(client);

      const fetchRequests = fetchRequestLogState.getFetchRequests();
      expect(fetchRequests.length).toBeGreaterThan(0);
      const request = fetchRequests.find((r) => r.responseStatus !== undefined);
      expect(request).toBeDefined();
      if (request) {
        expect(request.requestHeaders).toBeDefined();
        expect(request.responseStatus).toBeDefined();
        expect(request.responseHeaders).toBeDefined();
        expect(request.duration).toBeDefined();
        expect(request.category).toBe("transport");
      }
      fetchRequestLogState.destroy();
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
          environment: { transport: createTransportNode },
        },
      );

      const fetchRequestEvents: FetchRequestEntryBase[] = [];
      client.addEventListener("fetchRequest", (event) => {
        fetchRequestEvents.push(event.detail);
      });

      await client.connect();
      await getAllTools(client);

      expect(fetchRequestEvents.length).toBeGreaterThan(0);
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
          environment: { transport: createTransportNode },
        },
      );

      const entries: unknown[] = [];
      client.addEventListener("fetchRequest", (e) => {
        entries.push((e as CustomEvent).detail);
      });

      await client.connect();
      await getAllTools(client);

      expect(entries.length).toBeGreaterThan(0);
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
          environment: { transport: createTransportNode },
        },
      );

      await client.connect();

      expect((await client.listTools()).tools.length).toBeGreaterThan(0);
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
          environment: { transport: createTransportNode },
        },
      );

      await client.connect();

      // Client no longer stores tools; listTools() still returns server tools when called
      expect((await client.listTools()).tools.length).toBeGreaterThan(0);
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
          environment: { transport: createTransportNode },
        },
      );
      await client.connect();
    });

    it("should list tools", async () => {
      const result = await client!.listTools();
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBeGreaterThan(0);
    });

    it("should call tool with string arguments", async () => {
      const tool = await getTool(client!, "echo");
      const result = await client!.callTool(tool, {
        message: "hello world",
      });

      expect(result).toHaveProperty("result");
      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty("content");
      const content = result.result!.content as ContentBlock[];
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]).toHaveProperty("type", "text");
      expect("text" in content[0] && content[0].text).toContain("hello world");
    });

    it("should call tool with number arguments", async () => {
      const tool = await getTool(client!, "get_sum");
      const result = await client!.callTool(tool, {
        a: 42,
        b: 58,
      });
      expect(result.success).toBe(true);

      expect(result.result).toHaveProperty("content");
      const content = result.result!.content as ContentBlock[];
      const resultData = JSON.parse(
        "text" in content[0] ? content[0].text : "",
      );
      expect(resultData.result).toBe(100);
    });

    it("should call tool with boolean arguments", async () => {
      const tool = await getTool(client!, "get_annotated_message");
      const result = await client!.callTool(tool, {
        messageType: "success",
        includeImage: true,
      });

      expect(result.result).toHaveProperty("content");
      const content = result.result!.content as ContentBlock[];
      expect(content.length).toBeGreaterThan(1);
      const hasImage = content.some(
        (item: ContentBlock) => "type" in item && item.type === "image",
      );
      expect(hasImage).toBe(true);
    });

    it("should return both content and structuredContent for tool with outputSchema (get_temp)", async () => {
      const tool = await getTool(client!, "get_temp");
      const result = await client!.callTool(tool, {
        city: "Seattle",
        units: "C",
      });

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result).toHaveProperty("content");
      expect(result.result).toHaveProperty("structuredContent");

      const content = result.result!.content as Array<{
        type: string;
        text?: string;
      }>;
      expect(Array.isArray(content)).toBe(true);
      expect(content[0].type).toBe("text");
      expect(content[0].text).toContain("Seattle");
      expect(content[0].text).toContain("25");
      expect(content[0].text).toContain("degrees C");

      const structured = result.result!.structuredContent as Record<
        string,
        unknown
      >;
      expect(structured).toEqual({
        temperature: 25,
        unit: "C",
        city: "Seattle",
      });
    });

    it("should handle tool not found", async () => {
      const result = await client!.callTool(
        minimalTool("nonexistent-tool"),
        {},
      );
      // When tool is not found, the SDK returns an error response, not an exception
      expect(result.success).toBe(true); // SDK returns error in result, not as exception
      expect(result.result).toHaveProperty("isError", true);
      expect(result.result).toBeDefined();
      if (result.result) {
        expect(result.result).toHaveProperty("content");
        const content = result.result.content as ContentBlock[];
        expect(content[0]).toHaveProperty("text");
        expect((content[0] as { text: string }).text).toContain("not found");
      }
    });

    it("should paginate tools when maxPageSize is set", async () => {
      // Disconnect and create a new server with pagination
      await client!.disconnect();
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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();

      // First page should have 3 tools
      const page1 = await client.listTools();
      expect(page1.tools.length).toBe(3);
      expect(page1.nextCursor).toBeDefined();
      expect(page1.tools[0]?.name).toBe("tool_1");
      expect(page1.tools[1]?.name).toBe("tool_2");
      expect(page1.tools[2]?.name).toBe("tool_3");

      // Second page should have 3 more tools
      const page2 = await client.listTools(page1.nextCursor);
      expect(page2.tools.length).toBe(3);
      expect(page2.nextCursor).toBeDefined();
      expect(page2.tools[0]?.name).toBe("tool_4");
      expect(page2.tools[1]?.name).toBe("tool_5");
      expect(page2.tools[2]?.name).toBe("tool_6");

      // Third page should have 3 more tools
      const page3 = await client.listTools(page2.nextCursor);
      expect(page3.tools.length).toBe(3);
      expect(page3.nextCursor).toBeDefined();
      expect(page3.tools[0]?.name).toBe("tool_7");
      expect(page3.tools[1]?.name).toBe("tool_8");
      expect(page3.tools[2]?.name).toBe("tool_9");

      // Fourth page should have 1 tool and no next cursor
      const page4 = await client.listTools(page3.nextCursor);
      expect(page4.tools.length).toBe(1);
      expect(page4.nextCursor).toBeUndefined();
      expect(page4.tools[0]?.name).toBe("tool_10");
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
          environment: { transport: createTransportNode },
        },
      );
      await client.connect();
    });

    it("should list resources", async () => {
      const resources = await getAllResources(client!);
      expect(Array.isArray(resources)).toBe(true);
    });

    it("should read resource", async () => {
      const resources = await getAllResources(client!);
      if (resources.length > 0) {
        const uri = resources[0]!.uri;
        const readResult = await client!.readResource(uri);
        expect(readResult).toHaveProperty("result");
        expect(readResult.result).toHaveProperty("contents");
      }
    });

    it("should paginate resources when maxPageSize is set", async () => {
      // Disconnect and create a new server with pagination
      await client!.disconnect();
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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();

      // First page should have 3 resources
      const page1 = await client.listResources();
      expect(page1.resources.length).toBe(3);
      expect(page1.nextCursor).toBeDefined();
      expect(page1.resources[0]?.uri).toBe("test://resource_1");
      expect(page1.resources[1]?.uri).toBe("test://resource_2");
      expect(page1.resources[2]?.uri).toBe("test://resource_3");

      // Second page should have 3 more resources
      const page2 = await client.listResources(page1.nextCursor);
      expect(page2.resources.length).toBe(3);
      expect(page2.nextCursor).toBeDefined();
      expect(page2.resources[0]?.uri).toBe("test://resource_4");
      expect(page2.resources[1]?.uri).toBe("test://resource_5");
      expect(page2.resources[2]?.uri).toBe("test://resource_6");

      // Third page should have 3 more resources
      const page3 = await client.listResources(page2.nextCursor);
      expect(page3.resources.length).toBe(3);
      expect(page3.nextCursor).toBeDefined();
      expect(page3.resources[0]?.uri).toBe("test://resource_7");
      expect(page3.resources[1]?.uri).toBe("test://resource_8");
      expect(page3.resources[2]?.uri).toBe("test://resource_9");

      // Fourth page should have 1 resource and no next cursor
      const page4 = await client.listResources(page3.nextCursor);
      expect(page4.resources.length).toBe(1);
      expect(page4.nextCursor).toBeUndefined();
      expect(page4.resources[0]?.uri).toBe("test://resource_10");

      const allResources = await getAllResources(client);
      expect(allResources.length).toBe(10);
    });

    it("should suppress events during listAllResources pagination and emit final event", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: createNumberedResources(6),
        maxPageSize: {
          resources: 2,
        },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();

      const managedState = new ManagedResourcesState(client);
      const events: Resource[][] = [];
      managedState.addEventListener("resourcesChange", (e) => {
        events.push(e.detail);
      });

      await managedState.refresh();
      expect(managedState.getResources().length).toBe(6);
      expect(events.length).toBe(1);
      expect(events[0]!.length).toBe(6);
      managedState.destroy();
    });

    it("should accumulate resources when paginating with cursor", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: createNumberedResources(6),
        maxPageSize: { resources: 2 },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();
      const pagedState = new PagedResourcesState(client);

      expect(pagedState.getResources().length).toBe(0);

      const page1 = await pagedState.loadPage();
      expect(page1.resources.length).toBe(2);
      expect(pagedState.getResources().length).toBe(2);
      expect(pagedState.getResources()[0]?.uri).toBe("test://resource_1");
      expect(pagedState.getResources()[1]?.uri).toBe("test://resource_2");

      const page2 = await pagedState.loadPage(page1.nextCursor);
      expect(page2.resources.length).toBe(2);
      expect(pagedState.getResources().length).toBe(4);
      expect(pagedState.getResources()[2]?.uri).toBe("test://resource_3");
      expect(pagedState.getResources()[3]?.uri).toBe("test://resource_4");

      const page3 = await pagedState.loadPage(page2.nextCursor);
      expect(page3.resources.length).toBe(2);
      expect(pagedState.getResources().length).toBe(6);
      expect(pagedState.getResources()[4]?.uri).toBe("test://resource_5");
      expect(pagedState.getResources()[5]?.uri).toBe("test://resource_6");

      const page1Again = await pagedState.loadPage();
      expect(page1Again.resources.length).toBe(2);
      expect(pagedState.getResources().length).toBe(2);
      expect(pagedState.getResources()[0]?.uri).toBe("test://resource_1");

      pagedState.destroy();
    });

    it("should emit resourcesChange events when paginating", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: createNumberedResources(6),
        maxPageSize: { resources: 2 },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();
      const pagedState = new PagedResourcesState(client);
      const events: Resource[][] = [];
      pagedState.addEventListener("resourcesChange", (e) => {
        events.push(e.detail);
      });

      const page1 = await pagedState.loadPage();
      expect(events.length).toBe(1);
      expect(events[0]!.length).toBe(2);

      await pagedState.loadPage(page1.nextCursor);
      expect(events.length).toBe(2);
      expect(events[1]!.length).toBe(4);

      pagedState.destroy();
    });

    it("should emit resourcesChange when loading pages via PagedResourcesState", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: createNumberedResources(6),
        maxPageSize: { resources: 2 },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();
      const pagedState = new PagedResourcesState(client);
      const events: Resource[][] = [];
      pagedState.addEventListener("resourcesChange", (e) => {
        events.push(e.detail);
      });

      await pagedState.loadPage();
      expect(pagedState.getResources().length).toBe(2);
      expect(events.length).toBe(1);

      pagedState.destroy();
    });

    it("should clear resources and emit event", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: createNumberedResources(3),
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();
      const pagedState = new PagedResourcesState(client);
      await pagedState.loadPage();
      expect(pagedState.getResources().length).toBe(3);

      const events: Resource[][] = [];
      pagedState.addEventListener("resourcesChange", (e) => {
        events.push(e.detail);
      });

      pagedState.clear();
      expect(pagedState.getResources().length).toBe(0);
      expect(events.length).toBe(1);
      expect(events[0]!.length).toBe(0);

      pagedState.destroy();
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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();
    });

    it("should list resource templates", async () => {
      const resourceTemplates = await getAllResourceTemplates(client!);
      expect(Array.isArray(resourceTemplates)).toBe(true);
      expect(resourceTemplates.length).toBeGreaterThan(0);

      const templates = resourceTemplates;
      const fileTemplate = templates.find((t) => t.name === "file");
      expect(fileTemplate).toBeDefined();
      expect(fileTemplate?.uriTemplate).toBe("file:///{path}");
    });

    it("should read resource from template", async () => {
      const templates = await getAllResourceTemplates(client!);
      const fileTemplate = templates.find((t) => t.name === "file");
      expect(fileTemplate).toBeDefined();

      // Use a URI that matches the template pattern file:///{path}
      // The path variable will be "test.txt"
      const expandedUri = "file:///test.txt";

      // Read the resource using the expanded URI
      const readResult = await client!.readResource(expandedUri);
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

      await client!.disconnect();
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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();

      const resources = await getAllResources(client);
      expect(Array.isArray(resources)).toBe(true);

      // Verify that the resources from the list callback are included
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain("file:///file1.txt");
      expect(uris).toContain("file:///file2.txt");
      expect(uris).toContain("file:///file3.txt");
    });

    it("should paginate resource templates when maxPageSize is set", async () => {
      // Disconnect and create a new server with pagination
      await client!.disconnect();
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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();

      // First page should have 3 templates
      const page1 = await client.listResourceTemplates();
      expect(page1.resourceTemplates.length).toBe(3);
      expect(page1.nextCursor).toBeDefined();
      expect(page1.resourceTemplates[0]?.uriTemplate).toBe(
        "test://template_1/{param}",
      );
      expect(page1.resourceTemplates[1]?.uriTemplate).toBe(
        "test://template_2/{param}",
      );
      expect(page1.resourceTemplates[2]?.uriTemplate).toBe(
        "test://template_3/{param}",
      );

      // Second page should have 3 more templates
      const page2 = await client.listResourceTemplates(page1.nextCursor);
      expect(page2.resourceTemplates.length).toBe(3);
      expect(page2.nextCursor).toBeDefined();
      expect(page2.resourceTemplates[0]?.uriTemplate).toBe(
        "test://template_4/{param}",
      );
      expect(page2.resourceTemplates[1]?.uriTemplate).toBe(
        "test://template_5/{param}",
      );
      expect(page2.resourceTemplates[2]?.uriTemplate).toBe(
        "test://template_6/{param}",
      );

      // Third page should have 3 more templates
      const page3 = await client.listResourceTemplates(page2.nextCursor);
      expect(page3.resourceTemplates.length).toBe(3);
      expect(page3.nextCursor).toBeDefined();
      expect(page3.resourceTemplates[0]?.uriTemplate).toBe(
        "test://template_7/{param}",
      );
      expect(page3.resourceTemplates[1]?.uriTemplate).toBe(
        "test://template_8/{param}",
      );
      expect(page3.resourceTemplates[2]?.uriTemplate).toBe(
        "test://template_9/{param}",
      );

      // Fourth page should have 1 template and no next cursor
      const page4 = await client.listResourceTemplates(page3.nextCursor);
      expect(page4.resourceTemplates.length).toBe(1);
      expect(page4.nextCursor).toBeUndefined();
      expect(page4.resourceTemplates[0]?.uriTemplate).toBe(
        "test://template_10/{param}",
      );

      const allTemplates = await getAllResourceTemplates(client);
      expect(allTemplates.length).toBe(10);
    });

    it("should accumulate resource templates when paginating with cursor", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: createNumberedResourceTemplates(6),
        maxPageSize: { resourceTemplates: 2 },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();
      const pagedState = new PagedResourceTemplatesState(client);

      expect(pagedState.getResourceTemplates().length).toBe(0);

      const page1 = await pagedState.loadPage();
      expect(page1.resourceTemplates.length).toBe(2);
      expect(pagedState.getResourceTemplates().length).toBe(2);
      expect(pagedState.getResourceTemplates()[0]?.uriTemplate).toBe(
        "test://template_1/{param}",
      );
      expect(pagedState.getResourceTemplates()[1]?.uriTemplate).toBe(
        "test://template_2/{param}",
      );

      const page2 = await pagedState.loadPage(page1.nextCursor);
      expect(page2.resourceTemplates.length).toBe(2);
      expect(pagedState.getResourceTemplates().length).toBe(4);
      expect(pagedState.getResourceTemplates()[2]?.uriTemplate).toBe(
        "test://template_3/{param}",
      );
      expect(pagedState.getResourceTemplates()[3]?.uriTemplate).toBe(
        "test://template_4/{param}",
      );

      const page3 = await pagedState.loadPage(page2.nextCursor);
      expect(page3.resourceTemplates.length).toBe(2);
      expect(pagedState.getResourceTemplates().length).toBe(6);
      expect(pagedState.getResourceTemplates()[4]?.uriTemplate).toBe(
        "test://template_5/{param}",
      );
      expect(pagedState.getResourceTemplates()[5]?.uriTemplate).toBe(
        "test://template_6/{param}",
      );

      const page1Again = await pagedState.loadPage();
      expect(page1Again.resourceTemplates.length).toBe(2);
      expect(pagedState.getResourceTemplates().length).toBe(2);
      expect(pagedState.getResourceTemplates()[0]?.uriTemplate).toBe(
        "test://template_1/{param}",
      );

      pagedState.destroy();
    });

    it("should clear resource templates and emit event", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: createNumberedResourceTemplates(3),
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();
      const pagedState = new PagedResourceTemplatesState(client);
      await pagedState.loadPage();
      expect(pagedState.getResourceTemplates().length).toBe(3);

      const events: ResourceTemplate[][] = [];
      pagedState.addEventListener("resourceTemplatesChange", (e) => {
        events.push(e.detail);
      });

      pagedState.clear();
      expect(pagedState.getResourceTemplates().length).toBe(0);
      expect(events.length).toBe(1);
      expect(events[0]!.length).toBe(0);

      pagedState.destroy();
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
          environment: { transport: createTransportNode },
        },
      );
      await client.connect();
    });

    it("should list prompts", async () => {
      const prompts = await getAllPrompts(client!);
      expect(Array.isArray(prompts)).toBe(true);
    });

    it("should paginate prompts when maxPageSize is set", async () => {
      // Disconnect and create a new server with pagination
      await client!.disconnect();
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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();

      // First page should have 3 prompts
      const page1 = await client.listPrompts();
      expect(page1.prompts.length).toBe(3);
      expect(page1.nextCursor).toBeDefined();
      expect(page1.prompts[0]?.name).toBe("prompt_1");
      expect(page1.prompts[1]?.name).toBe("prompt_2");
      expect(page1.prompts[2]?.name).toBe("prompt_3");

      // Second page should have 3 more prompts
      const page2 = await client.listPrompts(page1.nextCursor);
      expect(page2.prompts.length).toBe(3);
      expect(page2.nextCursor).toBeDefined();
      expect(page2.prompts[0]?.name).toBe("prompt_4");
      expect(page2.prompts[1]?.name).toBe("prompt_5");
      expect(page2.prompts[2]?.name).toBe("prompt_6");

      // Third page should have 3 more prompts
      const page3 = await client.listPrompts(page2.nextCursor);
      expect(page3.prompts.length).toBe(3);
      expect(page3.nextCursor).toBeDefined();
      expect(page3.prompts[0]?.name).toBe("prompt_7");
      expect(page3.prompts[1]?.name).toBe("prompt_8");
      expect(page3.prompts[2]?.name).toBe("prompt_9");

      // Fourth page should have 1 prompt and no next cursor
      const page4 = await client.listPrompts(page3.nextCursor);
      expect(page4.prompts.length).toBe(1);
      expect(page4.nextCursor).toBeUndefined();
      expect(page4.prompts[0]?.name).toBe("prompt_10");

      const allPrompts = await getAllPrompts(client);
      expect(allPrompts.length).toBe(10);
    });

    it("should suppress events during listAllPrompts pagination and emit final event", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: createNumberedPrompts(6),
        maxPageSize: { prompts: 2 },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();

      const managedState = new ManagedPromptsState(client);
      const events: Prompt[][] = [];
      managedState.addEventListener("promptsChange", (e) => {
        events.push(e.detail);
      });

      await managedState.refresh();
      expect(managedState.getPrompts().length).toBe(6);
      expect(events.length).toBe(1);
      expect(events[0]!.length).toBe(6);
      managedState.destroy();
    });

    it("should accumulate prompts when paginating with cursor", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: createNumberedPrompts(6),
        maxPageSize: { prompts: 2 },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();
      const pagedState = new PagedPromptsState(client);

      expect(pagedState.getPrompts().length).toBe(0);

      const page1 = await pagedState.loadPage();
      expect(page1.prompts.length).toBe(2);
      expect(pagedState.getPrompts().length).toBe(2);
      expect(pagedState.getPrompts()[0]?.name).toBe("prompt_1");
      expect(pagedState.getPrompts()[1]?.name).toBe("prompt_2");

      const page2 = await pagedState.loadPage(page1.nextCursor);
      expect(page2.prompts.length).toBe(2);
      expect(pagedState.getPrompts().length).toBe(4);
      expect(pagedState.getPrompts()[2]?.name).toBe("prompt_3");
      expect(pagedState.getPrompts()[3]?.name).toBe("prompt_4");

      const page3 = await pagedState.loadPage(page2.nextCursor);
      expect(page3.prompts.length).toBe(2);
      expect(pagedState.getPrompts().length).toBe(6);
      expect(pagedState.getPrompts()[4]?.name).toBe("prompt_5");
      expect(pagedState.getPrompts()[5]?.name).toBe("prompt_6");

      const page1Again = await pagedState.loadPage();
      expect(page1Again.prompts.length).toBe(2);
      expect(pagedState.getPrompts().length).toBe(2);
      expect(pagedState.getPrompts()[0]?.name).toBe("prompt_1");

      pagedState.destroy();
    });

    it("should emit promptsChange events when paginating", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: createNumberedPrompts(6),
        maxPageSize: {
          prompts: 2,
        },
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();
      const pagedState = new PagedPromptsState(client);
      const events: Prompt[][] = [];
      pagedState.addEventListener("promptsChange", (e) => {
        events.push(e.detail);
      });

      const page1 = await pagedState.loadPage();
      expect(events.length).toBe(1);
      expect(events[0]!.length).toBe(2);

      await pagedState.loadPage(page1.nextCursor);
      expect(events.length).toBe(2);
      expect(events[1]!.length).toBe(4);

      pagedState.destroy();
    });

    it("should clear prompts and emit event", async () => {
      await client!.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: createNumberedPrompts(3),
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
        },
      );

      await client.connect();
      const pagedState = new PagedPromptsState(client);
      await pagedState.loadPage();
      expect(pagedState.getPrompts().length).toBe(3);

      const events: Prompt[][] = [];
      pagedState.addEventListener("promptsChange", (e) => {
        events.push(e.detail);
      });

      pagedState.clear();
      expect(pagedState.getPrompts().length).toBe(0);
      expect(events.length).toBe(1);
      expect(events[0]!.length).toBe(0);

      pagedState.destroy();
    });
  });

  describe("Progress Tracking", () => {
    it("should dispatch progressNotification events when progress notifications are received", async () => {
      const { createSendProgressTool } =
        await import("@modelcontextprotocol/inspector-test-server");

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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
          progress: true,
        },
      );

      await client.connect();

      const progressToken = 12345;

      const sendProgressTool = await getTool(client, "send_progress");
      client.callTool(
        sendProgressTool,
        {
          units: 3,
          delayMs: 50,
          total: 3,
          message: "Test progress",
        },
        undefined, // generalMetadata
        { progressToken: progressToken.toString() }, // toolSpecificMetadata
      );

      const progressEvents = await waitForProgressCount(client, 3, {
        timeout: 3000,
      });

      expect(progressEvents.length).toBe(3);
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

      await client!.disconnect();
      await server.stop();
    });

    it("should not dispatch progressNotification events when progress is disabled", async () => {
      const { createSendProgressTool } =
        await import("@modelcontextprotocol/inspector-test-server");

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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
          progress: false, // Disable progress
        },
      );

      await client.connect();

      const progressEvents: Progress[] = [];
      const progressListener = (event: TypedEvent<"progressNotification">) => {
        progressEvents.push(event.detail);
      };
      client.addEventListener("progressNotification", progressListener);

      const progressToken = 12345;

      // Call the tool with progressToken in metadata
      const sendProgressTool = await getTool(client, "send_progress");
      await client.callTool(
        sendProgressTool,
        {
          units: 2,
          delayMs: 50,
        },
        undefined, // generalMetadata
        { progressToken: progressToken.toString() }, // toolSpecificMetadata
      );

      // Observation window: we assert no progressNotification events; can't wait for a non-event.
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Remove listener
      client.removeEventListener("progressNotification", progressListener);

      // Verify no progress events were received
      expect(progressEvents.length).toBe(0);

      await client!.disconnect();
      await server.stop();
    });

    it("should handle progress notifications without total", async () => {
      const { createSendProgressTool } =
        await import("@modelcontextprotocol/inspector-test-server");

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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
          progress: true,
        },
      );

      await client.connect();

      const progressToken = 67890;

      const sendProgressTool2 = await getTool(client, "send_progress");
      client.callTool(
        sendProgressTool2,
        {
          units: 2,
          delayMs: 50,
          message: "Indeterminate progress",
        },
        undefined, // generalMetadata
        { progressToken: progressToken.toString() }, // toolSpecificMetadata
      );

      const progressEvents = await waitForProgressCount(client, 2, {
        timeout: 3000,
      });

      expect(progressEvents.length).toBe(2);
      expect(progressEvents[0]).toMatchObject({
        progress: 1,
        message: "Indeterminate progress (1/2)",
        progressToken: progressToken.toString(),
      });
      expect((progressEvents[0] as { total?: number }).total).toBeUndefined();

      expect(progressEvents[1]).toMatchObject({
        progress: 2,
        message: "Indeterminate progress (2/2)",
        progressToken: progressToken.toString(),
      });
      expect((progressEvents[1] as { total?: number }).total).toBeUndefined();

      await client!.disconnect();
      await server.stop();
    });

    it("should complete when timeout and resetTimeoutOnProgress are set (options passed through)", async () => {
      const { createSendProgressTool } =
        await import("@modelcontextprotocol/inspector-test-server");

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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
          progress: true,
          timeout: 2000,
          resetTimeoutOnProgress: true,
        },
      );

      await client.connect();

      const progressToken = 999;
      const sendProgressTool = await getTool(client, "send_progress");
      const result = await client.callTool(
        sendProgressTool,
        { units: 3, delayMs: 100, total: 3, message: "Timeout test" },
        undefined,
        { progressToken: progressToken.toString() },
      );

      expect(result.success).toBe(true);
      expect((result.result as { content?: unknown[] }).content).toBeDefined();
      const text = (
        result.result as { content?: { type: string; text?: string }[] }
      ).content?.find((c) => c.type === "text")?.text;
      expect(text).toContain("Completed 3 progress notifications");

      await client.disconnect();
      await server.stop();
    });

    it("should not timeout when resetTimeoutOnProgress is true and progress is sent (reset extends timeout)", async () => {
      const { createSendProgressTool } =
        await import("@modelcontextprotocol/inspector-test-server");

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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
          progress: true,
          timeout: 350,
          resetTimeoutOnProgress: true,
        },
      );

      await client.connect();

      const sendProgressTool = await getTool(client, "send_progress");
      const result = await client.callTool(
        sendProgressTool,
        { units: 4, delayMs: 200, total: 4, message: "Reset test" },
        undefined,
        { progressToken: "reset-test" },
      );

      expect(result.success).toBe(true);
      expect((result.result as { content?: unknown[] }).content).toBeDefined();
      const text = (
        result.result as { content?: { type: string; text?: string }[] }
      ).content?.find((c) => c.type === "text")?.text;
      expect(text).toContain("Completed 4 progress notifications");

      await client.disconnect();
      await server.stop();
    });

    it("should timeout with RequestTimeout when resetTimeoutOnProgress is false and gap exceeds timeout", async () => {
      const { createSendProgressTool } =
        await import("@modelcontextprotocol/inspector-test-server");

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
          environment: { transport: createTransportNode },
          clientIdentity: { name: "test", version: "1.0.0" },
          progress: true,
          timeout: 150,
          resetTimeoutOnProgress: false,
        },
      );

      await client.connect();

      const progressToken = 888;
      const sendProgressToolTimeout = await getTool(client, "send_progress");
      let err: unknown;
      try {
        await client.callTool(
          sendProgressToolTimeout,
          { units: 4, delayMs: 200, total: 4, message: "Timeout test" },
          undefined,
          { progressToken: progressToken.toString() },
        );
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(McpError);
      expect((err as McpError).code).toBe(ErrorCode.RequestTimeout);

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
          environment: { transport: createTransportNode },
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
          environment: { transport: createTransportNode },
          pipeStderr: true,
        },
      );

      const stderrLogState = new StderrLogState(client);
      await client.connect();

      const testMessage = `stderr-direct-${Date.now()}`;
      const writeToStderrTool = await getTool(client, "write_to_stderr");
      await client.callTool(writeToStderrTool, { message: testMessage });

      const logs = stderrLogState.getStderrLogs();
      expect(Array.isArray(logs)).toBe(true);
      const matching = logs.filter((l) => l.message.includes(testMessage));
      expect(matching.length).toBeGreaterThan(0);
      expect(matching[0]!.message).toContain(testMessage);
      stderrLogState.destroy();
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
          environment: { transport: createTransportNode },
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
          environment: { transport: createTransportNode },
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
          environment: { transport: createTransportNode },
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
      // Create a test server with the collect_sample tool
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
          environment: { transport: createTransportNode },
          sample: true, // Enable sampling capability
        },
      );

      await client.connect();

      // Set up Promise to wait for sampling request event
      const samplingRequestPromise = new Promise<SamplingCreateMessage>(
        (resolve) => {
          client!.addEventListener(
            "newPendingSample",
            (event) => {
              resolve(event.detail);
            },
            { once: true },
          );
        },
      );

      // Start the tool call (don't await yet - it will block until sampling is responded to)
      const collectSampleTool = await getTool(client, "collect_sample");
      const toolResultPromise = client.callTool(collectSampleTool, {
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
      const toolContent = toolResult.result!.content as ContentBlock[];
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
      // Note: stdio test server uses getDefaultServerConfig which now includes send_notification tool
      // Create client with stdio transport
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          environment: { transport: createTransportNode },
        },
      );

      await client.connect();

      // Set up Promise to wait for notification
      const notificationPromise = new Promise<MessageEntry>((resolve) => {
        client!.addEventListener("message", (event) => {
          const entry = event.detail;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        });
      });

      // Call the send_notification tool
      const sendNotifTool = await getTool(client, "send_notification");
      await client.callTool(sendNotifTool, {
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
          const params = notificationEntry.message.params as Record<
            string,
            unknown
          >;
          expect((params.data as { message: string }).message).toBe(
            "Test notification from stdio",
          );
          expect(params.level).toBe("info");
          expect(params.logger).toBe("test-server");
        }
      }
    });

    it("should receive server-initiated notifications via SSE transport", async () => {
      // Create a test server with the send_notification tool and logging enabled
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
          environment: { transport: createTransportNode },
        },
      );

      await client.connect();

      // Set up Promise to wait for notification
      const notificationPromise = new Promise<MessageEntry>((resolve) => {
        client!.addEventListener("message", (event) => {
          const entry = event.detail;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        });
      });

      // Call the send_notification tool
      const sendNotifToolSse = await getTool(client, "send_notification");
      await client.callTool(sendNotifToolSse, {
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
          const params = notificationEntry.message.params as Record<
            string,
            unknown
          >;
          expect((params.data as { message: string }).message).toBe(
            "Test notification from SSE",
          );
          expect(params.level).toBe("warning");
          expect(params.logger).toBe("test-server");
        }
      }
    });

    it("should receive server-initiated notifications via streamable-http transport", async () => {
      // Create a test server with the send_notification tool and logging enabled
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
          environment: { transport: createTransportNode },
        },
      );

      await client.connect();

      // Set up Promise to wait for notification
      const notificationPromise = new Promise<MessageEntry>((resolve) => {
        client!.addEventListener("message", (event) => {
          const entry = event.detail;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        });
      });

      // Call the send_notification tool
      const sendNotifToolHttp = await getTool(client, "send_notification");
      await client.callTool(sendNotifToolHttp, {
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
          const params = notificationEntry.message.params as Record<
            string,
            unknown
          >;
          expect((params.data as { message: string }).message).toBe(
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
          environment: { transport: createTransportNode },
          elicit: true, // Enable elicitation capability
        },
      );

      await client.connect();

      // Set up Promise to wait for elicitation request event
      const elicitationRequestPromise = new Promise<ElicitationCreateMessage>(
        (resolve) => {
          client!.addEventListener(
            "newPendingElicitation",
            (event) => {
              resolve(event.detail);
            },
            { once: true },
          );
        },
      );

      // Start the tool call (don't await yet - it will block until elicitation is responded to)
      const collectElicitationTool = await getTool(
        client,
        "collect_elicitation",
      );
      const toolResultPromise = client.callTool(collectElicitationTool, {
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
      const toolContent = toolResult.result!.content as ContentBlock[];
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
      // Create a test server with the collect_url_elicitation tool
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
          environment: { transport: createTransportNode },
          elicit: { url: true }, // Enable elicitation capability
        },
      );

      await client.connect();

      // Set up Promise to wait for elicitation request event
      const elicitationRequestPromise = new Promise<ElicitationCreateMessage>(
        (resolve) => {
          client!.addEventListener(
            "newPendingElicitation",
            (event) => {
              resolve(event.detail);
            },
            { once: true },
          );
        },
      );

      // Start the tool call (don't await yet - it will block until elicitation is responded to)
      const collectUrlElicitationTool = await getTool(
        client,
        "collect_url_elicitation",
      );
      const toolResultPromise = client.callTool(collectUrlElicitationTool, {
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
      const toolContent = toolResult.result!.content as ContentBlock[];
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

    it("should handle url_elicitation_form: accept elicitation, receive completion notification, update pending state, and return tool result", async () => {
      const submittedValue = "inspector-client-test-value-99";

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createUrlElicitationFormTool()],
        serverType: "streamable-http",
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          elicit: { url: true },
        },
      );

      await client.connect();

      // Track pendingElicitationsChange events: expect [1] when elicitation arrives, [0] when complete notification received
      const pendingElicitationsChangeEvents: ElicitationCreateMessage[][] = [];
      client!.addEventListener(
        "pendingElicitationsChange",
        (event: TypedEvent<"pendingElicitationsChange">) => {
          pendingElicitationsChangeEvents.push([...event.detail]);
        },
      );

      const elicitationRequestPromise = new Promise<ElicitationCreateMessage>(
        (resolve) => {
          client!.addEventListener(
            "newPendingElicitation",
            (event) => resolve(event.detail),
            { once: true },
          );
        },
      );

      const urlElicitationFormTool = await getTool(
        client,
        "url_elicitation_form",
      );
      const toolResultPromise = client.callTool(urlElicitationFormTool, {});

      const pendingElicitation = await elicitationRequestPromise;

      expect(pendingElicitation.request.method).toBe("elicitation/create");
      expect(pendingElicitation.request.params?.mode).toBe("url");
      const url =
        pendingElicitation.request.params?.mode === "url"
          ? pendingElicitation.request.params.url
          : null;
      const elicitationId =
        pendingElicitation.request.params?.mode === "url"
          ? pendingElicitation.request.params.elicitationId
          : null;
      expect(url).toBeTruthy();
      expect(elicitationId).toBeTruthy();

      expect(client.getPendingElicitations()).toHaveLength(1);

      // Respond with accept (unblocks server); then submit form to trigger completion notification
      await pendingElicitation.respond({ action: "accept" });

      const formData = new URLSearchParams({
        value: submittedValue,
        elicitation: elicitationId!,
      });
      await fetch(url!, {
        method: "POST",
        body: formData,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const toolResult = await toolResultPromise;

      expect(toolResult).toBeDefined();
      expect(toolResult.success).toBe(true);
      expect(toolResult.result?.content).toBeDefined();
      const content = toolResult.result!.content as Array<{
        type: string;
        text?: string;
      }>;
      const textBlock = content.find((c) => c.type === "text");
      expect(textBlock?.text).toContain("Collected value:");
      expect(textBlock?.text).toContain(submittedValue);

      expect(client.getPendingElicitations()).toHaveLength(0);

      // Verify event sequence: addPendingElicitation -> [1], then complete notification -> [0]
      expect(pendingElicitationsChangeEvents.length).toBeGreaterThanOrEqual(2);
      expect(pendingElicitationsChangeEvents[0]).toHaveLength(1);
      const lastEvent =
        pendingElicitationsChangeEvents[
          pendingElicitationsChangeEvents.length - 1
        ];
      expect(lastEvent).toHaveLength(0);
    });
  });

  describe("Roots Support", () => {
    it("should handle roots/list request from server and return roots", async () => {
      // Create a test server with the list_roots tool
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
          environment: { transport: createTransportNode },
          roots: initialRoots, // Enable roots capability
        },
      );

      await client.connect();

      // Call the list_roots tool - it will call roots/list on the client
      const listRootsTool = await getTool(client, "list_roots");
      const toolResult = await client.callTool(listRootsTool, {});

      // Verify the tool result contains the roots
      expect(toolResult).toBeDefined();
      expect(toolResult.success).toBe(true);
      expect(toolResult.result).toBeDefined();
      expect(toolResult.result!.content).toBeDefined();
      expect(Array.isArray(toolResult.result!.content)).toBe(true);
      const toolContent = toolResult.result!.content as ContentBlock[];
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
          environment: { transport: createTransportNode },
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

      const rootsChangedNotification = await server.waitUntilRecorded(
        (req) => req.method === "notifications/roots/list_changed",
        { timeout: 5000, interval: 10 },
      );

      expect(rootsChangedNotification.method).toBe(
        "notifications/roots/list_changed",
      );

      // Verify getRoots() returns the new roots
      const roots = client.getRoots();
      expect(roots).toEqual(newRoots);

      // Verify rootsChange event was dispatched
      const rootsChangePromise = new Promise<CustomEvent>((resolve) => {
        client!.addEventListener(
          "rootsChange",
          (event) => {
            resolve(event);
          },
          { once: true },
        );
      });

      await client.setRoots([{ uri: "file:///updated", name: "Updated" }]);

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

      await client!.disconnect();
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
          environment: { transport: createTransportNode },
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
      const cityCompletions = (value: string): string[] => {
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
          environment: { transport: createTransportNode },
        },
      );

      await client.connect();

      // Request completions for "city" argument with partial value "New"
      const result = await client.getCompletions(
        { type: "ref/prompt", name: "args_prompt" },
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
          environment: { transport: createTransportNode },
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
          environment: { transport: createTransportNode },
        },
      );

      await client.connect();

      // Request completions for "state" with context (city="New York")
      const result = await client.getCompletions(
        { type: "ref/prompt", name: "args_prompt" },
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
        // Simulate async I/O in completion callback; fixture behavior, not a test wait.
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
          environment: { transport: createTransportNode },
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
          environment: { transport: createTransportNode },
        },
      );
      await client.connect();
    });

    it("should detect task capabilities", () => {
      const capabilities = client!.getTaskCapabilities();
      expect(capabilities).toBeDefined();
      expect(capabilities?.list).toBe(true);
      expect(capabilities?.cancel).toBe(true);
    });

    it("should list tasks (empty initially)", async () => {
      const result = await client!.listRequestorTasks();
      expect(result).toHaveProperty("tasks");
      expect(Array.isArray(result.tasks)).toBe(true);
    });

    it("should run tool as task (callTool with taskOptions returns task reference, poll getRequestorTask/getRequestorTaskResult yields result)", async () => {
      // Same path as web App "Run as task": callTool with taskOptions -> task reference -> poll until completed
      const optionalTaskTool = await getTool(client!, "optional_task");
      const invocation = await client!.callTool(
        optionalTaskTool,
        { message: "e2e-run-as-task" },
        undefined,
        undefined,
        { ttl: 5000 },
      );

      expect(invocation.success).toBe(true);
      expect(invocation.result).toBeDefined();
      expect(typeof invocation.result).toBe("object");
      const rawResult = invocation.result as Record<string, unknown>;
      expect(rawResult.task).toBeDefined();
      const taskRef = rawResult.task as {
        taskId: string;
        status: string;
        pollInterval?: number;
      };
      expect(taskRef.taskId).toBeDefined();
      expect(typeof taskRef.taskId).toBe("string");
      expect(taskRef.taskId.length).toBeGreaterThan(0);
      expect(taskRef.status).toBeDefined();
      expect(typeof taskRef.status).toBe("string");

      const taskId = taskRef.taskId;
      const pollIntervalMs = taskRef.pollInterval ?? 1000;
      const timeoutMs = 12000;
      const start = Date.now();
      let task = await client!.getRequestorTask(taskId);
      while (
        task.status !== "completed" &&
        task.status !== "failed" &&
        task.status !== "cancelled"
      ) {
        expect(Date.now() - start).toBeLessThan(timeoutMs);
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        task = await client!.getRequestorTask(taskId);
      }

      expect(task.status).toBe("completed");

      const result = await client!.getRequestorTaskResult(taskId);
      expect(result).toBeDefined();
      expect(result).toHaveProperty("content");
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBe(1);
      const firstContent = result.content[0];
      expect(firstContent).toBeDefined();
      expect(firstContent!.type).toBe("text");
      expect(firstContent!).toHaveProperty("text");
      const resultText = JSON.parse((firstContent as { text: string }).text);
      expect(resultText.message).toBe("Task completed: e2e-run-as-task");
      expect(resultText.taskId).toBe(taskId);

      const listResult = await client!.listRequestorTasks();
      const found = listResult.tasks.some((t) => t.taskId === taskId);
      expect(found).toBe(true);
    });

    it("should call tool with task support using callToolStream", async () => {
      const toolCallTaskUpdatedEvents: Array<{
        taskId: string;
        task: Task;
        result?: CallToolResult;
        error?: unknown;
      }> = [];
      const toolCallResultEvents: Array<{
        toolName: string;
        params: Record<string, JsonValue>;
        result: CallToolResult | null;
        timestamp: Date;
        success: boolean;
        error?: string;
        metadata?: Record<string, string>;
      }> = [];

      client!.addEventListener(
        "toolCallTaskUpdated",
        (event: TypedEvent<"toolCallTaskUpdated">) => {
          toolCallTaskUpdatedEvents.push(event.detail);
        },
      );
      client!.addEventListener(
        "toolCallResultChange",
        (event: TypedEvent<"toolCallResultChange">) => {
          toolCallResultEvents.push(event.detail);
        },
      );

      const simpleTaskTool = await getTool(client!, "simple_task");
      const result = await client!.callToolStream(simpleTaskTool, {
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

      // Validate toolCallTaskUpdated events - first is task created, then status updates, last has result
      expect(toolCallTaskUpdatedEvents.length).toBeGreaterThanOrEqual(1);
      const createdEvent = toolCallTaskUpdatedEvents[0]!;
      expect(createdEvent.taskId).toBeDefined();
      expect(typeof createdEvent.taskId).toBe("string");
      expect(createdEvent.task).toBeDefined();
      expect(createdEvent.task.taskId).toBe(createdEvent.taskId);
      expect(createdEvent.task.status).toBe("working");
      expect(createdEvent.task).toHaveProperty("ttl");
      expect(createdEvent.task).toHaveProperty("lastUpdatedAt");

      const taskId = createdEvent.taskId;

      // All events are for the same task and have valid structure
      const statuses = toolCallTaskUpdatedEvents.map((event) => {
        expect(event.taskId).toBe(taskId);
        expect(event.task.taskId).toBe(taskId);
        expect(event.task).toHaveProperty("status");
        expect(event.task).toHaveProperty("ttl");
        expect(event.task).toHaveProperty("lastUpdatedAt");
        if (event.task.lastUpdatedAt) {
          expect(typeof event.task.lastUpdatedAt).toBe("string");
          expect(() => new Date(event.task.lastUpdatedAt!)).not.toThrow();
        }
        return event.task.status;
      });

      expect(statuses[statuses.length - 1]).toBe("completed");
      statuses.forEach((status) => {
        expect(["working", "completed"]).toContain(status);
      });
      if (toolCallTaskUpdatedEvents.length > 1) {
        expect(statuses[0]).toBe("working");
        expect(statuses[statuses.length - 1]).toBe("completed");
      } else {
        expect(statuses[0]).toBe("completed");
      }

      // Last event must have result (completed)
      const completedEvent = toolCallTaskUpdatedEvents.find(
        (e) => e.result !== undefined,
      )!;
      expect(completedEvent).toBeDefined();
      expect(completedEvent.taskId).toBe(taskId);
      expect(completedEvent.result).toBeDefined();
      expect(completedEvent.result).toEqual(toolResult);

      // Validate toolCallResultChange event
      expect(toolCallResultEvents.length).toBe(1);
      const toolCallEvent = toolCallResultEvents[0]!;
      expect(toolCallEvent.toolName).toBe("simple_task");
      expect(toolCallEvent.params).toEqual({ message: "test task" });
      expect(toolCallEvent.success).toBe(true);
      expect(toolCallEvent.result).toEqual(toolResult);
      expect(toolCallEvent.timestamp).toBeInstanceOf(Date);

      // Validate task in requestor tasks (from server list)
      const { tasks: requestorTasks } = await client!.listRequestorTasks();
      const cachedTask = requestorTasks.find((t) => t.taskId === taskId);
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

    it("should accept taskOptions (ttl) in callToolStream", async () => {
      const simpleTaskTtlTool = await getTool(client!, "simple_task");
      const result = await client!.callToolStream(
        simpleTaskTtlTool,
        { message: "ttl-test" },
        undefined,
        undefined,
        { ttl: 99999 },
      );
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      const { tasks } = await client!.listRequestorTasks();
      const task = tasks.find((t) => t.taskId && t.status === "completed");
      expect(task).toBeDefined();
      expect(task).toHaveProperty("ttl");
    });

    it("should get task by taskId", async () => {
      // First create a task
      const simpleTaskByIdTool = await getTool(client!, "simple_task");
      const result = await client!.callToolStream(simpleTaskByIdTool, {
        message: "test",
      });
      expect(result.success).toBe(true);

      // Get the taskId from server task list
      const { tasks: activeTasks } = await client!.listRequestorTasks();
      expect(activeTasks.length).toBeGreaterThan(0);
      const activeTask = activeTasks[0];
      expect(activeTask).toBeDefined();
      const taskId = activeTask!.taskId;

      // Get the task
      const task = await client!.getRequestorTask(taskId);
      expect(task).toBeDefined();
      expect(task.taskId).toBe(taskId);
      expect(task.status).toBe("completed");
    });

    it("should get task result", async () => {
      // First create a task
      const simpleTaskResultTool = await getTool(client!, "simple_task");
      const result = await client!.callToolStream(simpleTaskResultTool, {
        message: "test result",
      });
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result).not.toBeNull();

      // Get the taskId from server task list
      const { tasks: requestorTasks } = await client!.listRequestorTasks();
      expect(requestorTasks.length).toBeGreaterThan(0);
      const task = requestorTasks.find((t) => t.status === "completed");
      expect(task).toBeDefined();
      const taskId = task!.taskId;

      // Get the task result
      const taskResult = await client!.getRequestorTaskResult(taskId);

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
      const simpleTaskRequiredTool = await getTool(client!, "simple_task");
      await expect(
        client!.callTool(simpleTaskRequiredTool, { message: "test" }),
      ).rejects.toThrow("requires task support");
    });

    it("should clear tasks on disconnect", async () => {
      // Create a task
      const simpleTaskDisconnectTool = await getTool(client!, "simple_task");
      await client!.callToolStream(simpleTaskDisconnectTool, {
        message: "test",
      });
      const listBefore = await client!.listRequestorTasks();
      expect(listBefore.tasks.length).toBeGreaterThan(0);

      // Disconnect
      await client!.disconnect();

      // After disconnect we cannot list tasks (not connected); test that client is disconnected
      expect(client!.getStatus()).toBe("disconnected");
    });

    it("should call tool with taskSupport: forbidden (immediate result, no task)", async () => {
      // forbiddenTask should return immediately without creating a task
      const forbiddenTaskTool = await getTool(client!, "forbidden_task");
      const result = await client!.callToolStream(forbiddenTaskTool, {
        message: "test",
      });

      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty("content");
      // No task should be created (forbidden_task returns immediately)
      const { tasks } = await client!.listRequestorTasks();
      expect(tasks.length).toBe(0);
    });

    it("should call tool with taskSupport: optional (may or may not create task)", async () => {
      // optionalTask may create a task or return immediately
      const optionalTaskStreamTool = await getTool(client!, "optional_task");
      const result = await client!.callToolStream(optionalTaskStreamTool, {
        message: "test",
      });

      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty("content");
      // Task may or may not be created - both are valid
    });

    it("should handle task failure and dispatch taskFailed event", async () => {
      await client!.disconnect();
      await server?.stop();

      // Create a task tool that will fail after a short delay
      const failingTask = createTaskTool({
        name: "failingTask",
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
          environment: { transport: createTransportNode },
        },
      );
      await client!.connect();

      const failedPromise = expect(
        (async () => {
          const failingTaskTool = await getTool(client!, "failingTask");
          return client!.callToolStream(failingTaskTool, { message: "test" });
        })(),
      ).rejects.toThrow();

      const taskFailedDetail = await new Promise<{
        taskId: string;
        task: Task;
        error: unknown;
      }>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error("Timeout waiting for toolCallTaskUpdated with error"),
            ),
          2000,
        );
        const handler = (
          e: Event & {
            detail: { taskId: string; task: Task; error?: unknown };
          },
        ) => {
          if (e.detail.error !== undefined) {
            clearTimeout(timeout);
            client!.removeEventListener("toolCallTaskUpdated", handler);
            resolve(e.detail);
          }
        };
        client!.addEventListener("toolCallTaskUpdated", handler);
      });
      expect(taskFailedDetail.taskId).toBeDefined();
      expect(taskFailedDetail.error).toBeDefined();

      await failedPromise;
    });

    it("should cancel a running task", async () => {
      await client!.disconnect();
      await server?.stop();

      // Create a longer-running task tool
      const longRunningTask = createTaskTool({
        name: "longRunningTask",
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
          environment: { transport: createTransportNode },
        },
      );
      await client!.connect();

      const longRunningTaskTool = await getTool(client!, "longRunningTask");
      const taskPromise = client!.callToolStream(longRunningTaskTool, {
        message: "test",
      });

      const taskCreatedDetail = await waitForEvent<{
        taskId: string;
        task: Task;
      }>(client, "toolCallTaskUpdated", { timeout: 3000 });
      const taskId = taskCreatedDetail.taskId;
      expect(taskId).toBeDefined();

      const cancelledPromise = waitForEvent<{ taskId: string }>(
        client,
        "taskCancelled",
        { timeout: 3000 },
      );
      await client!.cancelRequestorTask(taskId);

      const [cancelledResult, taskResult] = await Promise.allSettled([
        cancelledPromise,
        taskPromise,
      ]);
      expect(cancelledResult.status).toBe("fulfilled");
      const cancelledDetail = (
        cancelledResult as PromiseFulfilledResult<{ taskId: string }>
      ).value;
      expect(cancelledDetail.taskId).toBe(taskId);
      expect(taskResult.status).toBe("rejected");

      const task = await client!.getRequestorTask(taskId);
      expect(task.status).toBe("cancelled");
    });

    it("should handle elicitation with task (input_required flow)", async () => {
      await client!.disconnect();
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
          environment: { transport: createTransportNode },
          elicit: true,
        },
      );
      await client.connect();

      const elicitationPromise = waitForEvent<ElicitationCreateMessage>(
        client,
        "newPendingElicitation",
        { timeout: 2000 },
      );
      const taskWithElicitationTool = await getTool(
        client,
        "taskWithElicitation",
      );
      const taskPromise = client.callToolStream(taskWithElicitationTool, {
        message: "test",
      });

      const elicitation = await elicitationPromise;

      // Verify elicitation was received
      expect(elicitation).toBeDefined();

      // Verify task status is input_required (if taskId was extracted)
      if (elicitation.taskId) {
        const { tasks: activeTasks } = await client.listRequestorTasks();
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
      await client!.disconnect();
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
          environment: { transport: createTransportNode },
          sample: true,
        },
      );
      await client!.connect();

      const samplingPromise = waitForEvent<SamplingCreateMessage>(
        client,
        "newPendingSample",
        { timeout: 3000 },
      );
      const taskCreatedPromise = waitForEvent<{ taskId: string; task: Task }>(
        client,
        "toolCallTaskUpdated",
        { timeout: 3000 },
      );
      const taskWithSamplingTool = await getTool(client!, "taskWithSampling");
      const taskPromise = client!.callToolStream(taskWithSamplingTool, {
        message: "test",
      });

      const sample = await samplingPromise;
      expect(sample).toBeDefined();

      const taskCreatedDetail = await taskCreatedPromise;
      const task = await client!.getRequestorTask(taskCreatedDetail.taskId);
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
      await client!.disconnect();
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
          environment: { transport: createTransportNode },
          progress: true,
        },
      );
      await client!.connect();

      const progressToken = Math.random().toString();

      const taskCreatedPromise = waitForEvent<{ taskId: string; task: Task }>(
        client,
        "toolCallTaskUpdated",
        { timeout: 5000 },
      );
      const progressPromise = waitForProgressCount(client!, 5, {
        timeout: 5000,
      });
      const taskWithProgressTool = await getTool(client!, "taskWithProgress");
      const resultPromise = client!.callToolStream(
        taskWithProgressTool,
        { message: "test" },
        undefined,
        { progressToken },
      );

      const taskCreatedDetail = await taskCreatedPromise;
      const taskId = taskCreatedDetail.taskId;
      expect(taskId).toBeDefined();

      const taskCompletedDetail = await new Promise<{
        taskId: string;
        task: Task;
        result: unknown;
      }>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error("Timeout waiting for toolCallTaskUpdated with result"),
            ),
          5000,
        );
        const handler = (
          e: Event & {
            detail: { taskId: string; task: Task; result?: unknown };
          },
        ) => {
          if (e.detail.result !== undefined) {
            clearTimeout(timeout);
            client!.removeEventListener("toolCallTaskUpdated", handler);
            resolve(e.detail);
          }
        };
        client!.addEventListener("toolCallTaskUpdated", handler);
      });

      const progressEvents = await progressPromise;
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

      expect(taskCompletedDetail.taskId).toBe(taskId);
      expect(taskCompletedDetail.result).toBeDefined();
      expect(taskCompletedDetail.result).toEqual(toolResult);

      expect(progressEvents.length).toBe(5);
      progressEvents.forEach((evt: unknown, index: number) => {
        const event = evt as {
          progressToken: string;
          progress: number;
          total: number;
          message: string;
          _meta?: Record<string, unknown>;
        };
        expect(event.progressToken).toBe(progressToken);
        expect(event.progress).toBe(index + 1);
        expect(event.total).toBe(5);
        expect(event.message).toBe(`Processing... ${index + 1}/5`);
        expect(event._meta).toBeDefined();
        expect(event._meta?.[RELATED_TASK_META_KEY]).toBeDefined();
        const relatedTask = event._meta?.[RELATED_TASK_META_KEY] as {
          taskId: string;
        };
        expect(relatedTask.taskId).toBe(taskId);
      });

      // Verify task is in completed state (from server list)
      const { tasks: activeTasks } = await client!.listRequestorTasks();
      const completedTask = activeTasks.find((t) => t.taskId === taskId);
      expect(completedTask).toBeDefined();
      expect(completedTask!.status).toBe("completed");
    });

    it("should handle listTasks pagination", async () => {
      const simpleTaskPaginationTool = await getTool(client!, "simple_task");
      await client!.callToolStream(simpleTaskPaginationTool, {
        message: "task1",
      });
      await client!.callToolStream(simpleTaskPaginationTool, {
        message: "task2",
      });
      await client!.callToolStream(simpleTaskPaginationTool, {
        message: "task3",
      });
      const result = await client!.listRequestorTasks();
      expect(result.tasks.length).toBeGreaterThan(0);

      // If there's a nextCursor, test pagination
      if (result.nextCursor) {
        const nextPage = await client!.listRequestorTasks(result.nextCursor);
        expect(nextPage.tasks).toBeDefined();
        expect(Array.isArray(nextPage.tasks)).toBe(true);
      }
    });
  });

  describe("Receiver tasks (e2e)", () => {
    it("server sends createMessage with params.task, client returns task, test responds, server gets payload via tasks/get and tasks/result", async () => {
      if (client) await client.disconnect();
      client = null;
      await server?.stop();

      const config = {
        ...getTaskServerConfig(),
        serverType: "sse" as const,
        tools: [
          createTaskTool({
            name: "receiverE2ESampling",
            samplingText: "Reply for e2e",
            receiverTaskTtl: 5000,
          }),
          ...(getTaskServerConfig().tools || []),
        ],
      };
      server = createTestServerHttp(config);
      await server.start();
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          sample: true,
          receiverTasks: true,
          receiverTaskTtlMs: 10_000,
        },
      );
      await client.connect();

      const samplingPromise = waitForEvent<SamplingCreateMessage>(
        client,
        "newPendingSample",
        { timeout: 5000 },
      );
      const receiverE2ESamplingTool = await getTool(
        client,
        "receiverE2ESampling",
      );
      const taskPromise = client.callToolStream(receiverE2ESamplingTool, {
        message: "e2e",
      });

      const sample = await samplingPromise;
      expect(sample).toBeDefined();

      await sample.respond({
        model: "e2e-model",
        role: "assistant",
        stopReason: "endTurn",
        content: { type: "text", text: "E2E receiver response" },
      });

      const result = await taskPromise;
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result).not.toBeNull();
      expect(result.result!.content).toBeDefined();
      const content = result.result!.content!;
      const textBlock = Array.isArray(content) ? content[0] : content;
      expect(textBlock).toBeDefined();
      expect(
        textBlock &&
          typeof textBlock === "object" &&
          "type" in textBlock &&
          textBlock.type === "text",
      ).toBe(true);
      if (textBlock && typeof textBlock === "object" && "text" in textBlock) {
        expect((textBlock as { text: string }).text).toBe(
          "E2E receiver response",
        );
      }
    });

    it("server sends elicit with params.task, client returns task, test responds, server gets payload via tasks/get and tasks/result", async () => {
      if (client) await client.disconnect();
      client = null;
      await server?.stop();

      const config = {
        ...getTaskServerConfig(),
        serverType: "sse" as const,
        tools: [
          createTaskTool({
            name: "receiverE2EElicit",
            elicitationSchema: z.object({
              input: z.string().describe("User input"),
            }),
            receiverTaskTtl: 5000,
          }),
          ...(getTaskServerConfig().tools || []),
        ],
      };
      server = createTestServerHttp(config);
      await server.start();
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          environment: { transport: createTransportNode },
          elicit: true,
          receiverTasks: true,
          receiverTaskTtlMs: 10_000,
        },
      );
      await client.connect();

      const elicitationPromise = waitForEvent<ElicitationCreateMessage>(
        client,
        "newPendingElicitation",
        { timeout: 5000 },
      );
      const receiverE2EElicitTool = await getTool(client, "receiverE2EElicit");
      const taskPromise = client.callToolStream(receiverE2EElicitTool, {
        message: "e2e",
      });

      const elicitation = await elicitationPromise;
      expect(elicitation).toBeDefined();

      await elicitation.respond({
        action: "accept",
        content: { input: "E2E elicitation input" },
      });

      const result = await taskPromise;
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result).not.toBeNull();
      expect(result.result!.content).toBeDefined();
      // Elicit payload from tasks/result is JSON in a text block
      const content = result.result!.content!;
      const textBlock = Array.isArray(content) ? content[0] : content;
      expect(
        textBlock && typeof textBlock === "object" && "text" in textBlock,
      ).toBe(true);
      const parsed = JSON.parse((textBlock as { text: string }).text) as Record<
        string,
        unknown
      >;
      expect(parsed.input).toBe("E2E elicitation input");
    });
  });
});
