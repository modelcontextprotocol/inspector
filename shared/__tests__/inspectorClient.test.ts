import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  InspectorClient,
  SamplingCreateMessage,
} from "../mcp/inspectorClient.js";
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
  createSendNotificationTool,
} from "../test/test-server-fixtures.js";
import type { MessageEntry } from "../mcp/types.js";
import type { CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";

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
      await client.listTools();
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
      await client.listTools();

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
      await client.listTools();

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
        await client.listTools();
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
        const customEvent = event as CustomEvent<MessageEntry>;
        messageEvents.push(customEvent.detail);
      });

      await client.connect();
      await client.listTools();

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
      await client.listTools();

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
      await client.listTools();

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
      await client.listTools();

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
      await client.listTools();

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
        await client.listTools();
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
        const customEvent = event as CustomEvent<any>;
        fetchRequestEvents.push(customEvent.detail);
      });

      await client.connect();
      await client.listTools();

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
      await client.listTools();

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
        const customEvent = event as CustomEvent<any[]>;
        toolsEvents.push(customEvent.detail);
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
      const result = await client.listTools();
      expect(result).toHaveProperty("tools");
      const tools = result.tools as any[];
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should call tool with string arguments", async () => {
      const result = await client.callTool("echo", {
        message: "hello world",
      });

      expect(result).toHaveProperty("content");
      const content = result.content as any[];
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]).toHaveProperty("type", "text");
      expect(content[0].text).toContain("hello world");
    });

    it("should call tool with number arguments", async () => {
      const result = await client.callTool("get-sum", {
        a: 42,
        b: 58,
      });

      expect(result).toHaveProperty("content");
      const content = result.content as any[];
      const resultData = JSON.parse(content[0].text);
      expect(resultData.result).toBe(100);
    });

    it("should call tool with boolean arguments", async () => {
      const result = await client.callTool("get-annotated-message", {
        messageType: "success",
        includeImage: true,
      });

      expect(result).toHaveProperty("content");
      const content = result.content as any[];
      expect(content.length).toBeGreaterThan(1);
      const hasImage = content.some((item: any) => item.type === "image");
      expect(hasImage).toBe(true);
    });

    it("should handle tool not found", async () => {
      const result = await client.callTool("nonexistent-tool", {});
      // When tool is not found, the SDK returns an error response, not an exception
      expect(result).toHaveProperty("isError", true);
      expect(result).toHaveProperty("content");
      const content = result.content as any[];
      expect(content[0]).toHaveProperty("text");
      expect(content[0].text).toContain("not found");
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
      const result = await client.listResources();
      expect(result).toHaveProperty("resources");
      expect(Array.isArray(result.resources)).toBe(true);
    });

    it("should read resource", async () => {
      // First get list of resources
      const listResult = await client.listResources();
      const resources = listResult.resources as any[];
      if (resources && resources.length > 0) {
        const uri = resources[0].uri;
        const readResult = await client.readResource(uri);
        expect(readResult).toHaveProperty("contents");
      }
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
      const result = await client.listResourceTemplates();
      expect(result).toHaveProperty("resourceTemplates");
      const resourceTemplates = (result as any).resourceTemplates;
      expect(Array.isArray(resourceTemplates)).toBe(true);
      expect(resourceTemplates.length).toBeGreaterThan(0);

      const templates = resourceTemplates as any[];
      const fileTemplate = templates.find((t) => t.name === "file");
      expect(fileTemplate).toBeDefined();
      expect(fileTemplate?.uriTemplate).toBe("file:///{path}");
    });

    it("should read resource from template", async () => {
      // First get the template
      const listResult = await client.listResourceTemplates();
      const templates = (listResult as any).resourceTemplates as any[];
      const fileTemplate = templates.find((t) => t.name === "file");
      expect(fileTemplate).toBeDefined();

      // Use a URI that matches the template pattern file:///{path}
      // The path variable will be "test.txt"
      const expandedUri = "file:///test.txt";

      // Read the resource using the expanded URI
      const readResult = await client.readResource(expandedUri);
      expect(readResult).toHaveProperty("contents");
      const contents = (readResult as any).contents;
      expect(Array.isArray(contents)).toBe(true);
      expect(contents.length).toBeGreaterThan(0);

      const content = contents[0];
      expect(content).toHaveProperty("uri");
      expect(content).toHaveProperty("text");
      expect(content.text).toContain("Mock file content for: test.txt");
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
      const result = await client.listPrompts();
      expect(result).toHaveProperty("prompts");
      expect(Array.isArray(result.prompts)).toBe(true);
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

      const statuses: string[] = [];
      client.addEventListener("statusChange", (event) => {
        const customEvent = event as CustomEvent<string>;
        statuses.push(customEvent.detail);
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
            ((event: CustomEvent) => {
              resolve(event.detail as SamplingCreateMessage);
            }) as EventListener,
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
      expect(toolResult.content).toBeDefined();
      expect(Array.isArray(toolResult.content)).toBe(true);
      const toolContent = toolResult.content as any[];
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
        client.addEventListener("message", ((event: CustomEvent) => {
          const entry = event.detail as MessageEntry;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        }) as EventListener);
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
        client.addEventListener("message", ((event: CustomEvent) => {
          const entry = event.detail as MessageEntry;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        }) as EventListener);
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
        client.addEventListener("message", ((event: CustomEvent) => {
          const entry = event.detail as MessageEntry;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        }) as EventListener);
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
});
